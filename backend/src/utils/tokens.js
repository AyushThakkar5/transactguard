/**
 * JWT minting and verification.
 *
 * Access tokens live 15 minutes and carry identity + role, so authorisation
 * needs no database round-trip. Refresh tokens live 7 days, are signed with a
 * different secret, and carry nothing but a subject.
 *
 * Every token gets a `jti` so it can be revoked individually via the Redis
 * denylist (see config/redis.js).
 */

import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { ApiError } from './response.js'

export const ACCESS_TOKEN_TTL = '15m'
export const REFRESH_TOKEN_TTL = '7d'

const ISSUER = 'transactguard'
const AUDIENCE = 'transactguard-api'

/**
 * @param {{ id: string, email: string, role: string }} user
 * @returns {{ token: string, jti: string, expiresIn: string }}
 */
export function signAccessToken(user) {
  const jti = randomUUID()
  const token = jwt.sign({ email: user.email, role: user.role, type: 'access' }, env.JWT_SECRET, {
    subject: user.id,
    jwtid: jti,
    expiresIn: ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  return { token, jti, expiresIn: ACCESS_TOKEN_TTL }
}

/**
 * @param {{ id: string }} user
 * @returns {{ token: string, jti: string, expiresIn: string }}
 */
export function signRefreshToken(user) {
  const jti = randomUUID()
  const token = jwt.sign({ type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    subject: user.id,
    jwtid: jti,
    expiresIn: REFRESH_TOKEN_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  return { token, jti, expiresIn: REFRESH_TOKEN_TTL }
}

/** Mint both tokens for a user in one call. */
export function issueTokenPair(user) {
  return { access: signAccessToken(user), refresh: signRefreshToken(user) }
}

function verify(token, secret, expectedType) {
  let payload
  try {
    payload = jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE })
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Token has expired', 'TOKEN_EXPIRED')
    }
    throw ApiError.unauthorized('Invalid token', 'TOKEN_INVALID')
  }

  // Without this check an access token would be accepted by /refresh and vice
  // versa. The differing secrets already prevent it; this makes it explicit.
  if (payload.type !== expectedType) {
    throw ApiError.unauthorized(`Expected a ${expectedType} token`, 'TOKEN_WRONG_TYPE')
  }
  return payload
}

export function verifyAccessToken(token) {
  return verify(token, env.JWT_SECRET, 'access')
}

export function verifyRefreshToken(token) {
  return verify(token, env.JWT_REFRESH_SECRET, 'refresh')
}

/**
 * Seconds of life left on a decoded token, floored at 0.
 * Used to size the denylist TTL so revocation entries expire with the token.
 */
export function secondsUntilExpiry(payload) {
  if (!payload?.exp) return 0
  return Math.max(0, payload.exp - Math.floor(Date.now() / 1000))
}

/** Pull the bearer token out of an Authorization header, or null. */
export function extractBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null
  const [scheme, token] = headerValue.split(' ')
  if (!token || scheme.toLowerCase() !== 'bearer') return null
  return token.trim() || null
}
