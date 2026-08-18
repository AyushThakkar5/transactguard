/**
 * Case management — the analyst review queue.
 *
 * A Case is the human decision attached to a flagged transaction. Predictions
 * say how risky something looks; cases record what an analyst concluded.
 *
 * Cases are materialised rather than derived on read, because a case carries
 * state the prediction does not: who owns it, what they decided, when they
 * resolved it, and any note they left. `backfillCases` creates the missing rows
 * for flagged transactions — a GET must never write, so bootstrapping is an
 * explicit call rather than a side effect of listing.
 */

import { prisma } from '../../config/db.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'

const log = moduleLogger('cases')

export const CASE_STATUSES = ['UNDER_REVIEW', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE']

/** Levels that warrant a human decision. CLEAR needs no case. */
const FLAGGED = ['SUSPICIOUS', 'CRITICAL']

const ASSIGNEE_SELECT = { id: true, name: true, email: true, role: true }

const CASE_INCLUDE = {
  assignedTo: { select: ASSIGNEE_SELECT },
  transaction: {
    select: {
      id: true,
      txnId: true,
      amount: true,
      txnType: true,
      senderId: true,
      receiverId: true,
      txnTimestamp: true,
      location: true,
      prediction: {
        select: { riskScore: true, riskLevel: true, explanationSummary: true },
      },
    },
  },
}

function serialize(caseRow) {
  if (!caseRow) return caseRow
  const txn = caseRow.transaction
  return {
    ...caseRow,
    transaction: txn
      ? { ...txn, amount: Number(txn.amount) }
      : null,
    // Lifted so the board can sort and colour without digging.
    riskScore: txn?.prediction?.riskScore ?? null,
    riskLevel: txn?.prediction?.riskLevel ?? null,
  }
}

async function recordAudit({ userId, action, resourceId, ipAddress, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, resourceType: 'Case', resourceId, ipAddress, metadata },
    })
  } catch (err) {
    log.error({ err: err.message, action, userId }, 'Failed to write audit log entry')
  }
}

/**
 * Create case rows for flagged transactions that do not have one.
 *
 * Idempotent — only transactions with a SUSPICIOUS or CRITICAL prediction and
 * no existing case are inserted, so running it twice is a no-op.
 */
export async function backfillCases({ limit = 5000 } = {}) {
  const missing = await prisma.transaction.findMany({
    where: {
      deletedAt: null,
      cases: { none: {} },
      prediction: { riskLevel: { in: FLAGGED } },
    },
    select: { id: true },
    take: limit,
  })

  if (missing.length === 0) return { created: 0, remaining: 0 }

  const result = await prisma.case.createMany({
    data: missing.map((t) => ({ transactionId: t.id, status: 'UNDER_REVIEW' })),
    skipDuplicates: true,
  })

  const remaining = await prisma.transaction.count({
    where: {
      deletedAt: null,
      cases: { none: {} },
      prediction: { riskLevel: { in: FLAGGED } },
    },
  })

  log.info({ created: result.count, remaining }, 'Case backfill complete')
  return { created: result.count, remaining }
}

/** Translate validated query params into a Prisma where clause. */
function buildWhere(query) {
  // `prediction: { isNot: null }` is doing real work. A case exists because a
  // prediction flagged its transaction; if that prediction is later removed the
  // case is orphaned and has no risk to review. Postgres sorts nulls FIRST on a
  // descending order, so without this an orphan would head a risk-ranked queue —
  // the one row an analyst least needs to see first. Prisma cannot express
  // NULLS LAST through a nested relation ordering, so the orphans are excluded
  // rather than mis-sorted.
  const where = { transaction: { deletedAt: null, prediction: { isNot: null } } }

  if (query.status) where.status = query.status
  if (query.riskLevel) where.transaction.prediction = { riskLevel: query.riskLevel }
  if (query.assignedToId) where.assignedToId = query.assignedToId

  if (query.from || query.to) {
    where.createdAt = {}
    if (query.from) where.createdAt.gte = query.from
    if (query.to) where.createdAt.lte = query.to
  }

  if (query.search) {
    where.transaction.OR = [
      { txnId: { contains: query.search, mode: 'insensitive' } },
      { senderId: { contains: query.search, mode: 'insensitive' } },
      { receiverId: { contains: query.search, mode: 'insensitive' } },
    ]
  }

  return where
}

