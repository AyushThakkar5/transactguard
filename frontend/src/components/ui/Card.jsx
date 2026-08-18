/**
 * Surface panel.
 *
 * `risk` makes the card itself radiate rather than relying on a badge alone —
 * a critical item should feel dangerous before it is read.
 */

import { RISK_META } from '../../lib/format.js'
import { cn } from '../../lib/cn.js'

export function Card({ className, risk, children, style, ...props }) {
  const meta = risk ? RISK_META[risk] : null
  return (
    <div
      className={cn('rounded-card border bg-surface', className)}
      style={{
        borderColor: meta ? `rgba(${meta.rgb},0.28)` : 'var(--hairline)',
        boxShadow: meta?.glow,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 border-b border-hairline px-5 py-3.5', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }) {
  return <h2 className={cn('label-caps text-dim', className)}>{children}</h2>
}
