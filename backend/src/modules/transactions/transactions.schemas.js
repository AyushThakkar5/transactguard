/**
 * Zod schemas for the transactions module. Validation rules only.
 */

import { z } from 'zod'
import { PAYSIM_TXN_TYPES } from './paysim.mapper.js'

export const TXN_TYPES = PAYSIM_TXN_TYPES

/** Money: accepts a number or a numeric string, rejects NaN/Infinity/negatives. */
const money = z.coerce
  .number()
  .finite('Must be a finite number')
  .nonnegative('Cannot be negative')
  .max(1e15, 'Unreasonably large amount')

/** ISO date string or anything Date can parse, normalised to a Date. */
const dateInput = z.coerce.date({ message: 'Must be a valid date (ISO 8601 recommended)' })

export const createTransactionSchema = z
  .object({
    // Optional: generated server-side when absent, so a client never has to
    // invent one, but an upstream system can supply its own.
    txnId: z.string().trim().min(3).max(120).optional(),
    txnType: z.enum(TXN_TYPES),
    amount: money,
    currency: z.string().trim().length(3, 'Use a 3-letter ISO 4217 code').toUpperCase().default('USD'),
    senderId: z.string().trim().min(1, 'senderId is required').max(120),
    receiverId: z.string().trim().min(1, 'receiverId is required').max(120),
    merchantCategory: z.string().trim().max(120).nullish(),
    origBalanceBefore: money.nullish(),
    origBalanceAfter: money.nullish(),
    destBalanceBefore: money.nullish(),
    destBalanceAfter: money.nullish(),
    txnTimestamp: dateInput.default(() => new Date()),
    location: z.string().trim().max(200).nullish(),
    deviceId: z.string().trim().max(120).nullish(),
  })
  .strict() // reject unknown keys rather than silently dropping them

export const SORT_FIELDS = ['txnTimestamp', 'amount', 'createdAt']
export const SORT_ORDERS = ['asc', 'desc']

export const listTransactionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    // Capped so a single request cannot ask for the whole table.
    pageSize: z.coerce.number().int().min(1).max(200).default(25),

    txnType: z.enum(TXN_TYPES).optional(),
    merchantCategory: z.string().trim().min(1).max(120).optional(),

    from: dateInput.optional(),
    to: dateInput.optional(),

    minAmount: money.optional(),
    maxAmount: money.optional(),

    /** Matches txn_id, sender_id or receiver_id. */
    search: z.string().trim().min(1).max(120).optional(),

    sortBy: z.enum(SORT_FIELDS).default('txnTimestamp'),
    sortOrder: z.enum(SORT_ORDERS).default('desc'),

    /** ADMIN-only escape hatch for auditing soft-deleted rows. */
    includeDeleted: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .default(false),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })
  .refine((q) => q.minAmount === undefined || q.maxAmount === undefined || q.minAmount <= q.maxAmount, {
    message: '`minAmount` must be less than or equal to `maxAmount`',
    path: ['minAmount'],
  })

export const transactionIdParamSchema = z.object({
  id: z.uuid('Transaction id must be a UUID'),
})
