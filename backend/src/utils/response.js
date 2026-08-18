/**
 * Response envelope + the error type the whole app throws.
 *
 * Every successful response is  { success: true, data: ... }
 * Every failed response is      { success: false, error: { code, message, details? } }
 *
 * Controllers and services throw ApiError; errorHandler.js is the single place
 * that turns one into an HTTP response.
 */

export class ApiError extends Error {
  /**
   * @param {number} statusCode  HTTP status
   * @param {string} code        stable machine-readable code, e.g. 'EMAIL_TAKEN'
   * @param {string} message     human-readable message, safe to show a client
   * @param {unknown} [details]  optional extra context (validation issues, etc.)
   */
  constructor(statusCode, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
    // Marks errors we raised on purpose, so errorHandler can distinguish them
    // from genuine crashes and avoid leaking internals for the latter.
    this.isOperational = true
    Error.captureStackTrace?.(this, ApiError)
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, 'BAD_REQUEST', message, details)
  }

  static validation(details, message = 'Validation failed') {
    return new ApiError(400, 'VALIDATION_ERROR', message, details)
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message)
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new ApiError(403, 'FORBIDDEN', message)
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, 'NOT_FOUND', message)
  }

  static conflict(message = 'Resource already exists', code = 'CONFLICT') {
    return new ApiError(409, code, message)
  }

  static tooManyRequests(message = 'Too many requests', details) {
    return new ApiError(429, 'RATE_LIMITED', message, details)
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL_SERVER_ERROR', message)
  }

  static serviceUnavailable(message = 'Service unavailable', details) {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message, details)
  }
}

/** Send a success envelope. */
export function sendSuccess(res, data, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data })
}

/** Send an error envelope. Used by errorHandler; prefer throwing ApiError elsewhere. */
export function sendError(res, { statusCode = 500, code = 'INTERNAL_SERVER_ERROR', message, details }) {
  const body = { success: false, error: { code, message } }
  if (details !== undefined) body.error.details = details
  return res.status(statusCode).json(body)
}
