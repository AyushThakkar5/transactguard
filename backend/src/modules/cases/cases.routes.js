/**
 * Route table for /api/v1/cases. Wiring only.
 */

import { Router } from 'express'
import * as casesController from './cases.controller.js'
import { caseIdParamSchema, listCasesQuerySchema, updateCaseSchema } from './cases.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'

const router = Router()

router.use(authenticate)

// Before /:id, or "counts" is parsed as a case id.
router.get('/counts', casesController.counts)

router.get('/', validate(listCasesQuerySchema, 'query'), casesController.list)
router.get('/:id', validate(caseIdParamSchema, 'params'), casesController.getById)

// Deciding a case is the analyst's job; a VIEWER may read the queue only.
router.patch(
  '/:id',
  requireRole('ADMIN', 'ANALYST'),
  validate(caseIdParamSchema, 'params'),
  validate(updateCaseSchema),
  casesController.update,
)

router.post('/backfill', requireRole('ADMIN'), casesController.backfill)

export default router
