/**
 * Bearer-token authentication.
 *
 * Verifies signature and expiry, checks the token has not been revoked, and
 * attaches req.user. Deliberately stateless — no database read per request —
 * so identity and role come from the token claims. The trade-off is that a
 * deactivated user keeps access until their 15-minute token expires; if that
 * window is ever too wide, revoke their jti at deactivation time.
 *
 * Express 5 forwards rejected promises to the error handler automatically, so
 * throwing an ApiError from here is enough.
 */

import { isTokenRevoked } from '../config/redis.js'
import { ApiError } from '../utils/response.js'
import { extractBearerToken, verifyAccessToken } from '../utils/tokens.js'

export async function authenticate(req, _res, next) {
  const token = extractBearerToken(req.headers.authorization)

  if (!token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header', 'TOKEN_MISSING')
  }

  const payload = verifyAccessToken(token)

  if (await isTokenRevoked(payload.jti)) {
    throw ApiError.unauthorized('Token has been revoked', 'TOKEN_REVOKED')
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    jti: payload.jti,
    exp: payload.exp,
  }
  req.token = token

  next()
}

export default authenticate
