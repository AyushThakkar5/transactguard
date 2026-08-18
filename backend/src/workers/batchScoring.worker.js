/**
 * Batch scoring worker — its own process.
 *
 *   npm run worker
 *
 * Consumes the "batch-scoring" queue. Each queue job is a chunk of up to 100
 * transaction ids; the worker scores them one by one through the SAME
 * scoreAndPersist() the synchronous POST /predictions/:id path uses, so there is
 * exactly one implementation of "fetch, call the model, upsert".
 *
 * Deliberately separate from the Express server: scoring a 20,000-row job would
 * otherwise compete with request handling for the event loop, and the two scale
 * for different reasons.
 */

import { Worker } from 'bullmq'
import {
  BATCH_SCORING_QUEUE,
  WORKER_CONCURRENCY,
  createQueueConnection,
} from '../config/queue.js'
import { prisma, disconnectDatabase } from '../config/db.js'
import { scoreAndPersist } from '../modules/predictions/predictions.service.js'
import { markJobProcessing, recordChunkResult } from '../modules/jobs/jobs.service.js'
import {
  closePublisher,
  initPublisher,
  publishJobCompleted,
  publishJobProgress,
} from '../realtime/publisher.js'
import { logger, moduleLogger } from '../utils/logger.js'

const log = moduleLogger('worker')

/**
 * Errors that mean "the model is unreachable", not "this row is bad".
 *
 * The distinction decides whether a chunk retries or moves on. A per-transaction
 * problem — the row vanished, or it lacks the balances the scorer needs — is
 * counted and skipped, because retrying it would fail identically three more
 * times and stall the job. An ML-service failure is thrown, which hands the
 * whole chunk back to BullMQ for exponential-backoff retry, because the very
 * next attempt may well succeed.
 *
 * Without this split, catching everything per-transaction would make the retry
 * policy dead code: an ML outage would quietly mark all 20,000 rows failed on
 * the first pass and never try again.
 */
const RETRYABLE_ML_CODES = new Set([
  'ML_SERVICE_UNAVAILABLE',
  'ML_SERVICE_TIMEOUT',
  'ML_SERVICE_UNAUTHORIZED',
  'ML_SERVICE_ERROR',
  'ML_SERVICE_INVALID_RESPONSE',
])

/** How many of a chunk's transactions already have a prediction from this job. */
async function countScored(batchJobId, transactionIds) {
  return prisma.prediction.count({
    where: { batchJobId, transactionId: { in: transactionIds } },
  })
}

async function processChunk(job) {
  const { batchJobId, transactionIds, chunkIndex, totalChunks } = job.data
  const startedAt = performance.now()

  await markJobProcessing(batchJobId)

  let processed = 0
  let failed = 0
  const failures = []

  for (const transactionId of transactionIds) {
    try {
      await scoreAndPersist(transactionId, { batchJobId })
      processed++
    } catch (err) {
      if (RETRYABLE_ML_CODES.has(err.code)) {
        // Infrastructure, not data. Abandon the chunk and let BullMQ retry it.
        // Rows scored earlier in this pass keep their predictions; the next
        // attempt re-scores them harmlessly, since the write is an upsert.
        log.warn(
          { jobId: batchJobId, chunkIndex, attempt: job.attemptsMade + 1, code: err.code },
          'Chunk aborted — ML service unavailable, will retry',
        )
        throw err
      }

      failed++
      if (failures.length < 10) {
        failures.push({ transactionId, code: err.code ?? 'UNKNOWN', message: err.message })
      }
    }
  }

  const { job: updatedJob, finalStatus } = await recordChunkResult(batchJobId, { processed, failed })

  // Best-effort push to any browser watching this job. publishJobProgress
  // swallows its own failures, so a Redis outage costs live updates and nothing
  // else — the counters are already committed to Postgres above.
  await publishJobProgress({ ...updatedJob, status: finalStatus ?? updatedJob.status })
  if (finalStatus) await publishJobCompleted(updatedJob, finalStatus)

  const elapsedMs = Math.round(performance.now() - startedAt)
  log.info(
    {
      jobId: batchJobId,
      chunk: `${chunkIndex + 1}/${totalChunks}`,
      size: transactionIds.length,
      processed,
      failed,
      elapsedMs,
      perTxnMs: transactionIds.length ? Math.round(elapsedMs / transactionIds.length) : 0,
      ...(failures.length ? { sampleFailures: failures } : {}),
    },
    'Chunk complete',
  )

  return { processed, failed }
}

// Warm the pub/sub connection before the first chunk lands, so the opening
// progress events of a job are not dropped during the Redis handshake.
await initPublisher()

const connection = createQueueConnection()

const worker = new Worker(BATCH_SCORING_QUEUE, processChunk, {
  connection,
  concurrency: WORKER_CONCURRENCY,
})

worker.on('ready', () =>
  log.info(
    { queue: BATCH_SCORING_QUEUE, concurrency: WORKER_CONCURRENCY },
    'Batch scoring worker ready',
  ),
)

worker.on('error', (err) => log.error({ err: err.message }, 'Worker error'))

/**
 * Fires after every failed attempt, not just the last.
 *
 * On the final attempt the chunk will never run again, so its outcome has to be
 * recorded here — otherwise completedChunks would never reach totalChunks and
 * the job would sit in PROCESSING forever, which is exactly the "stuck job"
 * failure this step has to avoid.
 */
worker.on('failed', async (job, err) => {
  if (!job) return

  const attemptsAllowed = job.opts?.attempts ?? 1
  if (job.attemptsMade < attemptsAllowed) {
    log.warn(
      { jobId: job.data?.batchJobId, attempt: job.attemptsMade, of: attemptsAllowed, err: err.message },
      'Chunk attempt failed, retrying',
    )
    return
  }

  const { batchJobId, transactionIds = [], chunkIndex } = job.data ?? {}
  if (!batchJobId) return

  try {
    // Some rows may have been scored before the chunk gave up. Count what
    // actually landed rather than writing the whole chunk off, so the job's
    // final tally is honest.
    const scored = await countScored(batchJobId, transactionIds)

    const { job: updatedJob, finalStatus } = await recordChunkResult(batchJobId, {
      processed: scored,
      failed: transactionIds.length - scored,
    })

    // A chunk giving up still moves the job forward, so watchers see the
    // progress and the terminal status rather than the stream simply stopping.
    await publishJobProgress({ ...updatedJob, status: finalStatus ?? updatedJob.status })
    if (finalStatus) await publishJobCompleted(updatedJob, finalStatus)

    log.error(
      {
        jobId: batchJobId,
        chunkIndex,
        attempts: job.attemptsMade,
        salvaged: scored,
        failed: transactionIds.length - scored,
        err: err.message,
      },
      'Chunk exhausted its retries',
    )
  } catch (bookkeepingErr) {
    // If this throws the job really would hang, so it is logged at fatal.
    log.fatal(
      { jobId: batchJobId, err: bookkeepingErr.message },
      'Failed to record a terminal chunk failure — job may not reach a terminal status',
    )
  }
})

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  log.info({ signal }, 'Worker shutting down')

  try {
    // `true` waits for in-flight chunks rather than dropping them mid-write.
    await worker.close()
    await closePublisher()
    await connection.quit()
    await disconnectDatabase()
    log.info('Worker shutdown complete')
    process.exit(0)
  } catch (err) {
    log.error({ err: err.message }, 'Error during worker shutdown')
    process.exit(1)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('unhandledRejection', (reason) =>
  logger.error({ reason: reason?.message ?? reason }, 'Unhandled rejection in worker'),
)

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception in worker')
  process.exit(1)
})

export { worker }
