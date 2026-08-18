/**
 * HTTP layer for the auth module.
 *
 * Reads the request, calls a service, shapes the response. No bcrypt, no
 * Prisma, no Redis — if a rule needs writing, it belongs in auth.service.js.
 *
 * Express 5 catches rejected promises from async handlers, so these do not need
 * try/catch; a thrown ApiError lands in errorHandler.js on its own.
 */

import * as authService from './auth.service.js'
import { sendSuccess } from '../../utils/response.js'

/** Request metadata the audit trail records alongside each action. */
function requestContext(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') }
}

export async function register(req, res) {
  const user = await authService.registerUser(req.body, requestContext(req))
  return sendSuccess(res, { user }, 201)
}

export async function login(req, res) {
  const result = await authService.loginUser(req.body, requestContext(req))
  return sendSuccess(res, result)
}

export async function refresh(req, res) {
  const result = await authService.refreshAccessToken(req.body, requestContext(req))
  return sendSuccess(res, result)
}

export async function logout(req, res) {
  const revoked = await authService.logoutUser(
    { user: req.user, refreshToken: req.body?.refreshToken },
    requestContext(req),
  )
  return sendSuccess(res, { message: 'Logged out successfully', revoked })
}

export async function me(req, res) {
  const user = await authService.getUserById(req.user.id)
  return sendSuccess(res, { user })
}

export async function listUsers(_req, res) {
  const users = await authService.listUsers()
  return sendSuccess(res, { users, count: users.length })
}

export async function updateUserRole(req, res) {
  const user = await authService.updateUserRole(
    req.params.id,
    req.body.role,
    req.user,
    requestContext(req),
  )
  return sendSuccess(res, { user })
}
