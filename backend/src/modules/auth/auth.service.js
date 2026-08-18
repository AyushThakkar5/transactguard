/**
 * Auth business logic. Everything that touches bcrypt, Prisma or Redis lives
 * here; the controller never does.
 */

import bcrypt from 'bcrypt'
import { prisma } from '../../config/db.js'
import { isTokenRevoked, revokeToken } from '../../config/redis.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  issueTokenPair,
  secondsUntilExpiry,
  signAccessToken,
  verifyRefreshToken,
} from '../../utils/tokens.js'

const log = moduleLogger('auth')

const SALT_ROUNDS = 12

/** Columns safe to return over the wire — passwordHash is never among them. */
const PUBLIC_USER = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
}

/**
 * A throwaway hash of a random value, compared against when no user matches.
 * Without it, "email not found" returns in ~1ms while "wrong password" takes
 * ~250ms, and that gap alone tells an attacker which emails are registered.
 */
const TIMING_SAFE_DUMMY_HASH = '$2b$12$EpMqNtaMGrhNWtzY5/tZ8OisxCS.YA4q9LvkARsDZWH4g4lquXbce'

/** Deliberately vague: never confirm which half of the pair was wrong. */
function invalidCredentials() {
  return ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS')
}

function toPublicUser(user) {
  const { passwordHash, ...rest } = user
  return rest
}

/**
 * Append to the audit trail.
 *
 * Failures are logged but never propagated: the caller's action has already
 * succeeded by this point, and turning a successful registration into a 500
 * would leave the client unable to retry (the email is taken) with no account
 * to show for it.
 */
async function recordAudit({ userId, action, resourceType, resourceId, ipAddress, metadata }) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, resourceType, resourceId, ipAddress, metadata },
    })
  } catch (err) {
    log.error({ err: err.message, action, userId }, 'Failed to write audit log entry')
  }
}

/**
 * Create an account.
 * @throws {ApiError} 409 when the email is already registered
 */
export async function registerUser({ name, email, password, role }, ctx = {}) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) {
    throw ApiError.conflict('An account with that email already exists', 'EMAIL_TAKEN')
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  // A concurrent request could still slip in between the check above and this
  // insert; the unique index catches it and errorHandler maps P2002 to a 409.
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
    select: PUBLIC_USER,
  })

  await recordAudit({
    userId: user.id,
    action: 'USER_REGISTERED',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: ctx.ipAddress,
    metadata: { role: user.role },
  })

  log.info({ userId: user.id, role: user.role }, 'User registered')
  return user
}

/**
 * Verify credentials and mint a token pair.
 * @throws {ApiError} 401 on bad credentials, 403 when the account is disabled
 */
export async function loginUser({ email, password }, ctx = {}) {
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) {
    await bcrypt.compare(password, TIMING_SAFE_DUMMY_HASH)
    await recordAudit({
      action: 'LOGIN_FAILED',
      resourceType: 'User',
      ipAddress: ctx.ipAddress,
      metadata: { email, reason: 'NO_SUCH_USER' },
    })
    throw invalidCredentials()
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash)
  if (!passwordMatches) {
    await recordAudit({
      userId: user.id,
      action: 'LOGIN_FAILED',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: ctx.ipAddress,
      metadata: { reason: 'BAD_PASSWORD' },
    })
    throw invalidCredentials()
  }

  // Checked after the password so a disabled account cannot be distinguished
  // from a wrong password by anyone who does not already know the password.
  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated')
  }

  const { access, refresh } = issueTokenPair(user)

  await recordAudit({
    userId: user.id,
    action: 'USER_LOGIN',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: ctx.ipAddress,
    metadata: { userAgent: ctx.userAgent },
  })

  log.info({ userId: user.id }, 'User logged in')

  return {
    user: toPublicUser(user),
    tokens: {
      accessToken: access.token,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      accessTokenExpiresIn: ACCESS_TOKEN_TTL,
      refreshTokenExpiresIn: REFRESH_TOKEN_TTL,
    },
  }
}

/**
 * Exchange a valid refresh token for a fresh access token.
 *
 * The refresh token itself is not rotated — it stays valid for its full 7 days.
 * Rotation (issuing a new refresh token and revoking the old one on every use)
 * is the stronger design and a natural follow-up.
 */
