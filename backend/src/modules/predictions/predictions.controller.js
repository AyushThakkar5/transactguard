/**
 * HTTP layer for the predictions module.
 *
 * Same shape as auth/transactions: read the request, call a service, send a
 * response. The one piece of real logic here is CSV assembly, which is a
 * presentation concern and belongs at this layer rather than in the service.
 */

import * as predictionsService from './predictions.service.js'
import { sendSuccess } from '../../utils/response.js'
import { moduleLogger } from '../../utils/logger.js'

const log = moduleLogger('predictions')

function requestContext(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') }
}

export async function create(req, res) {
  const result = await predictionsService.createPrediction(
    req.params.transactionId,
    req.user,
    requestContext(req),
  )

  // 200 on a rescore, 201 when this transaction had no prediction before.
  return sendSuccess(res, result, result.rescored ? 200 : 201)
}

export async function list(req, res) {
  const result = await predictionsService.listPredictions(req.validated)
  return sendSuccess(res, result)
}

export async function getById(req, res) {
  const prediction = await predictionsService.getPredictionById(req.params.id)
  return sendSuccess(res, { prediction })
}

const CSV_HEADERS = ['Transaction_ID', 'Risk_Score', 'Risk_Level', 'Explanation_Summary']

/**
 * RFC 4180 escaping: wrap in quotes when the value contains a comma, quote or
 * newline, and double any embedded quote. Explanation summaries contain
 * semicolons and commas as a matter of course, so this is load-bearing.
 */
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(values) {
  return values.map(csvCell).join(',') + '\r\n'
}

export async function exportCsv(req, res) {
  const query = req.validated
  const filename = `transactguard-predictions-${new Date().toISOString().slice(0, 10)}.csv`

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Cache-Control', 'no-store')

  // UTF-8 BOM: without it Excel reads the file as latin-1 and mangles the
  // em-dashes and currency symbols the explanations contain.
  res.write('﻿')
  res.write(csvRow(CSV_HEADERS))

  let rowCount = 0

  try {
    for await (const batch of predictionsService.streamPredictionsForExport(query)) {
      for (const prediction of batch) {
        res.write(
          csvRow([
            prediction.transaction?.txnId ?? '',
            prediction.riskScore,
            prediction.riskLevel,
            prediction.explanationSummary,
          ]),
        )
      }
      rowCount += batch.length
    }
  } catch (err) {
    // The status line and headers are already on the wire, so there is no way
    // to turn this into a clean JSON error. Destroying the socket makes the
    // download fail visibly rather than delivering a silently truncated file
    // that looks complete.
    log.error({ err: err.message, rowCount }, 'CSV export failed mid-stream')
    return res.destroy(err)
  }

  log.info({ rowCount, userId: req.user.id }, 'CSV export complete')
  return res.end()
}
