/**
 * Login.
 *
 * Sits inside the split-screen AuthShell — live stats and the drifting particle
 * field on the left, the form on the right.
 */

import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Eye } from 'lucide-react'

import { useAuth } from '../store/auth.js'
import { ApiError } from '../lib/api.js'
import { AuthShell } from '../components/layout/AuthShell.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Field, Input } from '../components/ui/Input.jsx'
import { DEMO_EMAIL, DEMO_PASSWORD } from '../lib/demo.js'

/** Backend error codes mapped to something a person can act on. */
function messageFor(error) {
  if (!(error instanceof ApiError)) {
    return 'Could not reach the API. Check that the backend is running on port 4000.'
  }
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'That email and password do not match an account.'
    case 'FORBIDDEN':
      return 'This account has been deactivated. Contact an administrator.'
    case 'RATE_LIMITED':
      return error.message // already says how long to wait
    case 'VALIDATION_ERROR':
      return error.details?.[0]?.message ?? 'Check the details you entered.'
    case 'SERVICE_UNAVAILABLE':
      return 'The authentication service is temporarily unavailable. Try again shortly.'
    default:
      return error.message
  }
}

export default function Login() {
  const login = useAuth((s) => s.login)
  const navigate = useNavigate()
  const location = useLocation()

  // Deliberately empty. Pre-filling these once put a working admin credential
  // on screen for anyone who opened the page — signing in as an admin must
  // require knowing the credentials, not reading them.
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)

  async function signIn(credentials, target) {
    setError(null)
    try {
      await login(credentials)
      navigate(target ?? location.state?.from ?? '/dashboard', { replace: true })
    } catch (err) {
      setError(messageFor(err))
      throw err
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      await signIn({ email, password })
    } catch {
      // messageFor already surfaced it
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * One-click demo entry.
   *
   * The fields are filled visibly before submitting, so the reviewer can see
   * which account they are being signed into rather than being teleported in by
   * an opaque button.
   */
  async function handleDemo() {
    setDemoLoading(true)
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    try {
      await new Promise((r) => setTimeout(r, 320))
      await signIn({ email: DEMO_EMAIL, password: DEMO_PASSWORD }, '/dashboard')
    } catch {
      // messageFor already surfaced it
    } finally {
      setDemoLoading(false)
    }
  }

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Wordmark repeats here for the mobile layout, where the panel is hidden. */}
        <div className="mb-7 lg:hidden">
          <span className="display text-[22px] text-text">TransactGuard</span>
        </div>

        <h1 className="display text-[24px] text-text">Sign in</h1>
        <p className="mt-1.5 text-[13px] text-dim">Continue to the investigation console.</p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </Field>

          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-control border-l-2 border-critical px-3 py-2 text-[12.5px] leading-relaxed text-critical"
              style={{ background: 'rgba(244,63,94,0.10)' }}
            >
              {error}
            </motion.p>
          )}

          <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-1 w-full">
            {submitting ? 'Signing in' : 'Sign in'}
            {!submitting && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
          </Button>
        </form>

        {/* Secondary to the real sign-in: outline, smaller, below a divider. */}
        <div className="mt-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-hairline" />
          <span className="label-caps text-dim">or</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-4 w-full"
          loading={demoLoading}
          onClick={handleDemo}
        >
          {!demoLoading && <Eye className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
          {demoLoading ? 'Opening demo' : 'View live demo'}
        </Button>
        <p className="mt-2 text-center text-[11.5px] text-dim">
          Explore with a read-only demo account
        </p>

        <p className="mt-5 text-center text-[12.5px] text-dim">
          No account?{' '}
          <Link to="/register" className="text-accent transition-colors duration-200 hover:text-text">
            Create one
          </Link>
        </p>
      </motion.div>
    </AuthShell>
  )
}
