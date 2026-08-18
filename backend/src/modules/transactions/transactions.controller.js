/**
 * HTTP layer for the transactions module.
 *
 * Mirrors auth.controller.js: read the request, call a service, shape the
 * response. Express 5 forwards rejected promises to errorHandler, so no
 * try/catch — the one exception is the upload handler, which needs a `finally`
 * to delete its temp file whether the import succeeded or not.
 */

import * as transactionsService from './transactions.service.js'
import { sendSuccess } from '../../utils/response.js'
import { cleanupUpload } from '../../middleware/upload.js'

function requestContext(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') }
}

export async function list(req, res) {
  // validate(schema, 'query') puts the parsed query on req.validated, because
  // req.query itself is a getter in Express 5 and cannot be reassigned.
  const result = await transactionsService.listTransactions(req.validated, req.user)
  return sendSuccess(res, result)
}

export async function getById(req, res) {
  const transaction = await transactionsService.getTransactionById(req.params.id)
  return sendSuccess(res, { transaction })
}

export async function create(req, res) {
  const transaction = await transactionsService.createTransaction(
    req.body,
    req.user,
    requestContext(req),
  )
  return sendSuccess(res, { transaction }, 201)
}

export async function upload(req, res) {
  try {
    const summary = await transactionsService.importTransactionsFromCsv(req.file.path, req.user, {
      ...requestContext(req),
      fileName: req.file.originalname,
    })
    return sendSuccess(res, summary, 201)
  } finally {
    // Runs on the error path too, so a rejected import cannot leak a temp file.
    await cleanupUpload(req.file?.path)
  }
}

export async function remove(req, res) {
  const transaction = await transactionsService.softDeleteTransaction(
    req.params.id,
    req.user,
    requestContext(req),
  )
  return sendSuccess(res, { message: 'Transaction deleted', transaction })
}
