/**
 * Toast surface. Bottom-right, stacked, dismissible.
 *
 * Tone drives a coloured left edge and matching glow, reusing the same risk
 * palette the rest of the product speaks in — green for done, rose for failed.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { Check, X, AlertTriangle } from 'lucide-react'
import { useToasts } from '../../store/toast.js'

const TONE = {
  success: { color: 'var(--clear)', glow: 'var(--clear-glow)', Icon: Check },
  error: { color: 'var(--critical)', glow: 'var(--critical-glow)', Icon: AlertTriangle },
  info: { color: 'var(--accent)', glow: 'var(--accent-glow)', Icon: Check },
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[320px] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const tone = TONE[t.tone] ?? TONE.info
          const Icon = tone.Icon
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-card border border-hairline bg-surface p-3"
              style={{ borderLeft: `2px solid ${tone.color}`, boxShadow: tone.glow }}
            >
              <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={2} style={{ color: tone.color }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-text">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">{t.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 rounded-control p-1 text-dim transition-colors duration-200 hover:text-text"
              >
                <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
