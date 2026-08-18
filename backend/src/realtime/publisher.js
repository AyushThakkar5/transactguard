/**
 * Redis pub/sub publisher — used by whichever process produces an event.
 *
 * The batch worker runs as a separate OS process from the Express server that
 * holds the browser socket connections, so it has no Socket.IO instance to emit
 * on. It publishes here instead; the Express process subscribes (see
 * subscriber.js) and re-broadcasts to the rooms.
 *
 * Every publish is best-effort. Real-time progress is a convenience on top of
 * state that is already durable in Postgres — a Redis outage must never fail a
 * batch job or a simulator run, so failures are logged and swallowed.
 */

import IORedis from 'ioredis'
import { env } from '../config/env.js'
import { moduleLogger } from '../utils/logger.js'

const log = moduleLogger('realtime:pub')

/** Per-job channel, so a subscriber can pattern-match rather than filter. */
export const jobChannel = (jobId) => `tg:job:${jobId}`
export const JOB_CHANNEL_PATTERN = 'tg:job:*'

/** Single channel for the live feed — every client in the `feed` room sees all of it. */
export const FEED_CHANNEL = 'tg:feed'

export const EVENTS = {
  JOB_PROGRESS: 'job:progress',
  JOB_COMPLETED: 'job:completed',
  FEED_PREDICTION: 'feed:prediction',
}

let publisher = null

/**
 * Dedicated connection.
 *
 * Not the shared client from config/redis.js: that one wraps every command in a
 * 2s timeout meant for the token denylist, and it is the connection the rate
 * limiter depends on. Publishing is fire-and-forget and should not contend
 * with either.
 */
function getPublisher() {
  if (!publisher) {
    publisher = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      // Fail fast rather than pile up undeliverable events in memory. The
      // trade-off is that a publish issued before the socket is up is dropped,
      // which is what initPublisher() below exists to prevent.
      enableOfflineQueue: false,
    })
    publisher.on('error', (err) =>
      log.warn({ err: err.message }, 'Realtime publisher connection error'),
    )
  }
  return publisher
}

/**
 * Open the connection up front and wait for it to be usable.
 *
 * Without this the connection is created lazily by the first publish — and with
 * the offline queue disabled, every event fired during the ~100ms handshake is
 * rejected outright. In practice that silently dropped the opening chunks of the
 * first batch job after a worker restart, which is precisely when someone is
 * most likely to be watching.
 *
 * Never throws: a Redis that is down at boot must not stop the worker from
 * scoring or the API from serving.
 *
 * @param {number} timeoutMs how long to wait for the socket to become ready
 */
export async function initPublisher(timeoutMs = 5000) {
  const client = getPublisher()
  if (client.status === 'ready') return true

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out')), timeoutMs)
      const done = (err) => {
        clearTimeout(timer)
        client.off('ready', onReady)
        client.off('error', onError)
        err ? reject(err) : resolve()
      }
      const onReady = () => done()
      const onError = (err) => done(err)
      client.once('ready', onReady)
      client.once('error', onError)
    })
    log.info('Realtime publisher connected')
    return true
  } catch (err) {
    log.warn(
      { err: err.message },
      'Realtime publisher not ready — events will be dropped until Redis recovers',
    )
    return false
  }
}

async function publish(channel, payload) {
  try {
    await getPublisher().publish(channel, JSON.stringify(payload))
    return true
  } catch (err) {
    // Swallowed on purpose — see the module comment.
    log.warn({ err: err.message, channel, event: payload?.event }, 'Realtime publish failed (ignored)')
    return false
  }
}

/**
 * Progress after a chunk lands.
 * @param {object} job the freshly-updated BatchJob row
 */
export function publishJobProgress(job) {
  return publish(jobChannel(job.id), {
    event: EVENTS.JOB_PROGRESS,
    data: {
      jobId: job.id,
      processedCount: job.processedCount,
      failedCount: job.failedCount,
      totalTxns: job.totalTxns,
      status: job.status,
    },
  })
}

/**
 * Fired once, by whichever worker finalised the job.
 * @param {object} job the BatchJob row
 * @param {string} status its terminal status
 */
export function publishJobCompleted(job, status) {
  return publish(jobChannel(job.id), {
    event: EVENTS.JOB_COMPLETED,
    data: {
      jobId: job.id,
      status,
      processedCount: job.processedCount,
      failedCount: job.failedCount,
    },
  })
}

/** One freshly-scored transaction from the simulator. */
export function publishFeedPrediction({ transaction, prediction }) {
  return publish(FEED_CHANNEL, {
    event: EVENTS.FEED_PREDICTION,
    data: {
      // The UUID travels alongside the human-readable txn_id so a feed row can
      // open the detail drawer directly, without a lookup round-trip.
      transactionId: transaction.id,
      txnId: transaction.txnId,
      amount: Number(transaction.amount),
      txnType: transaction.txnType,
      riskScore: prediction.riskScore,
      riskLevel: prediction.riskLevel,
      explanationSummary: prediction.explanationSummary,
    },
  })
}

export async function closePublisher() {
  if (publisher) {
    await publisher.quit().catch(() => {})
    publisher = null
    log.info('Realtime publisher closed')
  }
}
