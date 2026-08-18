/**
 * Redis connection + the JWT denylist.
 *
 * Two jobs today: revoked-token storage for logout, and the counters behind the
 * rate limiter. BullMQ queues will share this same connection later, which is
 * why maxRetriesPerRequest is null — BullMQ requires that setting.
 */

import Redis from 'ioredis'
import { env } from './env.js'
import { moduleLogger } from '../utils/logger.js'
import { ApiError } from '../utils/response.js'

const log = moduleLogger('redis')

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000)
    log.warn({ attempt: times, delayMs: delay }, 'Redis connection lost, retrying')
    return delay
  },
})

redis.on('ready', () => log.info('Redis connected'))
redis.on('error', (err) => log.error({ err: err.message }, 'Redis error'))

/**
 * Bound how long a single Redis command may take.
 *
 * This is not optional. maxRetriesPerRequest: null (which BullMQ requires) tells
 * ioredis to queue commands indefinitely while the server is unreachable rather
 * than rejecting them — so without a timeout, one dead Redis silently hangs
 * every request that touches it, including /health, instead of failing.
 *
 * A blanket `commandTimeout` on the connection would be simpler but would also
 * kill BullMQ's long-lived blocking commands later, so the bound is applied per
 * call site instead.
 */
const COMMAND_TIMEOUT_MS = 2000

export function withTimeout(promise, label, ms = COMMAND_TIMEOUT_MS) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis ${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Key namespace for revoked JWT ids. */
const DENYLIST_PREFIX = 'bl:jti:'

/**
 * Revoke a token by its jti until it would have expired anyway.
 * TTL-matching is what keeps the denylist from growing without bound: once the
 * token is past its own expiry, jwt.verify rejects it and the key is gone.
 *
 * @param {string} jti
 * @param {number} ttlSeconds seconds of life remaining on the token
 */
export async function revokeToken(jti, ttlSeconds) {
  if (!jti) return false
  // Already-expired tokens need no entry — verify() will reject them regardless.
  if (ttlSeconds <= 0) return false

  try {
    await withTimeout(
      redis.set(`${DENYLIST_PREFIX}${jti}`, '1', 'EX', Math.ceil(ttlSeconds)),
      'SET denylist',
    )
    return true
  } catch (err) {
    // Reporting a successful logout while the token stays usable would be a
    // lie the client acts on, so surface the failure instead.
    log.error({ err: err.message, jti }, 'Failed to revoke token')
    throw ApiError.serviceUnavailable('Could not complete logout — please retry')
  }
}

/** @returns {Promise<boolean>} true when the token has been revoked. */
export async function isTokenRevoked(jti) {
  if (!jti) return false

  try {
    return (await withTimeout(redis.exists(`${DENYLIST_PREFIX}${jti}`), 'EXISTS denylist')) === 1
  } catch (err) {
    // Fail closed. If the denylist cannot be read we cannot tell a live token
    // from a revoked one, and honouring a revoked token on a fraud platform is
    // worse than a brief outage. Flip this to `return false` if availability
    // matters more than revocation for your deployment.
    log.error({ err: err.message, jti }, 'Denylist unreadable — rejecting request')
    throw ApiError.serviceUnavailable('Authentication is temporarily unavailable')
  }
}

/** Round-trip a PING. Used by /api/v1/health. */
export async function pingRedis() {
  const reply = await withTimeout(redis.ping(), 'PING')
  if (reply !== 'PONG') throw new Error(`Unexpected PING reply: ${reply}`)
  return true
}

export async function disconnectRedis() {
  await redis.quit()
  log.info('Redis disconnected')
}
