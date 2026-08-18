/**
 * Signup.
 *
 * Same split-screen shell as login. Two things distinguish it:
 *
 * PROGRESSIVE REVEAL — name, then email, then password appear one at a time as
 * the previous one is filled. Nothing is disabled or locked; the fields are
 * simply staged, so the form reads as a short conversation instead of a wall of
 * inputs. Anyone who tabs ahead or autofills gets everything at once, because
 * the reveal is driven by content, not by focus order.
 *
 * PASSWORD STRENGTH — scored and coloured with the same risk palette the
 * product uses for transactions: crimson, amber, emerald. A fraud-scoring tool
 * scoring your password is the right kind of joke, and it reuses a system the
 * user will see everywhere else.
 */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'

import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../store/auth.js'
import { AuthShell } from '../components/layout/AuthShell.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Field, Input } from '../components/ui/Input.jsx'

/**
 * Password strength.
 *
 * The rules mirror what the API actually enforces (8+ chars, upper, lower,
 * digit), plus length and variety bonuses. Showing a bar that disagrees with
 * server validation would be worse than showing none.
 */
function scorePassword(pw) {
  if (!pw) return { score: 0, label: 'Empty', checks: [] }

  const checks = [
    { id: 'length', label: 'At least 8 characters', pass: pw.length >= 8 },
    { id: 'lower', label: 'A lowercase letter', pass: /[a-z]/.test(pw) },
    { id: 'upper', label: 'An uppercase letter', pass: /[A-Z]/.test(pw) },
    { id: 'digit', label: 'A number', pass: /[0-9]/.test(pw) },
  ]

  let score = checks.filter((c) => c.pass).length * 20 // 0-80 from the hard rules
  if (pw.length >= 12) score += 10
  if (/[^A-Za-z0-9]/.test(pw)) score += 10
  score = Math.min(100, score)

  const label = score >= 80 ? 'Strong' : score >= 50 ? 'Fair' : 'Weak'
  return { score, label, checks }
}

/** Maps strength onto the product's risk palette — weak is the dangerous one. */
function strengthColor(score) {
  if (score >= 80) return { color: 'var(--clear)', glow: 'var(--clear-glow)' }
  if (score >= 50) return { color: 'var(--suspicious)', glow: 'var(--suspicious-glow)' }
  return { color: 'var(--critical)', glow: 'var(--critical-glow)' }
}

function StrengthBar({ password }) {
  const { score, label, checks } = useMemo(() => scorePassword(password), [password])
  const { color, glow } = strengthColor(score)

  if (!password) return null

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-caps" style={{ color }}>
          {label}
        </span>
        <span className="num text-[11px] text-dim">{score}/100</span>
      </div>

      <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-hairline">
        <motion.div
          className="h-full rounded-full"
          animate={{ width: `${score}%` }}
          transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          style={{ background: color, boxShadow: glow }}
        />
      </div>

      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map((check) => (
          <li key={check.id} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-1 w-1 rounded-full transition-colors duration-200"
              style={{ background: check.pass ? 'var(--clear)' : 'var(--hairline)' }}
            />
            <span
              className="text-[10.5px] transition-colors duration-200"
              style={{ color: check.pass ? 'var(--clear)' : 'var(--text-dim)' }}
            >
              {check.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A staged field. Fades and slides in once the step before it has content. */
function Stage({ show, children, delay = 0 }) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 320, damping: 32, delay }
          }
          style={{ overflow: 'hidden' }}
        >
          <div className="pt-4">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function messageFor(error) {
  if (!(error instanceof ApiError)) {
    return 'Could not reach the API. Check that the backend is running on port 4000.'
  }
  switch (error.code) {
    case 'EMAIL_TAKEN':
      return 'An account with that email already exists. Sign in instead.'
    case 'VALIDATION_ERROR':
      return error.details?.[0]?.message ?? 'Check the details you entered.'
    case 'RATE_LIMITED':
      return error.message
    default:
      return error.message
  }
}

export default function Signup() {
  const navigate = useNavigate()
  const login = useAuth((s) => s.login)
  const reduceMotion = useReducedMotion()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [succeeded, setSucceeded] = useState(false)

  // Content-driven, not focus-driven: autofill reveals everything at once.
  const showEmail = name.trim().length >= 2
  const showPassword = showEmail && /.+@.+\..+/.test(email)

  const { score } = scorePassword(password)
  const canSubmit = showPassword && score >= 80 && !submitting

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/auth/register', { name: name.trim(), email: email.trim(), password })
      setSucceeded(true)
      // Sign the new account straight in, after a beat on the success state so
      // it registers as a confirmation rather than a flash.
      await login({ email: email.trim(), password })
      setTimeout(() => navigate('/dashboard', { replace: true }), reduceMotion ? 0 : 900)
    } catch (err) {
      setError(messageFor(err))
      setSucceeded(false)
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-7 lg:hidden">
          <span className="display text-[22px] text-text">TransactGuard</span>
        </div>

        <AnimatePresence mode="wait">
          {succeeded ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="flex flex-col items-center py-16 text-center"
            >
              <motion.div
                initial={reduceMotion ? {} : { scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.05 }}
                className="flex h-14 w-14 items-center justify-center rounded-full border"
                style={{ borderColor: 'var(--clear)', boxShadow: 'var(--clear-glow)' }}
              >
                <Check className="h-6 w-6" strokeWidth={2.2} style={{ color: 'var(--clear)' }} aria-hidden="true" />
              </motion.div>
              <p className="display mt-5 text-[19px] text-text">Account created</p>
              <p className="mt-1.5 text-[13px] text-dim">Signing you in…</p>
            </motion.div>
          ) : (
            <motion.div key="form" exit={{ opacity: 0 }}>
              <h1 className="display text-[24px] text-text">Create an account</h1>
              <p className="mt-1.5 text-[13px] text-dim">
                New accounts join as an analyst.
              </p>

              <form onSubmit={handleSubmit} className="mt-6" noValidate>
                <Field label="Full name" htmlFor="name">
                  <Input
                    id="name"
                    autoComplete="name"
                    required
                    placeholder="Riya Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>

                <Stage show={showEmail}>
                  <Field label="Email" htmlFor="email">
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      required
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </Field>
                </Stage>

                <Stage show={showPassword}>
                  <Field label="Password" htmlFor="password">
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-describedby="strength"
                    />
                  </Field>
                  <div id="strength">
                    <StrengthBar password={password} />
                  </div>
                </Stage>

                {error && (
                  <motion.p
                    role="alert"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-control border-l-2 border-critical px-3 py-2 text-[12.5px] leading-relaxed text-critical"
                    style={{ background: 'rgba(244,63,94,0.10)' }}
                  >
                    {error}
                  </motion.p>
                )}

                <Stage show={showPassword}>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={!canSubmit}
                    loading={submitting}
                    className="w-full"
                  >
                    {submitting ? 'Creating account' : 'Create account'}
                    {!submitting && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
                  </Button>
                  {password && score < 80 && (
                    <p className="mt-2 text-center text-[11.5px] text-dim">
                      Strengthen the password to continue — the API enforces the same rules.
                    </p>
                  )}
                </Stage>
              </form>

              <p className="mt-5 text-center text-[12.5px] text-dim">
                Already have an account?{' '}
                <Link to="/login" className="text-accent transition-colors duration-200 hover:text-text">
                  Sign in
                </Link>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AuthShell>
  )
}
