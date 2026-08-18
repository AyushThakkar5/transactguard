/**
 * Batch job business logic.
 *
 * Imported by two processes: the API (which creates and reads jobs) and the
 * worker (which reports chunk results back). The counter-mutation helpers at the
 * bottom are the worker's half of that contract.
 */

import { prisma } from '../../config/db.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'
import { CHUNK_SIZE, chunk, getBatchScoringQueue } from '../../config/queue.js'
import { MAX_TRANSACTIONS_PER_JOB } from './jobs.schemas.js'

const log = moduleLogger('jobs')

const CREATOR_SELECT = { id: true, name: true, email: true, role: true }

/** Statuses a job can still move out of. */
const IN_FLIGHT = ['QUEUED', 'PROCESSING']

/** Statuses a retry is allowed from. */
export const RETRYABLE_STATUSES = ['FAILED', 'PARTIALLY_COMPLETED']

/**
 * The roster is excluded from list/detail responses by default — 20,000 UUIDs
 * is not something an API consumer wants inlined in every poll.
 */
const JOB_SELECT = {
  id: true,
  name: true,
  status: true,
  totalTxns: true,
  processedCount: true,
  failedCount: true,
  totalChunks: true,
  completedChunks: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  createdById: true,
}

async function recordAudit({ userId, action, resourceType, resourceId, ipAddress, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, resourceType, resourceId, ipAddress, metadata },
    })
  } catch (err) {
    log.error({ err: err.message, action, userId }, 'Failed to write audit log entry')
  }
}

/** Progress as a percentage, for convenience when polling. */
function withProgress(job) {
  if (!job) return job
  const percent = job.totalTxns === 0 ? 100 : Math.round(((job.processedCount + job.failedCount) / job.totalTxns) * 100)
  return { ...job, progressPercent: Math.min(100, percent) }
}

/**
 * Work out which transactions a job should cover.
 *
 * Explicit ids are intersected with what actually exists and is not
 * soft-deleted, so totalTxns reflects real work rather than the caller's
 * optimism. The difference is reported back as `skipped`.
 */
async function resolveTransactionIds({ transactionIds, filter, limit }) {
  if (filter === 'unscored') {
    const rows = await prisma.transaction.findMany({
      where: { deletedAt: null, prediction: null },
      select: { id: true },
      take: limit ?? MAX_TRANSACTIONS_PER_JOB,
      orderBy: { createdAt: 'asc' },
    })
    return { ids: rows.map((r) => r.id), skipped: 0 }
  }

  // Deduplicate first: the same id twice would inflate totalTxns and leave the
  // job permanently short of completion.
  const requested = [...new Set(transactionIds)]

  const rows = await prisma.transaction.findMany({
    where: { id: { in: requested }, deletedAt: null },
    select: { id: true },
  })

  const found = rows.map((r) => r.id)
  return { ids: found, skipped: requested.length - found.length }
}

/**
 * Create a batch job and enqueue its chunks.
 *
 * Returns as soon as the rows are written and the chunks are on the queue —
 * scoring happens in the worker process.
 */
export async function createJob(body, user, ctx = {}) {
  const { ids, skipped } = await resolveTransactionIds(body)

  if (ids.length === 0) {
    throw ApiError.badRequest(
      body.filter === 'unscored'
        ? 'No unscored transactions found — everything already has a prediction'
        : 'None of the supplied transaction ids match an existing, non-deleted transaction',
      { requested: body.transactionIds?.length ?? 0, skipped },
    )
  }

  const chunks = chunk(ids, CHUNK_SIZE)

  const job = await prisma.batchJob.create({
    data: {
      name: body.name,
      status: 'QUEUED',
      totalTxns: ids.length,
      totalChunks: chunks.length,
      transactionIds: ids,
      createdById: user.id,
    },
    select: JOB_SELECT,
  })

  // Enqueued after the row exists, so a worker picking a chunk up immediately
  // always finds the job it is meant to update.
  const queue = getBatchScoringQueue()
  await queue.addBulk(
    chunks.map((transactionIds, index) => ({
      name: 'score-chunk',
      data: { batchJobId: job.id, transactionIds, chunkIndex: index, totalChunks: chunks.length },
    })),
  )

  await recordAudit({
    userId: user.id,
    action: 'BATCH_JOB_CREATED',
    resourceType: 'BatchJob',
    resourceId: job.id,
    ipAddress: ctx.ipAddress,
    metadata: {
      name: job.name,
      totalTxns: job.totalTxns,
      totalChunks: job.totalChunks,
      source: body.filter ? `filter:${body.filter}` : 'explicit-ids',
      skipped,
    },
  })

  log.info(
    { jobId: job.id, name: job.name, totalTxns: job.totalTxns, chunks: chunks.length, skipped },
    'Batch job enqueued',
  )

  return { job: withProgress(job), skipped }
}

