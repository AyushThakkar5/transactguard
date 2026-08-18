/**
 * Route table for /api/v1/jobs. Wiring only.
 */

import { Router } from 'express'
import * as jobsController from './jobs.controller.js'
import { createJobSchema, jobIdParamSchema, listJobsQuerySchema } from './jobs.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'

const router = Router()

router.use(authenticate)

router.post('/', requireRole('ADMIN', 'ANALYST'), validate(createJobSchema), jobsController.create)

router.get('/', validate(listJobsQuerySchema, 'query'), jobsController.list)

router.get('/:id', validate(jobIdParamSchema, 'params'), jobsController.getById)

// Retry re-runs work and re-spends ML capacity, so it is ADMIN-only even though
// creating a job is open to analysts.
router.post(
  '/:id/retry',
  requireRole('ADMIN'),
  validate(jobIdParamSchema, 'params'),
  jobsController.retry,
)

export default router
