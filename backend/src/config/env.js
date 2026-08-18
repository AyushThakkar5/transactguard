/**
 * Environment loading and validation.
 *
 * This module is imported (directly or transitively) by everything else, so it
 * runs first. If anything is missing or malformed the process exits here with a
 * readable report rather than throwing an obscure error on the first request.
 *
 * Note this file deliberately uses console.error rather than the pino logger —
 * the logger itself depends on NODE_ENV, so it cannot exist yet.
 */

import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    }),

  REDIS_URL: z
    .string()
    .min(1, 'REDIS_URL is required')
    .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
      message: 'REDIS_URL must be a redis:// or rediss:// connection string',
    }),

  // 32 chars is the floor for a secret that is guarding money movement.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  // --- ML service (Step 4) ------------------------------------------------
  // Reached server-to-server only; the browser never talks to it directly.
  ML_SERVICE_URL: z.url('ML_SERVICE_URL must be a valid URL').default('http://localhost:8000'),

  // Must match INTERNAL_API_KEY in ml_service/.env — the two services share
  // this one secret.
  ML_SERVICE_API_KEY: z.string().min(16, 'ML_SERVICE_API_KEY must be at least 16 characters'),

  /**
   * Comma-separated origins allowed to call the API from a browser.
   *
   * Empty means "reflect any origin", which is the right default for local
   * development and wrong for anything deployed — so production without this
   * set is treated as a misconfiguration rather than silently permissive.
   */
  ALLOWED_ORIGIN: z.string().default(''),

  /**
   * Run the BullMQ consumer inside this process instead of a separate one.
   *
   * Off by default, because a dedicated worker process is the better design —
   * scoring a large batch does not then compete with request handling. It
   * exists because Render's free tier offers no Background Worker service type,
   * so on free hosting this is the only way to consume the queue at all.
   */
  RUN_WORKER_INLINE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('\n  Invalid environment configuration:\n')
  for (const issue of parsed.error.issues) {
    console.error(`   • ${issue.path.join('.')}: ${issue.message}`)
  }
  console.error('\n  Copy backend/.env.example to backend/.env and fill in the blanks.\n')
  process.exit(1)
}

// Reusing one secret for both token kinds would let a refresh token be replayed
// as an access token, so this is a hard failure rather than a warning.
if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  console.error('\n  JWT_SECRET and JWT_REFRESH_SECRET must be different values.\n')
  process.exit(1)
}

export const env = Object.freeze(parsed.data)

export const isProduction = env.NODE_ENV === 'production'

/** Parsed allow-list. Empty array means "no restriction configured". */
export const allowedOrigins = env.ALLOWED_ORIGIN
  ? env.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : []

if (isProduction && allowedOrigins.length === 0) {
  console.error(
    '\n  ALLOWED_ORIGIN is not set while NODE_ENV=production.\n\n' +
      '  Set it to your frontend origin, e.g.\n' +
      '    ALLOWED_ORIGIN="https://transactguard.vercel.app"\n\n' +
      '  Refusing to start with an open CORS policy in production.\n',
  )
  process.exit(1)
}
export const isDevelopment = env.NODE_ENV === 'development'
