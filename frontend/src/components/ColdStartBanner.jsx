/**
 * Cold-start notice.
 *
 * Free-tier hosts suspend a service after ~15 minutes idle and take up to a
 * minute to wake it. Without an explanation the first visit of the day looks
 * like a broken app, and most people close the tab well before 50 seconds.
 *
 * It appears only once a request has already been waiting a couple of seconds,
 * so a warm server never shows it at all.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { onColdStart } from '../lib/api.js'

export function ColdStartBanner() {
  const [waking, setWaking] = useState(false)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => onColdStart(setWaking), [])

  useEffect(() => {
    if (!waking) {
      setSeconds(0)
      return
    }
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [waking])

  return (
    <AnimatePresence>
      {waking && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="fixed left-1/2 top-4 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-card border px-4 py-2.5"
          style={{
            borderColor: 'rgba(99,102,241,0.4)',
            background: 'var(--surface)',
            boxShadow: 'var(--accent-glow)',
          }}
        >
          <Loader2
            className="h-3.5 w-3.5 animate-spin"
            strokeWidth={2}
            style={{ color: 'var(--accent)' }}
            aria-hidden="true"
          />
          <div>
            <p className="text-[12.5px] text-text">
              Waking up the server
              {seconds > 6 && <span className="num text-dim"> · {seconds}s</span>}
            </p>
            <p className="text-[11px] text-dim">
              The free tier sleeps when idle — this can take up to a minute on the first visit.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
