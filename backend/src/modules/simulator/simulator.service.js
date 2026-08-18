/**
 * Live-traffic simulator.
 *
 * Replays seeded transactions through the scorer one at a time on a timer, so
 * the Live Feed page has something moving through it. Deliberately NOT a BullMQ
 * job: a queue would drain as fast as the workers allow, and the point here is
 * a steady trickle that looks like real traffic.
 *
 * Scoring goes through Step 5's scoreAndPersist(), the same path the
 * synchronous endpoint and the batch worker use — there is one implementation
 * of "fetch, call the model, upsert".
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '../../config/db.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'
import { scoreAndPersist } from '../predictions/predictions.service.js'
import { publishFeedPrediction } from '../../realtime/publisher.js'

const log = moduleLogger('simulator')

export const MIN_TPS = 1
export const MAX_TPS = 20
export const DEFAULT_TPS = 5
export const MAX_COUNT = 500
export const DEFAULT_COUNT = 100

/**
 * The single active run, or null.
 *
 * Process-local by design: the spec is one run at a time and no concurrency, so
 * a module-level variable is the honest representation. It does mean the limit
 * is per API instance rather than truly global — the note in the README says so.
 */
let activeRun = null

function publicView(run) {
  if (!run) return null
  return {
    simulatorRunId: run.id,
    status: run.status,
    transactionsPerSecond: run.tps,
    total: run.total,
    sent: run.sent,
    scored: run.scored,
    failed: run.failed,
    remaining: run.total - run.sent,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    startedBy: run.startedBy,
  }
}

function finish(run, status) {
  if (run.timer) {
    clearInterval(run.timer)
    run.timer = null
  }
  run.status = status
  run.finishedAt = new Date().toISOString()

  log.info(
    { runId: run.id, status, sent: run.sent, scored: run.scored, failed: run.failed },
    'Simulator run finished',
  )

  // Keep the finished run visible to GET /status until another one starts.
  activeRun = run
}

/**
 * One tick: score the next transaction and push it to the feed.
 *
 * A failure here — ML service down, a row deleted since selection — is logged
 * and skipped. The run continues, because a simulator that halts on the first
 * hiccup is useless for demonstrating a live feed.
 */
async function tick(run) {
  // Guard against overlap: if scoring takes longer than the interval, skip this
  // tick rather than running two at once and drifting off the requested rate.
  if (run.inFlight) return
  if (run.cursor >= run.transactionIds.length) {
    finish(run, 'COMPLETED')
    return
  }

  run.inFlight = true
  const transactionId = run.transactionIds[run.cursor++]
  run.sent++

  try {
    const { transaction, prediction } = await scoreAndPersist(transactionId)
    run.scored++
    await publishFeedPrediction({ transaction, prediction })
  } catch (err) {
    run.failed++
    log.warn(
      { runId: run.id, transactionId, code: err.code, err: err.message },
      'Simulator skipped a transaction',
    )
  } finally {
    run.inFlight = false
    if (run.cursor >= run.transactionIds.length && run.status === 'RUNNING') {
      finish(run, 'COMPLETED')
    }
  }
}

/**
 * Start a run.
 * @throws {ApiError} 409 if one is already running, 400 if there is nothing to replay
 */
export async function startSimulator({ transactionsPerSecond, count }, user) {
  if (activeRun?.status === 'RUNNING') {
    throw ApiError.conflict(
      `A simulator run is already active (${activeRun.sent}/${activeRun.total} sent) — stop it first`,
      'SIMULATOR_ALREADY_RUNNING',
    )
  }

  const tps = transactionsPerSecond ?? DEFAULT_TPS
  const total = count ?? DEFAULT_COUNT

  // Random sample so repeated runs do not replay the same rows in the same order.
  const rows = await prisma.$queryRaw`
    SELECT id FROM transactions
    WHERE deleted_at IS NULL
    ORDER BY random()
    LIMIT ${total}
  `
  const transactionIds = rows.map((r) => r.id)

  if (transactionIds.length === 0) {
    throw ApiError.badRequest('No transactions available to replay — seed the database first')
  }

  const run = {
    id: randomUUID(),
    status: 'RUNNING',
    tps,
    total: transactionIds.length,
    transactionIds,
    cursor: 0,
    sent: 0,
    scored: 0,
    failed: 0,
    inFlight: false,
    timer: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    startedBy: { id: user.id, email: user.email },
  }

  // transactionsPerSecond is a rate: 3 means three per second, one every ~333ms.
  const intervalMs = Math.round(1000 / tps)
  run.timer = setInterval(() => {
    tick(run).catch((err) => log.error({ runId: run.id, err: err.message }, 'Simulator tick failed'))
  }, intervalMs)

  // Do not hold the event loop open on the timer alone — a pending simulator
  // should not stop the process from shutting down.
  run.timer.unref?.()

  activeRun = run

  log.info(
    { runId: run.id, tps, total: run.total, intervalMs, userId: user.id },
    'Simulator run started',
  )

  return publicView(run)
}

/** Stop the active run. */
export function stopSimulator({ simulatorRunId }) {
  if (!activeRun || activeRun.status !== 'RUNNING') {
    throw ApiError.conflict('No simulator run is currently active', 'SIMULATOR_NOT_RUNNING')
  }

  if (simulatorRunId !== activeRun.id) {
    throw ApiError.badRequest(
      'simulatorRunId does not match the active run',
      { activeRunId: activeRun.id },
    )
  }

  finish(activeRun, 'STOPPED')
  return publicView(activeRun)
}

/** Current or most recent run. */
export function getSimulatorStatus() {
  return {
    active: activeRun?.status === 'RUNNING',
    run: publicView(activeRun),
  }
}

/** Stop any running simulator — called during graceful shutdown. */
export function shutdownSimulator() {
  if (activeRun?.status === 'RUNNING') finish(activeRun, 'STOPPED')
}
