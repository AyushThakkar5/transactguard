/**
 * Risk level badge.
 *
 * Glyph, colour and written label together — colour is never the only carrier
 * of meaning. On dark the badge also emits its risk glow, which is what makes a
 * CRITICAL row read as hot from across a table.
 *
 * `pulse` drives the continuous breath applied to a newly-arrived critical row
 * in the live feed, for as long as it counts as new.
 */

import { RISK_META } from '../../lib/format.js'
import { cn } from '../../lib/cn.js'

export function RiskBadge({ level, size = 'md', glow = true, pulse = false, className }) {
  if (!level || !RISK_META[level]) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-control border border-hairline',
          'px-2 py-[3px] label-caps text-dim',
          className,
        )}
      >
        <span aria-hidden="true" className="text-[8px] leading-none opacity-60">○</span>
        Unscored
      </span>
    )
  }

  const meta = RISK_META[level]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control border',
        size === 'sm' ? 'px-1.5 py-[2px]' : 'px-2 py-[3px]',
        'label-caps whitespace-nowrap',
        pulse && 'breathe',
        className,
      )}
      style={{
        color: meta.color,
        backgroundColor: `rgba(${meta.rgb},0.10)`,
        borderColor: `rgba(${meta.rgb},0.45)`,
        boxShadow: glow ? meta.glow : undefined,
      }}
    >
      <span aria-hidden="true" className="text-[8px] leading-none">
        {meta.glyph}
      </span>
      {meta.label}
    </span>
  )
}