export async function listJobs(query) {
  const where = {}
  if (query.status) where.status = query.status
  if (query.from || query.to) {
    where.createdAt = {}
    if (query.from) where.createdAt.gte = query.from
    if (query.to) where.createdAt.lte = query.to
  }

  const skip = (query.page - 1) * query.pageSize

  const [total, rows] = await Promise.all([
    prisma.batchJob.count({ where }),
    prisma.batchJob.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip,
      take: query.pageSize,
      select: { ...JOB_SELECT, createdBy: { select: CREATOR_SELECT } },
    }),
  ])

  const totalPages = Math.ceil(total / query.pageSize)

  return {
    jobs: rows.map(withProgress),
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

export async function getJobById(id) {
  const job = await prisma.batchJob.findUnique({
    where: { id },
    select: { ...JOB_SELECT, createdBy: { select: CREATOR_SELECT } },
  })
  if (!job) throw ApiError.notFound('Batch job not found')

  const predictionCount = await prisma.prediction.count({ where: { batchJobId: id } })

  return { ...withProgress(job), predictionsStored: predictionCount }
}

/**
 * Re-enqueue only the outstanding work of a finished-but-incomplete job.
 *
 * "Outstanding" means a transaction on the job's roster with no Prediction
 * attributed to this job. Rows that succeeded the first time are left alone, so
 * a retry never re-pays the ML cost for work already done.
 */
export async function retryJob(id, user, ctx = {}) {
  const job = await prisma.batchJob.findUnique({ where: { id } })
  if (!job) throw ApiError.notFound('Batch job not found')

  if (!RETRYABLE_STATUSES.includes(job.status)) {
    throw ApiError.conflict(
      `Only jobs in ${RETRYABLE_STATUSES.join(' or ')} can be retried — this one is ${job.status}`,
      'JOB_NOT_RETRYABLE',
    )
  }

  const alreadyScored = await prisma.prediction.findMany({
    where: { batchJobId: id, transactionId: { in: job.transactionIds } },
    select: { transactionId: true },
  })
  const done = new Set(alreadyScored.map((p) => p.transactionId))

  // Still exclude anything soft-deleted since the original run.
  const outstanding = await prisma.transaction.findMany({
    where: {
      id: { in: job.transactionIds.filter((txnId) => !done.has(txnId)) },
      deletedAt: null,
    },
    select: { id: true },
  })
  const ids = outstanding.map((t) => t.id)

  if (ids.length === 0) {
    throw ApiError.conflict(
      'Nothing left to retry — every transaction on this job already has a prediction',
      'NOTHING_TO_RETRY',
    )
  }

  const chunks = chunk(ids, CHUNK_SIZE)

  // Reset the chunk counters for the new run. processedCount is preserved
  // because those predictions still exist; failedCount is cleared so the retry
  // is judged on its own outcome.
  const updated = await prisma.batchJob.update({
    where: { id },
    data: {
      status: 'QUEUED',
      failedCount: 0,
      totalChunks: chunks.length,
      completedChunks: 0,
      completedAt: null,
      startedAt: null,
    },
    select: JOB_SELECT,
  })

  const queue = getBatchScoringQueue()
  await queue.addBulk(
    chunks.map((transactionIds, index) => ({
      name: 'score-chunk',
      data: { batchJobId: id, transactionIds, chunkIndex: index, totalChunks: chunks.length, retry: true },
    })),
  )

  await recordAudit({
    userId: user.id,
    action: 'BATCH_JOB_RETRIED',
    resourceType: 'BatchJob',
    resourceId: id,
    ipAddress: ctx.ipAddress,
    metadata: { retryingTransactions: ids.length, chunks: chunks.length, previousStatus: job.status },
  })

  log.info({ jobId: id, retrying: ids.length, chunks: chunks.length }, 'Batch job retry enqueued')

  return { job: withProgress(updated), retryingTransactions: ids.length }
}

// ---------------------------------------------------------------------------
// Worker-side helpers
// ---------------------------------------------------------------------------

/** Flip QUEUED → PROCESSING on the first chunk to start. Safe to call repeatedly. */
export async function markJobProcessing(batchJobId) {
  await prisma.batchJob.updateMany({
    where: { id: batchJobId, status: 'QUEUED' },
    data: { status: 'PROCESSING', startedAt: new Date() },
  })
}

/**
 * Record one chunk's outcome and finalise the job if it was the last.
 *
 * The three counters move in a single atomic UPDATE (Prisma's `increment`
 * compiles to `SET x = x + n`), so concurrent chunks cannot lose each other's
 * writes the way a read-then-write would. The UPDATE returns its post-update
 * row, which means exactly one caller observes completedChunks reaching
 * totalChunks — that caller finalises.
 */
export async function recordChunkResult(batchJobId, { processed = 0, failed = 0 }) {
  const updated = await prisma.batchJob.update({
    where: { id: batchJobId },
    data: {
      processedCount: { increment: processed },
      failedCount: { increment: failed },
      completedChunks: { increment: 1 },
    },
  })

  // finalStatus is non-null only for the one caller whose increment brought
  // completedChunks level with totalChunks. The worker uses it to decide whether
  // to publish job:completed — the counters themselves are unchanged.
  let finalStatus = null
  if (updated.completedChunks >= updated.totalChunks) {
    finalStatus = await finalizeJob(updated)
  }

  return { job: updated, finalStatus }
}

/**
 * Decide the terminal status and stamp completed_at.
 *
 * Guarded by a status predicate so that even if two callers race here, only the
 * first writes — and only one BATCH_JOB_COMPLETED audit row is produced.
 */
async function finalizeJob(job) {
  let status
  if (job.failedCount === 0) status = 'COMPLETED'
  else if (job.processedCount === 0) status = 'FAILED'
  else status = 'PARTIALLY_COMPLETED'

  const result = await prisma.batchJob.updateMany({
    where: { id: job.id, status: { in: IN_FLIGHT } },
    data: { status, completedAt: new Date() },
  })

  if (result.count === 0) return null // another chunk finalised first

  await recordAudit({
    userId: job.createdById,
    action: 'BATCH_JOB_COMPLETED',
    resourceType: 'BatchJob',
    resourceId: job.id,
    metadata: {
      name: job.name,
      status,
      totalTxns: job.totalTxns,
      processedCount: job.processedCount,
      failedCount: job.failedCount,
    },
  })

  log.info(
    {
      jobId: job.id,
      status,
      totalTxns: job.totalTxns,
      processed: job.processedCount,
      failed: job.failedCount,
    },
    'Batch job finished',
  )

  return status
}
