/**
 * Predictions business logic.
 *
 * Owns the scoring round trip: load the transaction, call the ML service,
 * persist the result. All Prisma and ML-client access for the module is here.
 */

import { prisma } from '../../config/db.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'
import { predictSingle } from './mlClient.js'

const log = moduleLogger('predictions')

/** Transaction fields embedded in a prediction list row, per the module spec. */
const TRANSACTION_SUMMARY_SELECT = {
  txnId: true,
  amount: true,
  txnType: true,
}

const UPLOADER_SELECT = { id: true, name: true, email: true, role: true }

/** Decimal columns on Transaction that must not reach JSON as Decimal objects. */
const TRANSACTION_DECIMAL_FIELDS = [
  'amount',
  'origBalanceBefore',
  'origBalanceAfter',
  'destBalanceBefore',
  'destBalanceAfter',
]

function serializeTransaction(txn) {
  if (!txn) return txn
  const out = { ...txn }
  for (const field of TRANSACTION_DECIMAL_FIELDS) {
    if (out[field] !== null && out[field] !== undefined) out[field] = Number(out[field])
  }
  return out
}

function serializePrediction(prediction) {
  if (!prediction) return prediction
  const out = { ...prediction }
  if (out.transaction) out.transaction = serializeTransaction(out.transaction)
  return out
}

/** Mirrors auth/transactions — audit failures are logged, never fatal. */
async function recordAudit({ userId, action, resourceType, resourceId, ipAddress, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, resourceType, resourceId, ipAddress, metadata },
    })
  } catch (err) {
    log.error({ err: err.message, action, userId }, 'Failed to write audit log entry')
  }
}

/**
 * Score a transaction and store the result.
 *
 * Idempotent by transaction: the Prediction table holds at most one row per
 * transaction, so calling this again is a rescore that overwrites in place.
 *
 * Nothing is written unless the ML service answered and its response validated
 * — a 502 leaves any previous prediction exactly as it was.
 *
 * @throws {ApiError} 404 unknown or soft-deleted transaction, 502 ML failure
 */
export async function scoreAndPersist(transactionId, { batchJobId = null } = {}) {
  const startedAt = performance.now()

  // A soft-deleted transaction is treated as absent, consistent with every
  // other read path in the API.
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, deletedAt: null },
  })

  if (!transaction) throw ApiError.notFound('Transaction not found')

  const fetchMs = Math.round(performance.now() - startedAt)

  // Throws before any write if the ML service is down, slow, or off-contract.
  const { prediction: scored, roundTripMs } = await predictSingle(transaction)

  const writeStartedAt = performance.now()

  const existing = await prisma.prediction.findUnique({
    where: { transactionId },
    select: { id: true },
  })

  const data = {
    riskScore: scored.risk_score,
    riskLevel: scored.risk_level,
    explanationSummary: scored.explanation_summary,
    featureContributions: scored.feature_contributions,
    modelVersion: scored.model_version,
    latencyMs: scored.latency_ms,
    // Null for a synchronous rescore; set to the owning job when the batch
    // worker is the caller, which is what makes a job's output identifiable.
    batchJobId,
  }

  const prediction = await prisma.prediction.upsert({
    where: { transactionId },
    create: { transactionId, ...data },
    update: data,
    include: { transaction: { select: TRANSACTION_SUMMARY_SELECT } },
  })

  const writeMs = Math.round(performance.now() - writeStartedAt)
  const totalMs = Math.round(performance.now() - startedAt)

  return {
    transaction,
    prediction,
    scored,
    rescored: Boolean(existing),
    timings: {
      transactionFetchMs: fetchMs,
      mlRoundTripMs: roundTripMs,
      mlComputeMs: scored.latency_ms,
      databaseWriteMs: writeMs,
      totalMs,
    },
  }
}

