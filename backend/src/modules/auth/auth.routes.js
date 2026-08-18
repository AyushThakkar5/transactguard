/**
 * Route table for /api/v1/auth. Wiring only — method, path, middleware chain,
 * controller. No logic in this file.
 */

import { Router } from 'express'
import * as authController from './auth.controller.js'
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  updateRoleSchema,
  userIdParamSchema,
} from './auth.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { demoAccountLimit } from '../../middleware/demoAccountLimit.js'

const router = Router()

// The two unauthenticated endpoints are the ones worth throttling: 5 requests
// per minute per IP, counted in Redis. Separate key prefixes so a burst of
// registrations does not consume the login budget.
const registerLimiter = rateLimit({ max: 5, windowSeconds: 60, keyPrefix: 'rl:register' })
const loginLimiter = rateLimit({ max: 5, windowSeconds: 60, keyPrefix: 'rl:login' })

router.post('/register', registerLimiter, validate(registerSchema), authController.register)
// demoAccountLimit runs after validate() so it sees the normalised email, and
// is a no-op for every account except the public demo one.
router.post('/login', loginLimiter, validate(loginSchema), demoAccountLimit, authController.login)
router.post('/refresh', validate(refreshSchema), authController.refresh)
router.post('/logout', authenticate, validate(logoutSchema), authController.logout)

// Protected reads. /me is any authenticated role; /users is ADMIN only and is
// what exercises the requireRole gate end to end.
router.get('/me', authenticate, authController.me)
router.get('/users', authenticate, requireRole('ADMIN'), authController.listUsers)

// Role changes are admin-only, and the service refuses to grant ADMIN, to touch
// an existing ADMIN, or to let anyone change their own role.
router.patch(
  '/users/:id/role',
  authenticate,
  requireRole('ADMIN'),
  validate(userIdParamSchema, 'params'),
  validate(updateRoleSchema),
  authController.updateUserRole,
)

export default router
