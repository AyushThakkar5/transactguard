/**
 * Express application assembly.
 *
 * This file builds and exports the app but never binds a port — server.js does
 * that. Keeping the two apart is what lets a Socket.IO server and BullMQ
 * workers attach to the HTTP server later without this file changing, and it
 * means an integration test can import the app and drive it in-process.
 */

import express from 'express'
import helmet from 'helmet'
import cors from 'cors'

import authRoutes from './modules/auth/auth.routes.js'
import healthRoutes from './modules/health/health.routes.js'
import transactionRoutes from './modules/transactions/transactions.routes.js'
import predictionRoutes from './modules/predictions/predictions.routes.js'
import jobRoutes from './modules/jobs/jobs.routes.js'
import simulatorRoutes from './modules/simulator/simulator.routes.js'
import analyticsRoutes from './modules/analytics/analytics.routes.js'
import caseRoutes from './modules/cases/cases.routes.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { allowedOrigins, isProduction } from './config/env.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')

  // Render (and most PaaS) terminate TLS at a single proxy in front of the app.
  // Without this req.ip is the proxy's address, so every client shares one
  // rate-limit bucket. The value is 1 — the number of proxies actually in
  // front — never `true`, which would let a client forge X-Forwarded-For and
  // reset its own limit at will.
  if (isProduction) app.set('trust proxy', 1)

  app.use(helmet())
  // Development reflects any origin so a colleague on another port just works.
  // Production answers only the configured frontends; env.js refuses to boot in
  // production if none are set, so this can never silently fall open.
  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    }),
  )
  // 2mb rather than the usual 1mb: POST /jobs accepts up to 20,000 transaction
  // ids, and 20,000 UUIDs serialise to roughly 780KB — close enough to 1mb that
  // a legitimate maximum-size job would be rejected as too large.
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  app.use('/api/v1/health', healthRoutes)
  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/transactions', transactionRoutes)
  app.use('/api/v1/predictions', predictionRoutes)
  app.use('/api/v1/jobs', jobRoutes)
  app.use('/api/v1/simulator', simulatorRoutes)
  app.use('/api/v1/analytics', analyticsRoutes)
  app.use('/api/v1/cases', caseRoutes)

  // Unmatched route → 404, then the single error funnel. Both stay last.
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export default createApp()
