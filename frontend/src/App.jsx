/**
 * Routing and the auth boundary.
 *
 * Heavy pages are lazily loaded so their dependencies (Recharts, d3-force,
 * the world atlas) never enter the main bundle.
 */

import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './store/auth.js'
import { SocketProvider } from './hooks/useSocket.jsx'
import { AppShell } from './components/layout/AppShell.jsx'
import { Toaster } from './components/ui/Toaster.jsx'
import { ColdStartBanner } from './components/ColdStartBanner.jsx'
import Login from './pages/Login.jsx'
import Signup from './pages/Signup.jsx'
import Transactions from './pages/Transactions.jsx'
import Cases from './pages/Cases.jsx'
import LiveFeed from './pages/LiveFeed.jsx'
import Jobs from './pages/Jobs.jsx'
import Upload from './pages/Upload.jsx'
import Users from './pages/Users.jsx'
import { AdminOnly } from './components/AdminOnly.jsx'

const Insights = lazy(() => import('./pages/Insights.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))

function FullPageMessage({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-void">
      <p className="text-[13px] text-dim">{children}</p>
    </div>
  )
}

/** Blocks a route until the session is known, so /login never flashes on reload. */
function RequireAuth({ children }) {
  const { isAuthenticated, initialising } = useAuth()
  const location = useLocation()

  if (initialising) return <FullPageMessage>Restoring session…</FullPageMessage>
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

/** Public routes bounce to the app once a session exists. */
function RedirectIfAuthed({ children }) {
  const { isAuthenticated, initialising } = useAuth()
  if (initialising) return <FullPageMessage>Restoring session…</FullPageMessage>
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children
}

const lazyRoute = (Component, label) => (
  <Suspense fallback={<FullPageMessage>Loading {label}…</FullPageMessage>}>
    <Component />
  </Suspense>
)

export default function App() {
  const restore = useAuth((s) => s.restore)

  useEffect(() => {
    restore()
  }, [restore])

  return (
    <BrowserRouter>
      {/* One socket for the whole session, opened after login. */}
      <SocketProvider>
        <Routes>
          <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
          <Route path="/register" element={<RedirectIfAuthed><Signup /></RedirectIfAuthed>} />

          <Route
            path="/*"
            element={
              <RequireAuth>
                <AppShell>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={lazyRoute(Dashboard, 'dashboard')} />
                    <Route path="/transactions" element={<Transactions />} />
                    <Route path="/insights" element={lazyRoute(Insights, 'map')} />
                    <Route path="/cases" element={<Cases />} />
                    <Route path="/live-feed" element={<LiveFeed />} />
                    <Route path="/jobs" element={<Jobs />} />
                    <Route path="/upload" element={<Upload />} />
                    {/* Rendered for anyone; AdminOnly explains the refusal rather
                        than redirecting to a blank page. */}
                    <Route path="/users" element={<AdminOnly><Users /></AdminOnly>} />
                    <Route
                      path="*"
                      element={
                        <div className="flex min-h-[60vh] items-center justify-center">
                          <div className="text-center">
                            <p className="display text-[19px] text-text">That page does not exist.</p>
                            <p className="mt-2 text-[13px] text-dim">
                              Pick a destination from the sidebar.
                            </p>
                          </div>
                        </div>
                      }
                    />
                  </Routes>
                </AppShell>
              </RequireAuth>
            }
          />
        </Routes>
        <ColdStartBanner />
        <Toaster />
      </SocketProvider>
    </BrowserRouter>
  )
}
