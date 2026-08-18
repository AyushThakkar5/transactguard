/**
 * Zod schemas for the predictions module. Validation rules only.
 */

import { z } from 'zod'

export const RISK_LEVELS = ['CLEAR', 'SUSPICIOUS', 'CRITICAL']

const dateInput = z.coerce.date({ message: 'Must be a valid date (ISO 8601 recommended)' })

export const listPredictionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),

    riskLevel: z.enum(RISK_LEVELS).optional(),

    // Bound the prediction's own created_at — i.e. when it was scored, not when
    // the underlying transaction happened.
    from: dateInput.optional(),
    to: dateInput.optional(),

    minScore: z.coerce.number().int().min(0).max(100).optional(),
    maxScore: z.coerce.number().int().min(0).max(100).optional(),

    /** Substring match against the related transaction's txn_id. */
    search: z.string().trim().min(1).max(120).optional(),

    sortBy: z.enum(['createdAt', 'riskScore']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })
  .refine((q) => q.minScore === undefined || q.maxScore === undefined || q.minScore <= q.maxScore, {
    message: '`minScore` must be less than or equal to `maxScore`',
    path: ['minScore'],
  })

export const predictionIdParamSchema = z.object({
  id: z.uuid('Prediction id must be a UUID'),
})

export const transactionIdParamSchema = z.object({
  transactionId: z.uuid('Transaction id must be a UUID'),
})

/**
 * The ML service's response contract, validated on arrival.
 *
 * This is a trust boundary: the scorer is a separate service that will be
 * swapped for a real model in Step 8. Parsing its output rather than assuming
 * it means a contract drift surfaces as a clear 502 naming the offending field,
 * instead of a null risk_score quietly reaching the Prediction table.
 */
export const mlPredictionResponseSchema = z.object({
  txn_id: z.string().min(1),
  risk_score: z.number().int().min(0).max(100),
  risk_level: z.enum(RISK_LEVELS),
  explanation_summary: z.string(),
  feature_contributions: z.array(
    z.object({
      factor: z.string(),
      description: z.string(),
      magnitude: z.number(),
      // weight/contribution are present in rule-based-v1 but are not required —
      // a future model may express its explanations differently.
      weight: z.number().optional(),
      contribution: z.number().optional(),
    }),
  ),
  model_version: z.string().min(1),
  latency_ms: z.number().int().nonnegative(),
})
