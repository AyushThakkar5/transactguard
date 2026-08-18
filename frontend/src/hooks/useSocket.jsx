/**
 * Socket.IO connection, shared across the app.
 *
 * One connection is opened after login and reused by every page, so switching
 * between the live feed and the jobs board never tears down and re-establishes
 * the transport. Pages subscribe to rooms through the hooks below; the provider
 * owns the socket itself.
 *
 * The token travels in the handshake `auth` payload, matching what the backend
 * expects — never a query string, which would leak it into proxy logs.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from '../store/auth.js'
import { apiOrigin, getAccessToken } from '../lib/api.js'

const SocketContext = createContext({ socket: null, status: 'idle' })

export function SocketProvider({ children }) {
  const isAuthenticated = useAuth((s) => s.isAuthenticated)
  const [status, setStatus] = useState('idle')
  const socketRef = useRef(null)
  const [, force] = useState(0)

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.close()
      socketRef.current = null
      setStatus('idle')
      return
    }

    const token = getAccessToken()
    if (!token) return

    setStatus('connecting')
    // Development: same origin, Vite proxies /socket.io to the API. Production:
    // connect to the API host directly, since Vercel serves only static files
    // and cannot proxy a WebSocket upgrade.
    const socket = io(apiOrigin || undefined, {
      auth: { token },
      // Polling first, matching the server: a proxy that will not forward the
      // upgrade should degrade to working-but-slower, not fail to connect.
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 6,
      reconnectionDelay: 800,
    })

    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('connect_error', (err) => {
      // An expired token here is not fatal: the REST layer refreshes it, and
      // the next mount reconnects with the new one.
      setStatus(err.message?.includes('expired') ? 'expired' : 'error')
    })

    socketRef.current = socket
    force((n) => n + 1)

    return () => {
      socket.close()
      socketRef.current = null
    }
  }, [isAuthenticated])

  const value = useMemo(() => ({ socket: socketRef.current, status }), [status])

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}

export function useSocket() {
  return useContext(SocketContext)
}

/**
 * Subscribe to one batch job's progress.
 *
 * Joins on mount, leaves on unmount, and re-joins if the socket reconnects —
 * room membership does not survive a reconnect, so without that a dropped
 * connection would silently stop delivering progress.
 *
 * @param {string|null} jobId
 * @param {{ onProgress?: Function, onCompleted?: Function }} handlers
 */
export function useJobProgress(jobId, { onProgress, onCompleted } = {}) {
  const { socket, status } = useSocket()
  const handlersRef = useRef({ onProgress, onCompleted })
  handlersRef.current = { onProgress, onCompleted }

  useEffect(() => {
    if (!socket || !jobId || status !== 'connected') return

    const progress = (data) => {
      if (data.jobId === jobId) handlersRef.current.onProgress?.(data)
    }
    const completed = (data) => {
      if (data.jobId === jobId) handlersRef.current.onCompleted?.(data)
    }

    socket.emit('subscribe:job', { jobId })
    socket.on('job:progress', progress)
    socket.on('job:completed', completed)

    return () => {
      socket.emit('unsubscribe:job', { jobId })
      socket.off('job:progress', progress)
      socket.off('job:completed', completed)
    }
  }, [socket, jobId, status])
}

/**
 * Subscribe to the live prediction feed.
 * @param {Function} onPrediction called for each freshly-scored transaction
 * @param {boolean} enabled
 */
export function useFeed(onPrediction, enabled = true) {
  const { socket, status } = useSocket()
  const handlerRef = useRef(onPrediction)
  handlerRef.current = onPrediction

  useEffect(() => {
    if (!socket || !enabled || status !== 'connected') return

    const handler = (data) => handlerRef.current?.(data)
    socket.emit('subscribe:feed')
    socket.on('feed:prediction', handler)

    return () => {
      socket.emit('unsubscribe:feed')
      socket.off('feed:prediction', handler)
    }
  }, [socket, enabled, status])
}
