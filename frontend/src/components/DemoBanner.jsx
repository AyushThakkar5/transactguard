/**
 * Demo-mode banner.
 *
 * Shown only while signed in as the public demo account. Its job is to make
 * disabled actions read as deliberate rather than broken — a reviewer who
 * clicks Upload and gets a 403 should already know why.
 *
 * Dismissal is remembered for the tab (sessionStorage), not forever: a new
 * session should be told again, but nobody should have to close it twice while
 * clicking around.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { Eye, X } from 'lucide-react'
import { useAuth } from '../store/auth.js'
import { isDemoUser } from '../lib/demo.js'

const DISMISS_KEY = 'tg.demoBannerDismissed'

export function DemoBanner() {
  const user = useAuth((s) => s.user)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1')

  if (!isDemoUser(user) || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        style={{ overflow: 'hidden' }}
      >
        <div
          role="status"
          className="flex items-start gap-2.5 border-b px-6 py-2.5 md:px-8"
          style={{
            borderColor: 'rgba(99,102,241,0.35)',
            background: 'rgba(99,102,241,0.08)',
          }}
        >
          <Eye
            className="mt-[2px] h-3.5 w-3.5 shrink-0"
            strokeWidth={1.8}
            style={{ color: 'var(--accent)' }}
            aria-hidden="true"
          />
          <p className="flex-1 text-[12.5px] leading-relaxed text-text">
            You&rsquo;re viewing a live read-only demo — actions like delete, upload, and user
            management are disabled.
          </p>
          <button
            onClick={() => {
              sessionStorage.setItem(DISMISS_KEY, '1')
              setDismissed(true)
            }}
            aria-label="Dismiss demo notice"
            className="-mr-1 -mt-0.5 shrink-0 rounded-control p-1 text-dim transition-colors duration-200 hover:text-text"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
