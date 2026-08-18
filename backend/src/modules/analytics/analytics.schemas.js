/** Zod schemas for the analytics module. Validation only. */

import { z } from 'zod'

export const summaryQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(90).default(7),
})

export const trendQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(31),
})

export const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(6),
})

export const scatterQuerySchema = z.object({
  txnType: z.enum(['TRANSFER', 'CASH_OUT', 'PAYMENT', 'CASH_IN', 'DEBIT']).optional(),
  riskLevel: z.enum(['CLEAR', 'SUSPICIOUS', 'CRITICAL']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).max(120).optional(),
  // Canvas handles a few thousand points comfortably; beyond that the plot is
  // unreadable long before it is slow.
  limit: z.coerce.number().int().min(100).max(5000).default(3000),
})

export const networkQuerySchema = z.object({
  limit: z.coerce.number().int().min(10).max(400).default(60),
})
