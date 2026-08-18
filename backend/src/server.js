/**
 * HTTP entry point.
 *
 * Owns the process: binds the port, verifies the backing services, and shuts
 * everything down cleanly. The Socket.IO server and BullMQ workers will attach
 * to the `server` handle below without app.js needing to change.
 */

import app from './app.js'
import { env } from './config/env.js'
import { logger } from './utils/logger.js'
import { connectDatabase, disconnectDatabase, pingDatabase } from './config/db.js'
import { disconnectRedis, pingRedis } from './config/redis.js'
import { closeSocketServer, initSocketServer } from './config/socket.js'
import { startSubscriber, stopSubscriber } from './realtime/subscriber.js'
import { closePublisher, initPublisher } from './realtime/publisher.js'
import { shutdownSimulator } from './modules/simulator/simulator.service.js'

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, pid: process.pid },
    `TransactGuard API listening on http://localhost:${env.PORT}`,
  )
})

/**
 * Socket.IO shares the HTTP server Express is bound to — the whole reason app.js
 * and server.js were separated in Step 2. The subscriber then bridges Redis
 * pub/sub into it, so events published by the worker process reach browsers
 * connected here.
 */
const io = initSocketServer(server)

// The simulator publishes from this process, so warm its connection too.
initPublisher()

startSubscriber(io).catch((err) =>
  logger.error(
    { err: err.message },
    'Realtime subscriber failed to start — batch jobs still run, but progress will not stream',
  ),
)

/**
 * Probe Postgres and Redis at boot.
 *
 * A failure logs loudly but does not kill the process — the server stays up so
 * /api/v1/health can report which dependency is down, which is far easier to
 * diagnose than a container that exits immediately on start.
 */
async function verifyDependencies() {
  await Promise.allSettled([
    connectDatabase().catch((err) =>
      logger.error({ err: err.message }, 'PostgreSQL unreachable — is `docker compose up -d` running?'),
    ),
    pingRedis()
      .then(() => logger.info('Redis reachable'))
      .catch((err) =>
        logger.error({ err: err.message }, 'Redis unreachable — is `docker compose up -d` running?'),
      ),
  ])
}

verifyDependencies()

let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, 'Shutting down')

  // Stop accepting new connections, let in-flight requests finish, then release
  // the database and Redis handles.
  // Stop producing events before tearing the transport down.
  shutdownSimulator()

  server.close(async () => {
    try {
      await closeSocketServer()
      await Promise.allSettled([
        stopSubscriber(),
        closePublisher(),
        disconnectDatabase(),
        disconnectRedis(),
      ])
      logger.info('Shutdown complete')
      process.exit(0)
    } catch (err) {
      logger.error({ err: err.message }, 'Error during shutdown')
      process.exit(1)
    }
  })

  // Do not hang forever on a stuck connection.
  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: reason?.message ?? reason }, 'Unhandled promise rejection')
})

process.on('uncaughtException', (err) => {
  // The process is in an undefined state after this point, so exit rather than
  // limp on. A supervisor (docker/pm2/systemd) restarts it.
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception')
  process.exit(1)
})

export { server, io }
