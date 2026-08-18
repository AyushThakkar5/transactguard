/**
 * Transaction business logic. All Prisma access for the module lives here.
 */

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { parse } from 'csv-parse'
import { prisma } from '../../config/db.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'
import { mapRowToTransaction, validateCsvHeaders } from './paysim.mapper.js'

const log = moduleLogger('transactions')

/** Rows per createMany call during CSV import. */
const IMPORT_BATCH_SIZE = 1000

/** Per-row error detail is capped so one bad file cannot produce a huge response. */
const MAX_REPORTED_ERRORS = 50

const UPLOADER_SELECT = { id: true, name: true, email: true, role: true }

/**
 * Prisma returns Decimal instances for money columns, which JSON.stringify would
 * render as strings. Convert to numbers so the API surface is consistently
 * numeric — safe here because amounts are capped well inside 2^53.
 */
function serializeTransaction(txn) {
  if (!txn) return txn
  const decimalFields = [
    'amount',
    'origBalanceBefore',
    'origBalanceAfter',
    'destBalanceBefore',
    'destBalanceAfter',
  ]
  const out = { ...txn }
  for (const field of decimalFields) {
    if (out[field] !== null && out[field] !== undefined) out[field] = Number(out[field])
  }
  return out
}

/** Mirrors auth.service.js — audit failures are logged, never fatal. */
async function recordAudit({ userId, action, resourceType, resourceId, ipAddress, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, resourceType, resourceId, ipAddress, metadata },
    })
  } catch (err) {
    log.error({ err: err.message, action, userId }, 'Failed to write audit log entry')
  }
}

/** Translate validated query params into a Prisma where clause. */
function buildWhere(query) {
  const where = {}

  // Soft delete is the default filter: deleted rows stay in the table but leave
  // the API surface entirely unless explicitly asked for.
  if (!query.includeDeleted) where.deletedAt = null

  if (query.txnType) where.txnType = query.txnType
  if (query.merchantCategory) where.merchantCategory = query.merchantCategory

  if (query.from || query.to) {
    where.txnTimestamp = {}
    if (query.from) where.txnTimestamp.gte = query.from
    if (query.to) where.txnTimestamp.lte = query.to
  }

  if (query.minAmount !== undefined || query.maxAmount !== undefined) {
    where.amount = {}
    if (query.minAmount !== undefined) where.amount.gte = query.minAmount
    if (query.maxAmount !== undefined) where.amount.lte = query.maxAmount
  }

  if (query.search) {
    where.OR = [
      { txnId: { contains: query.search, mode: 'insensitive' } },
      { senderId: { contains: query.search, mode: 'insensitive' } },
      { receiverId: { contains: query.search, mode: 'insensitive' } },
    ]
  }

  return where
}

/**
 * Paginated, filtered list.
 * @returns {{ transactions: object[], pagination: object }}
 */
export async function listTransactions(query, user) {
  // Soft-deleted rows are an audit concern, not general read data — gate the
  // escape hatch rather than letting any authenticated role page through
  // records someone deliberately removed.
  if (query.includeDeleted && user?.role !== 'ADMIN') {
    throw ApiError.forbidden('Only an ADMIN may list deleted transactions')
  }

  const where = buildWhere(query)
  const skip = (query.page - 1) * query.pageSize

  const [total, rows] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip,
      take: query.pageSize,
    }),
  ])

  const totalPages = Math.ceil(total / query.pageSize)

  return {
    transactions: rows.map(serializeTransaction),
    pagination: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  }
}

/** Single transaction including who uploaded it. */
export async function getTransactionById(id) {
  const txn = await prisma.transaction.findFirst({
    where: { id, deletedAt: null },
    include: { uploadedBy: { select: UPLOADER_SELECT } },
  })

  if (!txn) throw ApiError.notFound('Transaction not found')
  return serializeTransaction(txn)
}

/**
 * Create one transaction by hand.
 * @throws {ApiError} 409 when txnId already exists
 */
export async function createTransaction(input, user, ctx = {}) {
  const txnId = input.txnId ?? `TXN-${randomUUID()}`

  const existing = await prisma.transaction.findUnique({
    where: { txnId },
    select: { id: true },
  })
  if (existing) {
    throw ApiError.conflict(`A transaction with txnId "${txnId}" already exists`, 'TXN_ID_TAKEN')
  }

  const txn = await prisma.transaction.create({
    data: { ...input, txnId, uploadedById: user.id },
  })

  await recordAudit({
    userId: user.id,
    action: 'TRANSACTION_CREATED',
    resourceType: 'Transaction',
    resourceId: txn.id,
    ipAddress: ctx.ipAddress,
    metadata: { txnId: txn.txnId, txnType: txn.txnType, amount: Number(txn.amount) },
  })

  log.info({ txnId: txn.txnId, userId: user.id }, 'Transaction created')
  return serializeTransaction(txn)
}

