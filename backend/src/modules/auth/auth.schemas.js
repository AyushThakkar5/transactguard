/**
 * Zod schemas for the auth module. Validation rules only — no logic, no I/O.
 */

import { z } from 'zod'

export const ROLES = ['ADMIN', 'ANALYST', 'VIEWER']

const email = z
  .email('Must be a valid email address')
  .max(255)
  .trim()
  .toLowerCase() // stored lower-cased so Alice@x.com and alice@x.com are one account

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email,
  password,
  role: z.enum(ROLES).default('ANALYST'),
})

export const loginSchema = z.object({
  email,
  // No complexity rules on login: the stored password only has to match, and
  // rejecting a legacy password at the schema layer would lock the user out.
  password: z.string().min(1, 'Password is required'),
})

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
})

export const logoutSchema = z.object({
  // Optional: when supplied, the refresh token is revoked alongside the access
  // token so logout actually ends the session rather than just the 15-minute leg.
  refreshToken: z.string().min(1).optional(),
})

/** ADMIN is intentionally not assignable — see auth.service.js updateUserRole. */
export const userIdParamSchema = z.object({
  id: z.uuid('User id must be a UUID'),
})

export const updateRoleSchema = z
  .object({
    role: z.enum(['ANALYST', 'VIEWER'], {
      message: 'Role must be ANALYST or VIEWER',
    }),
  })
  .strict()
