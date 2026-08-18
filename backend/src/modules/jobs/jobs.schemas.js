/**
 * Zod schemas for the batch jobs module. Validation rules only.
 */

import { z } from 'zod'

export const BATCH_JOB_STATUSES = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
]

/**
 * Ceiling on a single job. Beyond this the caller should split the work, both
 * to keep the enqueue request quick and to keep one runaway job from monopolising
 * the worker pool.
 */
export const MAX_TRANSACTIONS_PER_JOB = 20_000

const dateInput = z.coerce.date({ message: 'Must be a valid date (ISO 8601 recommended)' })

export const createJobSchema = z
  .object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120),

    /** Explicit selection. Mutually exclusive with `filter`. */
    transactionIds: z
      .array(z.uuid('Each transaction id must be a UUID'))
      .max(
        MAX_TRANSACTIONS_PER_JOB,
        `A single job can cover at most ${MAX_TRANSACTIONS_PER_JOB.toLocaleString()} transactions — ` +
          'split the work across multiple jobs',
      )
      .optional(),

    /** Shortcut: every non-deleted transaction with no prediction yet. */
    filter: z.enum(['unscored']).optional(),

    /** Caps how many the `filter` shortcut picks up. Ignored with transactionIds. */
    limit: z.coerce.number().int().min(1).max(MAX_TRANSACTIONS_PER_JOB).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.transactionIds?.length) || Boolean(body.filter), {
    message: 'Provide either a non-empty `transactionIds` array or `filter: "unscored"`',
    path: ['transactionIds'],
  })
  .refine((body) => !(body.transactionIds?.length && body.filter), {
    message: 'Provide `transactionIds` or `filter`, not both',
    path: ['filter'],
  })

export const listJobsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),
    status: z.enum(BATCH_JOB_STATUSES).optional(),
    from: dateInput.optional(),
    to: dateInput.optional(),
    sortBy: z.enum(['createdAt', 'completedAt', 'name']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })

export const jobIdParamSchema = z.object({
  id: z.uuid('Job id must be a UUID'),
})