/**
 * Stream a CSV file from disk into Postgres.
 *
 * Streamed rather than read whole: the file is capped at 50 MB by multer, but
 * parsing incrementally keeps memory flat regardless and matches how
 * seedTransactions.js handles the full 493 MB dataset.
 *
 * Ground-truth label columns (isFraud / isFlaggedFraud) are ignored here by
 * design — those are seed-only and must not enter the transaction record.
 *
 * @param {string} filePath  temp file written by multer
 * @param {object} user      the authenticated uploader
 * @returns {{ inserted: number, skipped: number, errors: object[], ... }}
 */
export async function importTransactionsFromCsv(filePath, user, ctx = {}) {
  const summary = {
    totalRows: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  let batch = []
  let headersChecked = false

  async function flush() {
    if (batch.length === 0) return
    const result = await prisma.transaction.createMany({ data: batch, skipDuplicates: true })
    summary.inserted += result.count
    // createMany reports how many landed; the shortfall is rows whose txn_id was
    // already present.
    summary.skipped += batch.length - result.count
    batch = []
  }

  const parser = fs.createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  )

  try {
    for await (const row of parser) {
      // Headers are checked against the first record, before any row is written.
      if (!headersChecked) {
        const { valid, missing } = validateCsvHeaders(Object.keys(row))
        if (!valid) {
          throw ApiError.badRequest(
            `CSV is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
            { missing },
          )
        }
        headersChecked = true
      }

      summary.totalRows++

      try {
        batch.push(mapRowToTransaction(row, { uploadedById: user.id }))
      } catch (err) {
        summary.failed++
        if (summary.errors.length < MAX_REPORTED_ERRORS) {
          // +1 for the header line, so this matches what a spreadsheet shows.
          summary.errors.push({ row: summary.totalRows + 1, message: err.message })
        }
        continue
      }

      if (batch.length >= IMPORT_BATCH_SIZE) await flush()
    }

    await flush()
  } catch (err) {
    if (err instanceof ApiError) throw err
    // csv-parse surfaces structural problems (bad quoting, ragged columns) here.
    if (err.code?.startsWith?.('CSV_')) {
      throw ApiError.badRequest(`Could not parse CSV: ${err.message}`)
    }
    throw err
  }

  if (summary.totalRows === 0) {
    throw ApiError.badRequest('CSV contained no data rows')
  }

  if (summary.failed > MAX_REPORTED_ERRORS) {
    summary.errorsTruncated = true
    summary.errorsOmitted = summary.failed - MAX_REPORTED_ERRORS
  }

  await recordAudit({
    userId: user.id,
    action: 'TRANSACTION_UPLOADED',
    resourceType: 'Transaction',
    ipAddress: ctx.ipAddress,
    metadata: {
      fileName: ctx.fileName,
      totalRows: summary.totalRows,
      inserted: summary.inserted,
      skipped: summary.skipped,
      failed: summary.failed,
    },
  })

  log.info({ userId: user.id, ...summary, errors: summary.errors.length }, 'CSV import complete')
  return summary
}

/**
 * Soft delete — the row stays in Postgres with deleted_at set, so the audit
 * trail and any downstream predictions keep their referent.
 */
export async function softDeleteTransaction(id, user, ctx = {}) {
  const existing = await prisma.transaction.findUnique({
    where: { id },
    select: { id: true, txnId: true, deletedAt: true },
  })

  if (!existing) throw ApiError.notFound('Transaction not found')
  if (existing.deletedAt) {
    throw ApiError.conflict('Transaction is already deleted', 'ALREADY_DELETED')
  }

  const txn = await prisma.transaction.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: { id: true, txnId: true, deletedAt: true },
  })

  await recordAudit({
    userId: user.id,
    action: 'TRANSACTION_DELETED',
    resourceType: 'Transaction',
    resourceId: txn.id,
    ipAddress: ctx.ipAddress,
    metadata: { txnId: txn.txnId, softDelete: true },
  })

  log.info({ txnId: txn.txnId, userId: user.id }, 'Transaction soft deleted')
  return txn
}
