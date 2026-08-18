/**
 * API client.
 *
 * One fetch wrapper for the whole app, with a 401 interceptor that refreshes
 * the access token and replays the original request exactly once.
 *
 * TOKEN STORAGE — the reasoning, since there is no perfect option client-side:
 *
 *   Access token  → in memory (Zustand) only. Never written to disk, so an XSS
 *                   payload cannot read it out of localStorage after the fact,
 *                   and it dies with the tab. It lives 15 minutes anyway.
 *
 *   Refresh token → sessionStorage, not localStorage. Truly safe storage means
 *                   an httpOnly cookie, which the API cannot set without a
 *                   same-site backend proxy or a CORS credentials setup that
 *                   Step 2 did not build. sessionStorage is the honest middle
 *                   ground: it survives a page reload (so refreshing the tab
 *                   does not log you out) but is scoped to the tab and cleared
 *                   when it closes, unlike localStorage which persists
 *                   indefinitely across every tab.
 *
 * The real fix is an httpOnly, SameSite=Strict cookie issued by the API. That
 * is a backend change, so it is noted rather than done.
 */

/**
 * API base.
 *
 * Empty in development: requests go to /api/v1 and Vite proxies them, which
 * keeps the app same-origin and avoids CORS entirely. In production the API
 * lives on another host, so VITE_API_URL supplies its origin at build time.
 */
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const API_BASE = `${API_ORIGIN}/api/v1`

export const apiOrigin = API_ORIGIN

const REFRESH_KEY = 'tg.refreshToken'

/**
 * Cold-start signalling.
 *
 * Free-tier hosts suspend an idle service and take up to ~50s to wake it. A
 * request that hangs that long looks broken, so anything still in flight after
 * a short grace period flips this flag and the UI can explain the wait rather
 * than leaving someone staring at a spinner.
 */
const COLD_START_AFTER_MS = 2500
let coldStartListeners = new Set()
let inFlight = 0
let coldTimer = null
let isCold = false

function setCold(next) {
  if (isCold === next) return
  isCold = next
  for (const fn of coldStartListeners) fn(next)
}

export function onColdStart(listener) {
  coldStartListeners.add(listener)
  return () => coldStartListeners.delete(listener)
}

function requestStarted() {
  inFlight += 1
  if (inFlight === 1 && !coldTimer) {
    coldTimer = setTimeout(() => setCold(true), COLD_START_AFTER_MS)
  }
}

function requestFinished() {
  inFlight = Math.max(0, inFlight - 1)
  if (inFlight === 0) {
    clearTimeout(coldTimer)
    coldTimer = null
    setCold(false)
  }
}

/** Thrown for every non-2xx response, carrying the backend's own error code. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// --- token plumbing ---------------------------------------------------------
// Held here rather than imported from the store, so this module has no
// dependency on React and the store can call in without a cycle.

let accessToken = null
let onAuthLost = () => {}

export function setAccessToken(token) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export function setRefreshToken(token) {
  if (token) sessionStorage.setItem(REFRESH_KEY, token)
  else sessionStorage.removeItem(REFRESH_KEY)
}

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_KEY)
}

export function clearTokens() {
  accessToken = null
  sessionStorage.removeItem(REFRESH_KEY)
}

/** Registered by the auth store so a failed refresh can bounce to /login. */
export function onAuthenticationLost(handler) {
  onAuthLost = handler
}

// --- refresh ----------------------------------------------------------------

/**
 * In-flight refresh, shared.
 *
 * Several queries can 401 at the same moment; without this they would each
 * start their own refresh and all but one would be invalidated.
 */
let refreshInFlight = null

async function refreshAccessToken() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return null
      const body = await res.json()
      const next = body.data.accessToken
      setAccessToken(next)
      return next
    } catch {
      return null
    } finally {
      // Cleared on the next tick so simultaneous callers all read this result.
      setTimeout(() => {
        refreshInFlight = null
      }, 0)
    }
  })()

  return refreshInFlight
}

// --- request ----------------------------------------------------------------

async function parse(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function raw(path, { method = 'GET', body, headers = {}, signal, isRetry = false } = {}) {
  requestStarted()
  try {
    return await request(path, { method, body, headers, signal, isRetry })
  } finally {
    requestFinished()
  }
}

async function request(path, { method, body, headers, signal, isRetry }) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal,
  })

  if (res.status === 401 && !isRetry) {
    // One attempt to refresh, then replay the original request once.
    const token = await refreshAccessToken()
    if (token) return request(path, { method, body, headers, signal, isRetry: true })
    clearTokens()
    onAuthLost()
  }

  const payload = await parse(res)

  if (!res.ok) {
    const err = payload?.error ?? {}
    throw new ApiError(
      res.status,
      err.code ?? 'UNKNOWN',
      err.message ?? `Request failed with status ${res.status}`,
      err.details,
    )
  }

  // The API wraps everything as { success, data }.
  return payload?.data ?? payload
}

export const api = {
  get: (path, opts) => raw(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => raw(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => raw(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => raw(path, { ...opts, method: 'DELETE' }),
}

/** Turn a filter object into a query string, dropping empty values. */
export function qs(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, value)
  }
  const str = search.toString()
  return str ? `?${str}` : ''
}
