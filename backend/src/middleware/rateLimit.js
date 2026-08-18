/**
 * Redis-backed fixed-window rate limiter.
 *
 * Counting lives in Redis rather than process memory so the limit still holds
 * once the API runs as more than one instance.
 *
 * INCR and TTL go out in a single MULTI round-trip; the key gets its expiry the
 * first time it is created, and the whole window then evaporates on its own.
 */

import { redis, withTimeout } from '../config/redis.js'
import { ApiError } from '../utils/response.js'
import { moduleLogger } from '../utils/logger.js'

const log = moduleLogger('rate-limit')

/**
 * @param {object}  [options]
 * @param {number}  [options.max=5]             requests allowed per window
 * @param {number}  [options.windowSeconds=60]  window length
 * @param {string}  [options.keyPrefix='rl']    namespace, keeps routes independent
 */
export function rateLimit({ max = 5, windowSeconds = 60, keyPrefix = 'rl' } = {}) {
  return async function rateLimiter(req, res, next) {
    // req.ip reads X-Forwarded-For only when 'trust proxy' is enabled in app.js.
    // It is off by default, so this cannot be spoofed by a header in local dev.
    const identifier = req.ip || req.socket?.remoteAddress || 'unknown'
    const key = `${keyPrefix}:${identifier}`

    let count
    let ttl

    try {
      // Timed out rather than awaited bare: an unreachable Redis queues
      // commands indefinitely, which would hang the login route instead of
      // falling through to the fail-open branch below.
      const results = await withTimeout(redis.multi().incr(key).ttl(key).exec(), 'INCR+TTL')
      count = results[0][1]
      ttl = results[1][1]

      // -1 means the key exists with no expiry: this is the first hit of a new
      // window (or a key that somehow lost its TTL), so stamp one on.
      if (ttl < 0) {
        await withTimeout(redis.expire(key, windowSeconds), 'EXPIRE')
        ttl = windowSeconds
      }
    } catch (err) {
      // Fail open. A Redis outage should not lock every user out of logging in,
      // but it must be loud, because the endpoint is unprotected until it heals.
      log.error({ err: err.message, key }, 'Rate limiter unavailable — allowing request through')
      return next()
    }

    res.setHeader('RateLimit-Limit', max)
    res.setHeader('RateLimit-Remaining', Math.max(0, max - count))
    res.setHeader('RateLimit-Reset', ttl)

    if (count > max) {
      res.setHeader('Retry-After', ttl)
      log.warn({ identifier, path: req.originalUrl, count }, 'Rate limit exceeded')
      throw ApiError.tooManyRequests(
        `Too many requests. Try again in ${ttl} second${ttl === 1 ? '' : 's'}.`,
        { limit: max, windowSeconds, retryAfterSeconds: ttl },
      )
    }

    next()
  }
}

export default rateLimit