/**
 * List cases.
 *
 * Default ordering is risk score descending, which is the entire point of a
 * review queue — the worst thing an analyst has not looked at yet should be the
 * first thing they see. Prisma can order on a related field, so this is one
 * query rather than a fetch-then-sort in Node.
 */
export async function listCases(query) {
  const where = buildWhere(query)
  const skip = (query.page - 1) * query.pageSize

  const orderBy =
    query.sortBy === 'riskScore'
      ? { transaction: { prediction: { riskScore: query.sortOrder } } }
      : query.sortBy === 'amount'
        ? { transaction: { amount: query.sortOrder } }
        : { [query.sortBy]: query.sortOrder }

  const [total, rows] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({ where, orderBy, skip, take: query.pageSize, include: CASE_INCLUDE }),
  ])

  const totalPages = Math.ceil(total / query.pageSize)

  return {
    cases: rows.map(serialize),
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

/** Counts per status, so the board can show live column totals cheaply. */
export async function getCaseCounts() {
  const rows = await prisma.case.groupBy({
    by: ['status'],
    _count: { _all: true },
    where: { transaction: { deletedAt: null } },
  })

  const counts = Object.fromEntries(CASE_STATUSES.map((s) => [s, 0]))
  for (const row of rows) counts[row.status] = row._count._all
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }
}

export async function getCaseById(id) {
  const found = await prisma.case.findFirst({
    where: { id, transaction: { deletedAt: null } },
    include: CASE_INCLUDE,
  })
  if (!found) throw ApiError.notFound('Case not found')
  return serialize(found)
}

/**
 * Update a case's status, and optionally its note and assignee.
 *
 * `resolvedAt` is managed here rather than by the caller: moving to a terminal
 * decision stamps it, moving back to UNDER_REVIEW clears it. Leaving that to
 * the client would guarantee the two disagree eventually.
 */
export async function updateCase(id, patch, user, ctx = {}) {
  const existing = await prisma.case.findFirst({
    where: { id, transaction: { deletedAt: null } },
    select: { id: true, status: true, transactionId: true },
  })
  if (!existing) throw ApiError.notFound('Case not found')

  const data = {}

  if (patch.status && patch.status !== existing.status) {
    data.status = patch.status
    data.resolvedAt = patch.status === 'UNDER_REVIEW' ? null : new Date()
    // The analyst making the call takes ownership unless one is named.
    if (!patch.assignedToId) data.assignedToId = user.id
  }

  if (patch.notes !== undefined) data.notes = patch.notes
  if (patch.assignedToId !== undefined) data.assignedToId = patch.assignedToId

  if (Object.keys(data).length === 0) {
    // Nothing to change — return the current state rather than writing a
    // no-op row and an audit entry that says nothing happened.
    return getCaseById(id)
  }

  const updated = await prisma.case.update({ where: { id }, data, include: CASE_INCLUDE })

  await recordAudit({
    userId: user.id,
    action: 'CASE_STATUS_CHANGED',
    resourceId: id,
    ipAddress: ctx.ipAddress,
    metadata: {
      from: existing.status,
      to: updated.status,
      transactionId: existing.transactionId,
      txnId: updated.transaction?.txnId,
      riskScore: updated.transaction?.prediction?.riskScore ?? null,
      noteChanged: patch.notes !== undefined,
    },
  })

  log.info(
    { caseId: id, from: existing.status, to: updated.status, userId: user.id },
    'Case status changed',
  )

  return serialize(updated)
}
