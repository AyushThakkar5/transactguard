/**
 * Role chip.
 *
 * ADMIN carries the accent colour and a faint glow; everything else stays dim.
 * The point is that a glance at the sidebar tells you which mode you are in
 * before you click something that will be refused.
 */

import { roleStyle } from '../../lib/permissions.js'
import { cn } from '../../lib/cn.js'

export function RoleChip({ role, className }) {
  if (!role) return null
  const style = roleStyle(role)

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-control border px-1.5 py-[1px] label-caps',
        className,
      )}
      style={{ color: style.color, borderColor: style.border, boxShadow: style.glow }}
    >
      {role}
    </span>
  )
}
