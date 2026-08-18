/**
 * PaySim CSV → Transaction mapping.
 *
 * Shared deliberately: prisma/seedTransactions.js and the POST
 * /transactions/upload route both import from here, so a bulk-seeded row and an
 * uploaded row are guaranteed to be shaped identically. Changing the mapping in
 * one place changes it in both.
 *
 * Source columns:
 *   step, type, amount, nameOrig, oldbalanceOrg, newbalanceOrig,
 *   nameDest, oldbalanceDest, newbalanceDest, isFraud, isFlaggedFraud
 */

import { createHash } from 'node:crypto'

/** Columns a CSV must contain before we will process it. */
export const REQUIRED_CSV_HEADERS = [
  'step',
  'type',
  'amount',
  'nameOrig',
  'oldbalanceOrg',
  'newbalanceOrig',
  'nameDest',
  'oldbalanceDest',
  'newbalanceDest',
]

/** Columns that are accepted but not required. */
export const OPTIONAL_CSV_HEADERS = ['isFraud', 'isFlaggedFraud', 'txn_id']

/** The transaction types PaySim emits. */
export const PAYSIM_TXN_TYPES = ['TRANSFER', 'CASH_OUT', 'PAYMENT', 'CASH_IN', 'DEBIT']

/**
 * PaySim encodes time as `step`, where one step is one hour and step 1 is the
 * first hour of the simulation. The dataset carries no real calendar date, so we
 * anchor it to a fixed epoch: step 1 → 2026-01-01T00:00:00Z. The full 743 steps
 * then span roughly one month, which gives the dashboard a realistic date range
 * to filter over.
 */
export const PAYSIM_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0)

const HOUR_MS = 60 * 60 * 1000

/** @param {number} step 1-based PaySim step */
export function stepToTimestamp(step) {
  return new Date(PAYSIM_EPOCH + (step - 1) * HOUR_MS)
}

/**
 * Derive a stable transaction id from the row's natural key.
 *
 * PaySim ships no transaction id. A random uuid would be simpler, but it would
 * make every import produce fresh ids — so `createMany({ skipDuplicates: true })`
 * would never actually skip anything, re-running the seed would silently double
 * the table, and re-uploading a file would duplicate every row instead of
 * reporting it as skipped.
 *
 * Hashing the natural key instead makes imports idempotent. Verified against the
 * full 6,362,620-row dataset: (step, type, amount, nameOrig, nameDest) yields
 * 6,362,620 distinct keys, so this collapses no legitimately distinct rows.
 */
export function deriveTxnId(row) {
  const naturalKey = [row.step, row.type, row.amount, row.nameOrig, row.nameDest].join('|')
  const digest = createHash('sha256').update(naturalKey).digest('hex').slice(0, 24)
  return `TXN-${digest}`
}

function toNumber(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${field} is empty`)
  }
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${field} is not a number: "${value}"`)
  return n
}

function toBoolean(value) {
  return value === '1' || value === 1 || value === 'true' || value === true
}

/**
 * Map one parsed CSV row to Prisma `Transaction` create input.
 *
 * @param {object} row      one record from csv-parse (columns: true)
 * @param {object} [options]
 * @param {string} [options.uploadedById]  User id to attribute the row to
 * @returns {object} Prisma Transaction.createMany input
 * @throws {Error} with a readable message when the row is unusable
 */
export function mapRowToTransaction(row, { uploadedById = null } = {}) {
  const step = toNumber(row.step, 'step')
  if (!Number.isInteger(step) || step < 1) {
    throw new Error(`step must be a positive integer, got "${row.step}"`)
  }

  const type = String(row.type ?? '').trim().toUpperCase()
  if (!PAYSIM_TXN_TYPES.includes(type)) {
    throw new Error(`unknown transaction type "${row.type}"`)
  }

  const amount = toNumber(row.amount, 'amount')
  if (amount < 0) throw new Error(`amount cannot be negative: ${amount}`)

  const nameOrig = String(row.nameOrig ?? '').trim()
  const nameDest = String(row.nameDest ?? '').trim()
  if (!nameOrig) throw new Error('nameOrig is empty')
  if (!nameDest) throw new Error('nameDest is empty')

  return {
    // An explicit txn_id column wins if the CSV provides one; otherwise derive it.
    txnId: row.txn_id?.trim() || deriveTxnId({ ...row, type, nameOrig, nameDest }),
    txnType: type,
    amount,
    currency: 'USD', // PaySim has no currency column
    senderId: nameOrig,
    receiverId: nameDest,
    merchantCategory: null, // not present in PaySim — added in a later step
    origBalanceBefore: toNumber(row.oldbalanceOrg, 'oldbalanceOrg'),
    origBalanceAfter: toNumber(row.newbalanceOrig, 'newbalanceOrig'),
    destBalanceBefore: toNumber(row.oldbalanceDest, 'oldbalanceDest'),
    destBalanceAfter: toNumber(row.newbalanceDest, 'newbalanceDest'),
    txnTimestamp: stepToTimestamp(step),
    location: null, // not in PaySim
    deviceId: null, // not in PaySim
    uploadedById,
  }
}

/**
 * Pull the ground-truth labels out of a row, kept separate from the transaction
 * itself so they never reach the Transaction table.
 *
 * @returns {{ txnId: string, isFraud: boolean, isFlaggedFraud: boolean } | null}
 *          null when the row carries no label columns
 */
export function extractFraudLabel(row, txnId) {
  if (row.isFraud === undefined && row.isFlaggedFraud === undefined) return null
  return {
    txnId,
    isFraud: toBoolean(row.isFraud),
    isFlaggedFraud: toBoolean(row.isFlaggedFraud),
  }
}

/**
 * Confirm a CSV's header row before processing a single record.
 *
 * @param {string[]} headers
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateCsvHeaders(headers) {
  const present = new Set(headers.map((h) => h.trim()))
  const missing = REQUIRED_CSV_HEADERS.filter((h) => !present.has(h))
  return { valid: missing.length === 0, missing }
}
