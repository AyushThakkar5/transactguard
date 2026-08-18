/** Zod schemas for the cases module. Validation only. */

import { z } from 'zod'
import { CASE_STATUSES } from './cases.service.js'

const dateInput = z.coerce.date({ message: 'Must be a valid date (ISO 8601 recommended)' })

export const listCasesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    // The kanban board pulls a whole column at a time, so this ceiling is
    // higher than the other list endpoints'.
    pageSize: z.coerce.number().int().min(1).max(300).default(50),
    status: z.enum(CASE_STATUSES).optional(),
    riskLevel: z.enum(['SUSPICIOUS', 'CRITICAL']).optional(),
    assignedToId: z.uuid().optional(),
    from: dateInput.optional(),
    to: dateInput.optional(),
    search: z.string().trim().min(1).max(120).optional(),
    sortBy: z.enum(['riskScore', 'createdAt', 'updatedAt', 'amount']).default('riskScore'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must be earlier than or equal to `to`',
    path: ['from'],
  })

export const caseIdParamSchema = z.object({
  id: z.uuid('Case id must be a UUID'),
})

export const updateCaseSchema = z
  .object({
    status: z.enum(CASE_STATUSES).optional(),
    notes: z.string().trim().max(2000).nullish(),
    assignedToId: z.uuid().nullish(),
  })
  .strict()
  .refine(
    (body) => body.status !== undefined || body.notes !== undefined || body.assignedToId !== undefined,
    { message: 'Provide at least one of status, notes or assignedToId' },
  )