export async function refreshAccessToken({ refreshToken }, ctx = {}) {
  const payload = verifyRefreshToken(refreshToken)

  if (await isTokenRevoked(payload.jti)) {
    throw ApiError.unauthorized('Refresh token has been revoked', 'TOKEN_REVOKED')
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Account is no longer active', 'ACCOUNT_INACTIVE')
  }

  const access = signAccessToken(user)

  await recordAudit({
    userId: user.id,
    action: 'TOKEN_REFRESHED',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: ctx.ipAddress,
  })

  return {
    accessToken: access.token,
    tokenType: 'Bearer',
    accessTokenExpiresIn: ACCESS_TOKEN_TTL,
  }
}

/**
 * Revoke the caller's tokens.
 *
 * The access token's jti goes on the Redis denylist with a TTL matching what is
 * left of its life. If the client also sends its refresh token it is revoked
 * too — otherwise logout would only close the 15-minute window while leaving
 * the client free to mint a new access token straight afterwards.
 */
export async function logoutUser({ user, refreshToken }, ctx = {}) {
  const revoked = { accessToken: false, refreshToken: false }

  revoked.accessToken = await revokeToken(user.jti, secondsUntilExpiry({ exp: user.exp }))

  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken)
      // Only honour a refresh token belonging to the caller.
      if (payload.sub === user.id) {
        revoked.refreshToken = await revokeToken(payload.jti, secondsUntilExpiry(payload))
      }
    } catch {
      // An expired or malformed refresh token is not worth failing logout over —
      // it is already unusable, and logout should be idempotent.
    }
  }

  await recordAudit({
    userId: user.id,
    action: 'USER_LOGOUT',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: ctx.ipAddress,
    metadata: revoked,
  })

  log.info({ userId: user.id, ...revoked }, 'User logged out')
  return revoked
}

/** The authenticated user's own record. */
export async function getUserById(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER })
  if (!user) throw ApiError.notFound('User not found')
  return user
}

/** Every account. Guarded by requireRole('ADMIN') at the route. */
export async function listUsers() {
  return prisma.user.findMany({ select: PUBLIC_USER, orderBy: { createdAt: 'desc' } })
}

/** Roles an admin may assign through the API. ADMIN is deliberately absent. */
export const ASSIGNABLE_ROLES = ['ANALYST', 'VIEWER']

/**
 * Change another user's role.
 *
 * Three refusals, each closing a different hole:
 *
 *   · the target role can only be ANALYST or VIEWER. Granting ADMIN over HTTP
 *     would turn any single compromised admin session into permanent, silent
 *     privilege escalation. Promotion stays a deliberate database action.
 *   · an existing ADMIN cannot be changed. Otherwise one admin could quietly
 *     demote every other admin, and a two-admin system could be captured by
 *     whoever moves first.
 *   · nobody can change their own role. Self-demotion is the easiest way to
 *     lock the last admin out of the system entirely.
 *
 * @throws {ApiError} 400 bad target role, 403 protected target, 404 unknown user
 */
export async function updateUserRole(userId, role, actor, ctx = {}) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw ApiError.badRequest(
      `Role must be one of ${ASSIGNABLE_ROLES.join(' or ')}. Granting ADMIN is not available through the API.`,
      { assignable: ASSIGNABLE_ROLES },
    )
  }

  if (userId === actor.id) {
    throw ApiError.forbidden('You cannot change your own role.')
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  })
  if (!target) throw ApiError.notFound('User not found')

  if (target.role === 'ADMIN') {
    throw ApiError.forbidden(
      'Administrator roles cannot be changed through the API. Update the database directly if this is intended.',
    )
  }

  if (target.role === role) {
    // Nothing to do — return current state rather than writing a no-op audit row.
    return prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER })
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role },
    select: PUBLIC_USER,
  })

  await recordAudit({
    userId: actor.id,
    action: 'USER_ROLE_CHANGED',
    resourceType: 'User',
    resourceId: userId,
    ipAddress: ctx.ipAddress,
    metadata: { targetEmail: target.email, from: target.role, to: role },
  })

  log.info({ actorId: actor.id, targetId: userId, from: target.role, to: role }, 'User role changed')
  return updated
}
