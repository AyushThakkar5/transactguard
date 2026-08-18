/**
 * Route table for /api/v1/analytics. Wiring only.
 *
 * Read-only across the board, so every authenticated role may call it —
 * a VIEWER whose job is to watch dashboards needs exactly this.
 */

import { Router } from 'express'
import * as analyticsController from './analytics.controller.js'
import {
  networkQuerySchema,
  recentQuerySchema,
  scatterQuerySchema,
  summaryQuerySchema,
  trendQuerySchema,
} from './analytics.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { validate } from '../../middleware/validate.js'

const router = Router()

// Declared before the auth gate: the login screen shows these counters and
// has, by definition, no token yet. Aggregate and non-identifying only.
router.get('/public-stats', analyticsController.publicStats)

router.use(authenticate)

router.get('/summary', validate(summaryQuerySchema, 'query'), analyticsController.summary)
router.get('/trend', validate(trendQuerySchema, 'query'), analyticsController.trend)
router.get('/distribution', analyticsController.distribution)
router.get('/geo', analyticsController.geo)
router.get('/hourly', analyticsController.hourly)
router.get('/scatter', validate(scatterQuerySchema, 'query'), analyticsController.scatter)
router.get('/network', validate(networkQuerySchema, 'query'), analyticsController.network)
router.get('/recent-critical', validate(recentQuerySchema, 'query'), analyticsController.recentCritical)

export default router
