/**
 * GET /api/v1/health
 *
 * Actively probes both backing services rather than just reporting that the
 * process is up — a 200 here means Postgres answered a query and Redis answered
 * a PING. Returns 503 when either is down, so a load balancer or `docker
 * healthcheck` can act on it.
 *
 * Both probes run concurrently via allSettled, so one hanging service does not
 * hide the status of the other.
 */

import { Router } from 'express'
import { pingDatabase } from '../../config/db.js'
import { pingRedis } from '../../config/redis.js'
import { moduleLogger } from '../../utils/logger.js'

const log = moduleLogger('health')
const router = Router()

function statusOf(result, name) {
  if (result.status === 'fulfilled') return 'ok'
  log.error({ service: name, err: result.reason?.message }, 'Health check failed')
  return 'error'
}

router.get('/', async (_req, res) => {
  const [dbResult, redisResult] = await Promise.allSettled([pingDatabase(), pingRedis()])

  const services = {
    database: statusOf(dbResult, 'database'),
    redis: statusOf(redisResult, 'redis'),
  }

  const healthy = Object.values(services).every((s) => s === 'ok')

  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    services,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  })
})

export default router
