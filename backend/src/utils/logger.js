/**
 * Application logger (pino).
 *
 * Redaction is not cosmetic here — TransactGuard handles credentials and, later,
 * payment records. Anything on the redact list is replaced with [REDACTED]
 * before it can reach a log sink.
 */

import pino from 'pino'
import { env, isProduction } from '../config/env.js'

export const logger = pino({
  level: isProduction ? 'info' : 'debug',

  redact: {
    paths: [
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'req.headers.authorization',
      'req.headers.cookie',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },

  base: { service: 'transactguard-api', env: env.NODE_ENV },

  // Structured JSON in production (machine-readable for log shipping),
  // human-readable colour output while developing.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
          },
        },
      }),
})

/** Child logger tagged with a subsystem name, e.g. logger.child({ module: 'auth' }). */
export function moduleLogger(name) {
  return logger.child({ module: name })
}
