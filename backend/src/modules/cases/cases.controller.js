/** HTTP layer for the cases module. */

import * as casesService from './cases.service.js'
import { sendSuccess } from '../../utils/response.js'

function requestContext(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') }
}

export async function list(req, res) {
  return sendSuccess(res, await casesService.listCases(req.validated))
}

export async function counts(_req, res) {
  return sendSuccess(res, await casesService.getCaseCounts())
}

export async function getById(req, res) {
  return sendSuccess(res, { case: await casesService.getCaseById(req.params.id) })
}

export async function update(req, res) {
  const updated = await casesService.updateCase(
    req.params.id,
    req.body,
    req.user,
    requestContext(req),
  )
  return sendSuccess(res, { case: updated })
}

export async function backfill(_req, res) {
  return sendSuccess(res, await casesService.backfillCases())
}
