/**
 * Global rate limit on the public demo account.
 *
 * Additive: it sits alongside the existing per-IP limiter on /auth/login rather
 * than replacing it, and it does nothing at all for any other account.
 *
 * The distinction matters. The IP limiter answers "is one client hammering us";
 * this answers "is the published demo credential being ground on from
 * anywhere". The counter is a single global key, not keyed by address, because
 * the thing being protected is the account, not the caller.
 *
 * Fails open, like the IP limiter it accompanies: if Redis is unreachable, a
 * reviewer should still be able to look at the demo. The event is logged so an
 * outage is visible rather than silent.
 */

import { redis, withTimeout } from '../config/redis.js'
import { ApiError } from '../utils/response.js'
import { moduleLogger } from '../utils/logger.js'
import { DEMO_EMAIL, DEMO_LOGIN_LIMIT, DEMO_LOGIN_WINDOW_SECONDS } from '../config/demo.js'

const log = moduleLogger('demo-limit')

const KEY = 'rl:demo-account:login'

/**
 * Mount after validate(loginSchema) — the schema lower-cases and trims the
 * email, so the comparison here sees a normalised value and "DEMO@..." cannot
 * slip past the check.
 */
export async function demoAccountLimit(req, res, next) {
  if (req.body?.email !== DEMO_EMAIL) return next()

  let count
  let ttl

  try {
    const results = await withTimeout(redis.multi().incr(KEY).ttl(KEY).exec(), 'demo INCR+TTL')
    count = results[0][1]
    ttl = results[1][1]

    if (ttl < 0) {
      await withTimeout(redis.expire(KEY, DEMO_LOGIN_WINDOW_SECONDS), 'demo EXPIRE')
      ttl = DEMO_LOGIN_WINDOW_SECONDS
    }
  } catch (err) {
    log.error({ err: err.message }, 'Demo limiter unavailable — allowing login through')
    return next()
  }

  res.setHeader('RateLimit-Limit', DEMO_LOGIN_LIMIT)
  res.setHeader('RateLimit-Remaining', Math.max(0, DEMO_LOGIN_LIMIT - count))
  res.setHeader('RateLimit-Reset', ttl)

  if (count > DEMO_LOGIN_LIMIT) {
    res.setHeader('Retry-After', ttl)
    log.warn({ count, ip: req.ip }, 'Demo account login limit reached')

    const minutes = Math.max(1, Math.ceil(ttl / 60))
    throw ApiError.tooManyRequests(
      `The shared demo account has reached its hourly limit. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or sign in with your own account.`,
      { limit: DEMO_LOGIN_LIMIT, windowSeconds: DEMO_LOGIN_WINDOW_SECONDS, retryAfterSeconds: ttl },
    )
  }

  return next()
}

export default demoAccountLimit
