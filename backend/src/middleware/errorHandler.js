/**
 * Centralised error handling — mounted last in app.js.
 *
 * Everything that goes wrong anywhere in the app funnels through here and comes
 * out in one shape:
 *
 *   { success: false, error: { code, message, details? } }
 *
 * Errors we raised on purpose (ApiError) keep their message. Anything else is a
 * genuine crash: it is logged in full, but the client is told only "Internal
 * server error" so stack traces and driver internals never leak.
 */

import { ZodError } from 'zod'
import { ApiError, sendError } from '../utils/response.js'
import { logger } from '../utils/logger.js'
import { isProduction } from '../config/env.js'

/** 404 for unmatched routes. Mount directly before errorHandler. */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Cannot ${req.method} ${req.originalUrl}`))
}

function normalise(err) {
  if (err instanceof ApiError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message, details: err.details }
  }

  // A Zod error that escaped the validate() middleware (e.g. thrown in a service).
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message, code: i.code })),
    }
  }

  // Malformed JSON body — thrown by express.json().
  if (err.type === 'entity.parse.failed') {
    return { statusCode: 400, code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' }
  }

  if (err.type === 'entity.too.large') {
    return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' }
  }

  // Prisma error codes worth translating rather than swallowing as a 500.
  switch (err.code) {
    case 'P2002':
      return {
        statusCode: 409,
        code: 'UNIQUE_CONSTRAINT',
        message: 'A record with that value already exists',
        details: { fields: err.meta?.target },
      }
    case 'P2025':
      return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' }
    case 'P2003':
      return { statusCode: 400, code: 'FOREIGN_KEY_CONSTRAINT', message: 'Referenced record does not exist' }
    default:
      break
  }

  // Cannot reach Postgres / Redis.
  if (err.code === 'ECONNREFUSED' || err.name === 'PrismaClientInitializationError') {
    return { statusCode: 503, code: 'SERVICE_UNAVAILABLE', message: 'A backing service is unavailable' }
  }

  return { statusCode: 500, code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }
}

// Express identifies an error handler by its four-parameter signature, so
// `next` must stay in the list even though it is unused.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const { statusCode, code, message, details } = normalise(err)

  const context = {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    userId: req.user?.id,
    ip: req.ip,
  }

  if (statusCode >= 500) {
    logger.error({ ...context, err: { message: err.message, stack: err.stack } }, 'Request failed')
  } else {
    logger.warn(context, message)
  }

  // Unexpected 500s reveal nothing in production; in development the real
  // message is included so the failure is debuggable.
  const clientMessage = statusCode >= 500 && !isProduction ? err.message || message : message

  return sendError(res, { statusCode, code, message: clientMessage, details })
}

export default errorHandler
