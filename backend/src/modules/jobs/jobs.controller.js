/**
 * HTTP layer for the batch jobs module.
 */

import * as jobsService from './jobs.service.js'
import { sendSuccess } from '../../utils/response.js'

function requestContext(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') }
}

export async function create(req, res) {
  const result = await jobsService.createJob(req.body, req.user, requestContext(req))

  // 202: the rows are written and the chunks are queued, but no scoring has
  // happened yet. Poll GET /jobs/:id to watch it progress.
  return sendSuccess(res, result, 202)
}

export async function list(req, res) {
  const result = await jobsService.listJobs(req.validated)
  return sendSuccess(res, result)
}

export async function getById(req, res) {
  const job = await jobsService.getJobById(req.params.id)
  return sendSuccess(res, { job })
}

export async function retry(req, res) {
  const result = await jobsService.retryJob(req.params.id, req.user, requestContext(req))
  return sendSuccess(res, result, 202)
}
