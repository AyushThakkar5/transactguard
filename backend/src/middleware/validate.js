/**
 * Zod validation middleware factory.
 *
 *   router.post('/login', validate(loginSchema), controller.login)
 *
 * On success the parsed (and coerced/stripped) value replaces req.body, so
 * handlers downstream only ever see data that matched the schema. On failure it
 * throws a 400 carrying a field-by-field breakdown.
 */

import { ApiError } from '../utils/response.js'

export function validate(schema, source = 'body') {
  return function validateRequest(req, _res, next) {
    // Express 5 leaves req.body undefined when the request carries no body.
    // Substituting {} means a bodyless request to a route with only optional
    // fields succeeds, and one to a route with required fields gets a proper
    // field-by-field 400 instead of "expected object, received undefined".
    const input = source === 'body' && req.body === undefined ? {} : req[source]

    const result = schema.safeParse(input)

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
        code: issue.code,
      }))
      throw ApiError.validation(details)
    }

    // req.query and req.params are getters in Express 5 and cannot be
    // reassigned, so only req.body is replaced in place. The parsed value is
    // always available on req.validated regardless of source.
    if (source === 'body') req.body = result.data
    req.validated = result.data

    next()
  }
}

export default validate
