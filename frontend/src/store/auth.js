/**
 * Authentication state.
 *
 * The access token lives here in memory only — see lib/api.js for why. The
 * store mirrors it into the api module so the fetch wrapper can attach it
 * without importing React.
 */

import { create } from 'zustand'
import {
  api,
  clearTokens,
  getRefreshToken,
  onAuthenticationLost,
  setAccessToken,
  setRefreshToken,
} from '../lib/api.js'

export const useAuth = create((set, get) => ({
  user: null,
  // Starts true: a page reload may still be recoverable from the stored refresh
  // token, and routing must wait for that answer rather than flashing /login.
  initialising: true,
  isAuthenticated: false,

  async login({ email, password }) {
    const data = await api.post('/auth/login', { email, password })
    setAccessToken(data.tokens.accessToken)
    setRefreshToken(data.tokens.refreshToken)
    set({ user: data.user, isAuthenticated: true, initialising: false })
    return data.user
  },

  async logout() {
    try {
      // Sends the refresh token too, so the whole session is revoked rather
      // than just the 15-minute access leg.
      await api.post('/auth/logout', { refreshToken: getRefreshToken() ?? undefined })
    } catch {
      // A failed logout call must still clear local state.
    }
    clearTokens()
    set({ user: null, isAuthenticated: false, initialising: false })
  },

  /**
   * Restore a session on boot.
   *
   * Exchanges the stored refresh token for an access token, then confirms it by
   * loading the user. Any failure is a clean logged-out state, not an error.
   */
  async restore() {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      set({ initialising: false, isAuthenticated: false })
      return
    }

    try {
      const refreshed = await api.post('/auth/refresh', { refreshToken })
      setAccessToken(refreshed.accessToken)
      const { user } = await api.get('/auth/me')
      set({ user, isAuthenticated: true, initialising: false })
    } catch {
      clearTokens()
      set({ user: null, isAuthenticated: false, initialising: false })
    }
  },
}))

// When a refresh fails mid-session, drop straight to a logged-out state.
onAuthenticationLost(() => {
  useAuth.setState({ user: null, isAuthenticated: false, initialising: false })
})