export async function createPrediction(transactionId, user, ctx = {}) {
  const { transaction, prediction, scored, rescored, timings } =
    await scoreAndPersist(transactionId)

  await recordAudit({
    userId: user.id,
    action: 'PREDICTION_CREATED',
    resourceType: 'Prediction',
    resourceId: prediction.id,
    ipAddress: ctx.ipAddress,
    metadata: {
      txnId: transaction.txnId,
      transactionId,
      riskScore: scored.risk_score,
      riskLevel: scored.risk_level,
      modelVersion: scored.model_version,
      rescored,
    },
  })

  // Broken out so Step 4's isolated ML timing can be compared against the full
  // round trip: mlComputeMs is the scorer's own figure, mlRoundTripMs adds HTTP.
  log.info(
    {
      txnId: transaction.txnId,
      riskScore: scored.risk_score,
      riskLevel: scored.risk_level,
      rescored,
      fetchMs: timings.transactionFetchMs,
      mlRoundTripMs: timings.mlRoundTripMs,
      mlComputeMs: timings.mlComputeMs,
      writeMs: timings.databaseWriteMs,
      totalMs: timings.totalMs,
    },
    'Prediction stored',
  )

  return {
    prediction: serializePrediction(prediction),
    timings,
    rescored,
  }
}

/** Translate validated query params into a Prisma where clause. */
export function buildPredictionWhere(query) {
  // Predictions whose transaction has been soft-deleted drop out of the API
  // alongside the transaction itself.
  const where = { transaction: { deletedAt: null } }

  if (query.riskLevel) where.riskLevel = query.riskLevel

  if (query.from || query.to) {
    where.createdAt = {}
    if (query.from) where.createdAt.gte = query.from
    if (query.to) where.createdAt.lte = query.to
  }

  if (query.minScore !== undefined || query.maxScore !== undefined) {
    where.riskScore = {}
    if (query.minScore !== undefined) where.riskScore.gte = query.minScore
    if (query.maxScore !== undefined) where.riskScore.lte = query.maxScore
  }

  if (query.search) {
    where.transaction.txnId = { contains: query.search, mode: 'insensitive' }
  }

  return where
}

/** Paginated list, each row carrying its transaction's key fields. */
export async function listPredictions(query) {
  const where = buildPredictionWhere(query)
  const skip = (query.page - 1) * query.pageSize

  const [total, rows] = await Promise.all([
    prisma.prediction.count({ where }),
    prisma.prediction.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip,
      take: query.pageSize,
      include: { transaction: { select: TRANSACTION_SUMMARY_SELECT } },
    }),
  ])

  const totalPages = Math.ceil(total / query.pageSize)

  return {
    predictions: rows.map(serializePrediction),
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

/** One prediction with the full transaction joined. */
export async function getPredictionById(id) {
  const prediction = await prisma.prediction.findFirst({
    where: { id, transaction: { deletedAt: null } },
    include: {
      transaction: { include: { uploadedBy: { select: UPLOADER_SELECT } } },
    },
  })

  if (!prediction) throw ApiError.notFound('Prediction not found')
  return serializePrediction(prediction)
}

/**
 * Page through every prediction matching a filter, for CSV export.
 *
 * Cursor-based rather than offset-based: an export can span the whole table,
 * and OFFSET makes the database re-walk every skipped row on each page. Yields
 * batches so the caller can stream them out without holding the result set.
 *
 * @param {object} query validated list query (pagination fields ignored)
 * @param {number} batchSize rows per round trip
 */
export async function* streamPredictionsForExport(query, batchSize = 1000) {
  const where = buildPredictionWhere(query)
  let cursor = null

  for (;;) {
    const batch = await prisma.prediction.findMany({
      where,
      // Ordered by primary key so the cursor is stable even while rows are
      // being inserted mid-export.
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        riskScore: true,
        riskLevel: true,
        explanationSummary: true,
        transaction: { select: { txnId: true } },
      },
    })

    if (batch.length === 0) return

    yield batch

    if (batch.length < batchSize) return
    cursor = batch[batch.length - 1].id
  }
}
