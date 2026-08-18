/** HTTP layer for the analytics module. */

import * as analyticsService from './analytics.service.js'
import { sendSuccess } from '../../utils/response.js'

export async function summary(req, res) {
  return sendSuccess(res, await analyticsService.getSummary(req.validated))
}

export async function trend(req, res) {
  const points = await analyticsService.getTrend(req.validated)
  return sendSuccess(res, { points })
}

export async function distribution(_req, res) {
  return sendSuccess(res, await analyticsService.getDistribution())
}

export async function geo(_req, res) {
  return sendSuccess(res, await analyticsService.getGeoRisk())
}

export async function hourly(_req, res) {
  const hours = await analyticsService.getHourlyRisk()
  return sendSuccess(res, { hours })
}

export async function recentCritical(req, res) {
  const predictions = await analyticsService.getRecentCritical(req.validated)
  return sendSuccess(res, { predictions })
}

export async function scatter(req, res) {
  return sendSuccess(res, await analyticsService.getScatter(req.validated))
}

export async function network(req, res) {
  return sendSuccess(res, await analyticsService.getNetwork(req.validated))
}

export async function publicStats(_req, res) {
  return sendSuccess(res, await analyticsService.getPublicStats())
}
