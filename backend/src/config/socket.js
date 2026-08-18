/**
 * Socket.IO server.
 *
 * Attaches to the same HTTP server Express is bound to — which is why app.js
 * (build the app) and server.js (own the port) were split apart in Step 2.
 *
 * Rooms rather than broadcasts: a client asks for the specific job it cares
 * about, so a 60-chunk job does not spray sixty messages at every connected
 * browser.
 */

import { Server } from 'socket.io'
import { allowedOrigins } from './env.js'
import { isTokenRevoked } from './redis.js'
import { verifyAccessToken, extractBearerToken } from '../utils/tokens.js'
import { moduleLogger } from '../utils/logger.js'

const log = moduleLogger('socket')

export const FEED_ROOM = 'feed'
export const jobRoom = (jobId) => `job:${jobId}`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let io = null

/**
 * Handshake authentication.
 *
 * Runs the same three checks as middleware/auth.js and reuses the same
 * verifyAccessToken + denylist helpers, so a token revoked by logout is refused
 * here too rather than living on in an open socket.
 *
 * The token is read from the handshake `auth` payload, not the query string:
 * query strings end up in proxy logs and browser history, and an access token
 * has no business in either.
 */
async function authenticateSocket(socket, next) {
  const auth = socket.handshake.auth ?? {}
  // Accept a bare token or an "Authorization: Bearer …" style string.
  const token = auth.token ? extractBearerToken(auth.token) ?? auth.token : null

  if (!token) {
    log.warn({ socketId: socket.id, ip: socket.handshake.address }, 'Socket rejected: no token')
    return next(new Error('Authentication required'))
  }

  let payload
  try {
    payload = verifyAccessToken(token)
  } catch (err) {
    log.warn({ socketId: socket.id, code: err.code }, 'Socket rejected: invalid token')
    // err.message is already client-safe ("Token has expired" / "Invalid token").
    return next(new Error(err.message ?? 'Invalid token'))
  }

  try {
    if (await isTokenRevoked(payload.jti)) {
      log.warn({ socketId: socket.id, userId: payload.sub }, 'Socket rejected: revoked token')
      return next(new Error('Token has been revoked'))
    }
  } catch (err) {
    // isTokenRevoked fails closed for HTTP; the same reasoning applies to a
    // long-lived socket, which would otherwise outlast a revocation entirely.
    log.error({ err: err.message }, 'Socket rejected: denylist unreadable')
    return next(new Error('Authentication is temporarily unavailable'))
  }

  socket.user = { id: payload.sub, email: payload.email, role: payload.role, jti: payload.jti }
  return next()
}

function registerHandlers(socket) {
  const { id: userId, email, role } = socket.user
  log.info({ socketId: socket.id, userId, role }, 'Socket connected')

  /** Subscribe to one batch job's progress. */
  socket.on('subscribe:job', (payload, ack) => {
    const jobId = typeof payload === 'string' ? payload : payload?.jobId

    if (!jobId || !UUID_RE.test(jobId)) {
      const error = 'subscribe:job requires a valid job UUID'
      socket.emit('error:subscription', { event: 'subscribe:job', message: error })
      return ack?.({ ok: false, error })
    }

    socket.join(jobRoom(jobId))
    log.debug({ socketId: socket.id, jobId }, 'Socket joined job room')
    return ack?.({ ok: true, room: jobRoom(jobId) })
  })

  socket.on('unsubscribe:job', (payload, ack) => {
    const jobId = typeof payload === 'string' ? payload : payload?.jobId
    if (!jobId) return ack?.({ ok: false, error: 'jobId required' })
    socket.leave(jobRoom(jobId))
    return ack?.({ ok: true })
  })

  /** Opt into the live prediction feed. */
  socket.on('subscribe:feed', (_payload, ack) => {
    socket.join(FEED_ROOM)
    log.debug({ socketId: socket.id }, 'Socket joined feed room')
    return ack?.({ ok: true, room: FEED_ROOM })
  })

  socket.on('unsubscribe:feed', (_payload, ack) => {
    socket.leave(FEED_ROOM)
    return ack?.({ ok: true })
  })

  socket.on('disconnect', (reason) =>
    log.info({ socketId: socket.id, userId, reason }, 'Socket disconnected'),
  )

  // Lets a client confirm the handshake succeeded and see who it authenticated as.
  socket.emit('connected', { userId, email, role, socketId: socket.id })
}

/**
 * Create the Socket.IO server on an existing HTTP server.
 * @param {import('node:http').Server} httpServer
 */
export function initSocketServer(httpServer) {
  if (io) return io

  io = new Server(httpServer, {
    // Same policy as the REST API — one allow-list, one place to change it.
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    },

    // Polling first, then upgrade. Behind a proxy that does not forward the
    // WebSocket upgrade (or a corporate network that blocks it), a
    // websocket-only client fails to connect at all; starting on polling means
    // the feed still works, just less efficiently, and silently upgrades when
    // the upgrade succeeds.
    transports: ['polling', 'websocket'],

    // Free-tier hosts idle aggressively and browsers throttle background tabs;
    // a longer window stops a live job being dropped mid-run.
    pingTimeout: 30_000,
    pingInterval: 25_000,
  })

  io.use(authenticateSocket)
  io.on('connection', registerHandlers)

  log.info('Socket.IO server attached')
  return io
}

/** The live server, or null before init. Used by the realtime subscriber. */
export function getSocketServer() {
  return io
}

export async function closeSocketServer() {
  if (io) {
    await io.close()
    io = null
    log.info('Socket.IO server closed')
  }
}
