/**
 * Split-screen shell shared by login and signup.
 *
 * Left: a live stats panel with a drifting particle field that leans toward the
 * cursor. Right: the form. Below 900px the panel collapses away entirely — on a
 * phone the form is the only thing that matters, and a decorative half-screen
 * would push it below the fold.
 *
 * The stats come from the one unauthenticated endpoint in the API
 * (/analytics/public-stats): aggregate counts only, nothing identifying, since
 * by definition nobody has a token yet.
 */

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { api } from '../../lib/api.js'
import { formatCount } from '../../lib/format.js'
import { useCountUp } from '../../hooks/useCountUp.js'

/**
 * Ambient dot field with cursor parallax.
 *
 * Dots drift on their own and lean toward the pointer by a capped offset — the
 * cap is what keeps it calm; uncapped tracking reads as jittery and demands
 * attention the login form should be getting.
 */
function ParticleField() {
  const canvasRef = useRef(null)
  const target = useRef({ x: 0, y: 0 })
  const current = useRef({ x: 0, y: 0 })
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = canvas.offsetWidth
    let height = canvas.offsetHeight

    const resize = () => {
      width = canvas.offsetWidth
      height = canvas.offsetHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Seeded so the field looks identical on every load rather than reshuffling.
    let seed = 1337
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    const dots = Array.from({ length: 46 }, () => ({
      x: rand(),
      y: rand(),
      r: 0.7 + rand() * 1.7,
      // Depth: farther dots move less, which is what sells the parallax.
      depth: 0.3 + rand() * 0.7,
      driftX: (rand() - 0.5) * 0.06,
      driftY: (rand() - 0.5) * 0.06,
    }))

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      // Normalised to [-1, 1] from the panel centre.
      target.current = {
        x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
        y: ((e.clientY - rect.top) / rect.height - 0.5) * 2,
      }
    }
    window.addEventListener('mousemove', onMove)

    const MAX_SHIFT = 16 // px — the cap that keeps it from feeling twitchy
    let raf
    let t = 0

    const frame = () => {
      t += 1
      // Ease toward the pointer rather than snapping to it.
      current.current.x += (target.current.x - current.current.x) * 0.045
      current.current.y += (target.current.y - current.current.y) * 0.045

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, width, height)

      for (const dot of dots) {
        const driftX = reduceMotion ? 0 : Math.sin(t * 0.004 + dot.x * 10) * 6 * dot.depth
        const driftY = reduceMotion ? 0 : Math.cos(t * 0.003 + dot.y * 10) * 6 * dot.depth
        const px = dot.x * width + driftX + (reduceMotion ? 0 : current.current.x * MAX_SHIFT * dot.depth)
        const py = dot.y * height + driftY + (reduceMotion ? 0 : current.current.y * MAX_SHIFT * dot.depth)

        ctx.fillStyle = `rgba(99,102,241,${0.10 + dot.depth * 0.24})`
        ctx.shadowBlur = 8 * dot.depth
        ctx.shadowColor = 'rgba(99,102,241,0.5)'
        ctx.beginPath()
        ctx.arc(px, py, dot.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.shadowBlur = 0

      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('resize', resize)
    }
  }, [reduceMotion])

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
}

/**
 * Types the tagline out once on load.
 *
 * Reduced motion gets the finished string immediately — a caret crawling across
 * the screen is exactly the kind of thing that setting exists to stop.
 */
function Typewriter({ text, speed = 34 }) {
  const reduceMotion = useReducedMotion()
  const [shown, setShown] = useState(reduceMotion ? text : '')
  const [done, setDone] = useState(reduceMotion)

  useEffect(() => {
    if (reduceMotion) {
      setShown(text)
      setDone(true)
      return
    }
    let i = 0
    const timer = setInterval(() => {
      i += 1
      setShown(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(timer)
        setDone(true)
      }
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed, reduceMotion])

  return (
    <p className="display min-h-[62px] text-[22px] leading-[1.35] text-text">
      {shown}
      {!done && (
        <span
          className="ml-0.5 inline-block h-[19px] w-[2px] translate-y-[2px] bg-accent"
          style={{ boxShadow: 'var(--accent-glow)', animation: 'caret 1s steps(2) infinite' }}
          aria-hidden="true"
        />
      )}
    </p>
  )
}

function LiveStat({ label, value, delay = 0 }) {
  const shown = useCountUp(value, { duration: 900, enabled: typeof value === 'number' })
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <p className="label-caps text-dim">{label}</p>
      <p className="num mt-1 text-[19px] text-text">
        {typeof value === 'number' ? formatCount(shown) : '—'}
      </p>
    </motion.div>
  )
}

export function AuthShell({ children }) {
  const stats = useQuery({
    queryKey: ['public-stats'],
    queryFn: () => api.get('/analytics/public-stats'),
    retry: 1,
    staleTime: 60_000,
  })

  const s = stats.data

  return (
    <div className="flex min-h-screen bg-void">
      <style>{`@keyframes caret { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      {/* Left panel */}
      <div className="relative hidden w-[46%] max-w-[560px] flex-col justify-between overflow-hidden border-r border-hairline bg-surface p-10 lg:flex">
        <ParticleField />

        <div className="relative z-10">
          <span className="display text-[20px] text-text">TransactGuard</span>
        </div>

        <div className="relative z-10">
          <Typewriter text="Every transaction scored, every decision recorded." />
          <p className="mt-3 max-w-[42ch] text-[13px] leading-relaxed text-dim">
            Real-time payment fraud detection. Transactions are ingested, scored by an explainable
            model, and queued for analyst review.
          </p>
        </div>

        <div className="relative z-10">
          <div className="grid grid-cols-2 gap-6 border-t border-hairline pt-6">
            <LiveStat label="Transactions scored" value={s?.scored} delay={0.05} />
            <LiveStat label="Critical flagged" value={s?.critical} delay={0.12} />
            <LiveStat label="Countries monitored" value={s?.countries} delay={0.19} />
            <div>
              <p className="label-caps text-dim">Model</p>
              <p className="num mt-1 text-[19px] text-text">{s?.modelVersion ?? '—'}</p>
            </div>
          </div>
          {stats.isError && (
            <p className="mt-4 text-[11.5px] text-dim">
              Live figures unavailable — the API is not responding on port 4000.
            </p>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  )
}
