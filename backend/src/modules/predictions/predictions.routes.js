/**
 * Route table for /api/v1/predictions. Wiring only.
 *
 * authenticate is applied to the whole router, so a route cannot be added
 * unprotected by accident.
 */

import { Router } from 'express'
import * as predictionsController from './predictions.controller.js'
import {
  listPredictionsQuerySchema,
  predictionIdParamSchema,
  transactionIdParamSchema,
} from './predictions.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'

const router = Router()

router.use(authenticate)

// MUST precede GET /:id — Express matches in declaration order, so registering
// the parameterised route first would capture "export" as an id and reject it
// as a malformed UUID.
router.get(
  '/export',
  validate(listPredictionsQuerySchema, 'query'),
  predictionsController.exportCsv,
)

router.get('/', validate(listPredictionsQuerySchema, 'query'), predictionsController.list)

router.get('/:id', validate(predictionIdParamSchema, 'params'), predictionsController.getById)

// Scoring mutates state (and costs an upstream call), so it is gated to the
// roles that own investigations.
router.post(
  '/:transactionId',
  requireRole('ADMIN', 'ANALYST'),
  validate(transactionIdParamSchema, 'params'),
  predictionsController.create,
)

export default router
