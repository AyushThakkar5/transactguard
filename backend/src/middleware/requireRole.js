/**
 * Role gate. Must run after authenticate().
 *
 *   router.get('/users', authenticate, requireRole('ADMIN'), handler)
 *   router.post('/cases', authenticate, requireRole('ADMIN', 'ANALYST'), handler)
 */

import { ApiError } from '../utils/response.js'

export function requireRole(...roles) {
  const allowed = roles.flat()

  if (allowed.length === 0) {
    // A programming error, not a runtime one — fail at wiring time rather than
    // silently letting every role through.
    throw new Error('requireRole() needs at least one role')
  }

  return function roleGate(req, _res, next) {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required')
    }

    if (!allowed.includes(req.user.role)) {
      throw ApiError.forbidden(
        `This action requires one of the following roles: ${allowed.join(', ')}`,
      )
    }

    next()
  }
}

export default requireRole
