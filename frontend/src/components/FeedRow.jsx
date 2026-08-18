/**
 * One freshly-scored transaction, as it arrives.
 *
 * Shared by the live feed and the batch-job detail, so a scored transaction
 * looks identical wherever it surfaces.
 *
 * Motion: rows slide down from above with a glow flash in their risk colour
 * that decays over ~600ms — data landing on a radar rather than a list item
 * fading in. A CRITICAL row flashes harder and keeps a soft pulse on its badge
 * while it is still new, then settles to static.
 */

import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { RISK_META, formatMoney, formatTime } from '../lib/format.js'
import { RiskBadge } from './ui/RiskBadge.jsx'

/** How long a row counts as "new" and keeps pulsing. */
const NEW_MS = 5000

export function FeedRow({ item, onSelect, index = 0 }) {
  const reduceMotion = useReducedMotion()
  const [isNew, setIsNew] = useState(true)
  const meta = RISK_META[item.riskLevel] ?? RISK_META.CLEAR
  const critical = item.riskLevel === 'CRITICAL'

  useEffect(() => {
    const timer = setTimeout(() => setIsNew(false), NEW_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <motion.li
      layout
      initial={
        reduceMotion
          ? { opacity: 0 }
          : { opacity: 0, y: -14, boxShadow: `0 0 0 1px rgba(${meta.rgb},0.9), 0 0 ${critical ? 34 : 20}px rgba(${meta.rgb},${critical ? 0.6 : 0.4})` }
      }
      animate={{ opacity: 1, y: 0, boxShadow: '0 0 0 0 rgba(0,0,0,0)' }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : {
              y: { type: 'spring', stiffness: 420, damping: 34 },
              opacity: { duration: 0.2 },
              // The flash decays on its own curve, slower for critical rows.
              boxShadow: { duration: critical ? 0.95 : 0.6, ease: 'easeOut' },
            }
      }
      className="border-b border-hairline last:border-b-0"
    >
      <button
        onClick={() => onSelect?.(item)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-raised"
      >
        <span className="num w-[62px] shrink-0 text-[10.5px] text-dim">
          {formatTime(item.receivedAt ?? Date.now())}
        </span>

        <span className="num min-w-0 flex-1 truncate text-[11.5px] text-dim">{item.txnId}</span>

        <span className="label-caps hidden w-[68px] shrink-0 text-dim sm:block">{item.txnType}</span>

        <span className="num w-[110px] shrink-0 text-right text-[12.5px] text-text">
          {formatMoney(item.amount)}
        </span>

        <span className="w-[100px] shrink-0 text-right">
          <RiskBadge
            level={item.riskLevel}
            size="sm"
            glow={critical}
            pulse={critical && isNew && !reduceMotion}
          />
        </span>

        <span className="num w-[30px] shrink-0 text-right text-[12.5px]" style={{ color: meta.color }}>
          {item.riskScore}
        </span>
      </button>
    </motion.li>
  )
}
