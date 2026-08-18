/**
 * BullMQ queue wiring.
 *
 * The API process owns a Queue (it only enqueues); the worker process owns a
 * Worker (it only consumes). Both are constructed from the factory here so the
 * connection settings and retry policy are defined once.
 */

import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { env } from './env.js'
import { moduleLogger } from '../utils/logger.js'

const log = moduleLogger('queue')

export const BATCH_SCORING_QUEUE = 'batch-scoring'

/** Transaction ids per queue job. One job per chunk, not one per transaction. */
export const CHUNK_SIZE = 100

/** Chunks processed in parallel by a single worker. */
export const WORKER_CONCURRENCY = 5

/**
 * Retry policy for a chunk.
 *
 * Three attempts with exponential backoff (2s, 4s, 8s) so a brief ML-service
 * hiccup resolves itself rather than failing a chunk permanently. Only
 * infrastructure errors reach this — the worker counts per-transaction problems
 * and carries on, so retries never re-score rows that already succeeded.
 */
export const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  // Keep a bounded history: enough to inspect recent runs, not enough to grow
  // without limit.
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

/**
 * Build a Redis connection for BullMQ.
 *
 * Deliberately separate from the shared client in config/redis.js: BullMQ holds
 * connections open on blocking commands (BRPOPLPUSH and friends), which would
 * stall the token denylist and rate limiter if they shared a socket.
 *
 * maxRetriesPerRequest must be null — BullMQ requires it, and config/redis.js
 * already sets the same for this reason.
 */
export function createQueueConnection() {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}

let queueInstance = null
let queueConnection = null

/**
 * The batch-scoring queue, created on first use.
 *
 * Lazy so that importing this module (as the worker does, for its constants)
 * does not open a producer connection in a process that will never enqueue.
 */
export function getBatchScoringQueue() {
  if (!queueInstance) {
    queueConnection = createQueueConnection()
    queueInstance = new Queue(BATCH_SCORING_QUEUE, {
      connection: queueConnection,
      defaultJobOptions: JOB_OPTIONS,
    })
    queueConnection.on('error', (err) => log.error({ err: err.message }, 'Queue connection error'))
    log.info({ queue: BATCH_SCORING_QUEUE }, 'Batch scoring queue ready')
  }
  return queueInstance
}

export async function closeQueue() {
  if (queueInstance) {
    await queueInstance.close()
    queueInstance = null
  }
  if (queueConnection) {
    await queueConnection.quit()
    queueConnection = null
  }
  log.info('Queue closed')
}

/** Split an array into fixed-size chunks. */
export function chunk(items, size = CHUNK_SIZE) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
