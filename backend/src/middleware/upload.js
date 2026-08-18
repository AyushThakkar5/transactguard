/**
 * Multipart CSV upload handling (multer).
 *
 * Files go to a temp directory on disk rather than into memory. A 50 MB CSV
 * buffered in RAM would be 50 MB per concurrent upload; writing to disk and
 * streaming it through csv-parse keeps memory flat no matter how many uploads
 * land at once. The service deletes the temp file when it is done.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { ApiError } from '../utils/response.js'
import { moduleLogger } from '../utils/logger.js'

const log = moduleLogger('upload')

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

const UPLOAD_DIR = path.join(os.tmpdir(), 'transactguard-uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  // Never reuse the client-supplied name — it is attacker-controlled and could
  // contain path separators.
  filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname) || '.csv'}`),
})

function fileFilter(_req, file, cb) {
  const looksLikeCsv =
    file.mimetype === 'text/csv' ||
    file.mimetype === 'application/vnd.ms-excel' ||
    file.mimetype === 'application/octet-stream' ||
    path.extname(file.originalname).toLowerCase() === '.csv'

  if (!looksLikeCsv) {
    return cb(ApiError.badRequest(`Expected a .csv file, received "${file.mimetype}"`))
  }
  cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
})

/**
 * Accept a single CSV under the `file` field, translating multer's own errors
 * into the app's ApiError shape so the client sees one consistent envelope.
 */
export function uploadCsv(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      if (!req.file) {
        return next(ApiError.badRequest('No file uploaded — send a CSV in the `file` field'))
      }
      return next()
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          ApiError.badRequest(
            `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`,
            { maxBytes: MAX_UPLOAD_BYTES },
          ),
        )
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(ApiError.badRequest('Unexpected field — send the CSV in the `file` field'))
      }
      return next(ApiError.badRequest(`Upload failed: ${err.message}`))
    }

    return next(err)
  })
}

/** Best-effort removal of a temp upload. Safe to call more than once. */
export async function cleanupUpload(filePath) {
  if (!filePath) return
  try {
    await fs.promises.unlink(filePath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn({ err: err.message, filePath }, 'Failed to remove temp upload')
    }
  }
}

export default uploadCsv
