/**
 * HTTP client for the FastAPI ML service (Step 4).
 *
 * Deliberately thin: build the request, enforce a timeout, validate the
 * response, translate every failure mode into a 502 that names what went wrong.
 * No business logic — the service layer decides what to do with the result.
 *
 * Uses Node's built-in fetch rather than axios; nothing here needs more than
 * that, and it keeps the dependency list unchanged.
 */

import { env } from '../../config/env.js'
import { ApiError } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'
import { mlPredictionResponseSchema } from './predictions.schemas.js'

const log = moduleLogger('ml-client')

/**
 * Hard ceiling on a single scoring call. The rule engine answers in under a
 * millisecond, so 5s is pure headroom for the real model in Step 8 — but it
 * must exist, or an unreachable ML service would hold an Express handler (and
 * its database connection) open until the client gives up.
 */
export const ML_REQUEST_TIMEOUT_MS = 5000

/** Every failure from this module carries one of these codes at HTTP 502. */
export const ML_ERROR_CODES = {
  UNAVAILABLE: 'ML_SERVICE_UNAVAILABLE',
  TIMEOUT: 'ML_SERVICE_TIMEOUT',
  UNAUTHORIZED: 'ML_SERVICE_UNAUTHORIZED',
  BAD_STATUS: 'ML_SERVICE_ERROR',
  INVALID_RESPONSE: 'ML_SERVICE_INVALID_RESPONSE',
}

function mlError(code, message, details) {
  // 502 rather than 500: the failure is in an upstream dependency, not in this
  // service, and the distinction matters when reading logs at 3am.
  return new ApiError(502, code, message, details)
}

/**
 * Map a Transaction row to the ML service's request shape.
 *
 * @param {object} txn Prisma Transaction
 * @returns {object} body for POST /predict/single
 * @throws {ApiError} 422 when a field the scorer requires is missing
 */
export function toMlRequest(txn) {
  const balances = {
    orig_balance_before: txn.origBalanceBefore,
    orig_balance_after: txn.origBalanceAfter,
    dest_balance_before: txn.destBalanceBefore,
    dest_balance_after: txn.destBalanceAfter,
  }

  // Balances are nullable on Transaction (a hand-created row may omit them) but
  // required by the scorer. Substituting 0 would be worse than failing: a zero
  // destination balance is itself a strong fraud signal, so a missing value
  // would silently inflate the risk score rather than merely weaken it.
  const missing = Object.entries(balances)
    .filter(([, value]) => value === null || value === undefined)
    .map(([field]) => field)

  if (missing.length > 0) {
    throw new ApiError(
      422,
      'TRANSACTION_NOT_SCORABLE',
      `Transaction is missing balance fields required for scoring: ${missing.join(', ')}`,
      { missing },
    )
  }

  return {
    txn_id: txn.txnId,
    txn_type: txn.txnType,
    amount: Number(txn.amount),
    sender_id: txn.senderId,
    receiver_id: txn.receiverId,
    orig_balance_before: Number(txn.origBalanceBefore),
    orig_balance_after: Number(txn.origBalanceAfter),
    dest_balance_before: Number(txn.destBalanceBefore),
    dest_balance_after: Number(txn.destBalanceAfter),
    txn_timestamp: txn.txnTimestamp.toISOString(),
  }
}

/**
 * Score one transaction.
 *
 * @param {object} txn Prisma Transaction
 * @returns {{ prediction: object, roundTripMs: number }}
 * @throws {ApiError} 502 on any ML-service failure, 422 if the row is unscorable
 */
export async function predictSingle(txn) {
  const body = toMlRequest(txn)
  const url = `${env.ML_SERVICE_URL.replace(/\/$/, '')}/predict/single`

  const startedAt = performance.now()
  let response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': env.ML_SERVICE_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ML_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError; a refused connection or
    // DNS failure arrives as a TypeError wrapping the cause.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      log.error({ url, timeoutMs: ML_REQUEST_TIMEOUT_MS }, 'ML service timed out')
      throw mlError(
        ML_ERROR_CODES.TIMEOUT,
        `ML service did not respond within ${ML_REQUEST_TIMEOUT_MS}ms`,
      )
    }

    log.error({ url, err: err.message, cause: err.cause?.code }, 'ML service unreachable')
    throw mlError(
      ML_ERROR_CODES.UNAVAILABLE,
      'ML service is unreachable — is it running on ' + env.ML_SERVICE_URL + '?',
    )
  }

  const roundTripMs = Math.round(performance.now() - startedAt)

  if (!response.ok) {
    // Read the body as text first: an error response is not guaranteed to be
    // JSON, and a failed .json() would mask the status code that explains it.
    const raw = await response.text().catch(() => '<unreadable>')

    if (response.status === 401) {
      log.error({ url }, 'ML service rejected our API key')
      throw mlError(
        ML_ERROR_CODES.UNAUTHORIZED,
        'ML service rejected the internal API key — check that ML_SERVICE_API_KEY ' +
          'matches INTERNAL_API_KEY in ml_service/.env',
      )
    }

    log.error({ url, status: response.status, raw: raw.slice(0, 1000) }, 'ML service returned an error')
    throw mlError(
      ML_ERROR_CODES.BAD_STATUS,
      `ML service responded with HTTP ${response.status}`,
      { status: response.status },
    )
  }

  let payload
  try {
    payload = await response.json()
  } catch (err) {
    log.error({ url, err: err.message }, 'ML service returned a non-JSON body')
    throw mlError(ML_ERROR_CODES.INVALID_RESPONSE, 'ML service returned a non-JSON response')
  }

  const parsed = mlPredictionResponseSchema.safeParse(payload)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }))
    // The raw payload goes to the log, not to the client — it is the only way to
    // diagnose a contract drift after the fact.
    log.error({ url, issues, raw: JSON.stringify(payload).slice(0, 2000) }, 'ML service response failed validation')
    throw mlError(
      ML_ERROR_CODES.INVALID_RESPONSE,
      'ML service returned a response that does not match the expected schema',
      { issues },
    )
  }

  return { prediction: parsed.data, roundTripMs }
}

/** Liveness probe against the ML service. Used for diagnostics, never on the hot path. */
export async function pingMlService() {
  const url = `${env.ML_SERVICE_URL.replace(/\/$/, '')}/health`
  const response = await fetch(url, {
    headers: { 'X-Internal-Api-Key': env.ML_SERVICE_API_KEY },
    signal: AbortSignal.timeout(ML_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`ML service health returned HTTP ${response.status}`)
  return response.json()
}
