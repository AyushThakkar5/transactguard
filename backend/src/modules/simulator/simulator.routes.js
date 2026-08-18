/**
 * Route table for /api/v1/simulator. Wiring only.
 */

import { Router } from 'express'
import * as simulatorController from './simulator.controller.js'
import { startSimulatorSchema, stopSimulatorSchema } from './simulator.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'

const router = Router()

router.use(authenticate)

router.post(
  '/start',
  requireRole('ADMIN', 'ANALYST'),
  validate(startSimulatorSchema),
  simulatorController.start,
)

router.post(
  '/stop',
  requireRole('ADMIN', 'ANALYST'),
  validate(stopSimulatorSchema),
  simulatorController.stop,
)

router.get('/status', simulatorController.status)

export default router
