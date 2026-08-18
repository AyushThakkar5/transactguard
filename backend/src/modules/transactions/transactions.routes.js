/**
 * Route table for /api/v1/transactions. Wiring only.
 *
 * Every route requires a valid JWT — authenticate is applied to the whole
 * router rather than repeated per route, so a new route cannot be added
 * unprotected by accident.
 */

import { Router } from 'express'
import * as transactionsController from './transactions.controller.js'
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
} from './transactions.schemas.js'
import { authenticate } from '../../middleware/auth.js'
import { requireRole } from '../../middleware/requireRole.js'
import { validate } from '../../middleware/validate.js'
import { uploadCsv } from '../../middleware/upload.js'

const router = Router()

router.use(authenticate)

router.get('/', validate(listTransactionsQuerySchema, 'query'), transactionsController.list)

router.post(
  '/',
  requireRole('ADMIN', 'ANALYST'),
  validate(createTransactionSchema),
  transactionsController.create,
)

// uploadCsv runs before the controller and leaves the temp file at req.file.path.
router.post(
  '/upload',
  requireRole('ADMIN', 'ANALYST'),
  uploadCsv,
  transactionsController.upload,
)

router.get(
  '/:id',
  validate(transactionIdParamSchema, 'params'),
  transactionsController.getById,
)

router.delete(
  '/:id',
  requireRole('ADMIN'),
  validate(transactionIdParamSchema, 'params'),
  transactionsController.remove,
)

export default router
