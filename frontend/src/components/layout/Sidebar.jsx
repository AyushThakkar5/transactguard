/**
 * Sidebar navigation.
 *
 * Icons in --text-dim, switching to --accent when active, alongside the
 * hairline tick that marks position. The tick now glows, which on dark is what
 * makes the active row read at a glance.
 */

import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Globe, FolderSearch, Radio, Layers, Upload, Users, LogOut,
} from 'lucide-react'
import { useAuth } from '../../store/auth.js'
import { cn } from '../../lib/cn.js'
import { isAdmin } from '../../lib/permissions.js'
import { RoleChip } from '../ui/RoleChip.jsx'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/insights', label: 'Insights', icon: Globe },
  { to: '/cases', label: 'Cases', icon: FolderSearch },
  { to: '/live-feed', label: 'Live feed', icon: Radio },
  { to: '/jobs', label: 'Batch jobs', icon: Layers },
  { to: '/upload', label: 'Upload', icon: Upload },
  // Rendered only for administrators — see visibleNav below.
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
]

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-2.5 py-2 pl-5 pr-4 text-[13px]',
          'transition-colors duration-150',
          isActive ? 'font-medium text-text' : 'text-dim hover:text-text',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 transition-opacity duration-200"
            style={{
              background: 'var(--accent)',
              boxShadow: isActive ? 'var(--accent-glow)' : undefined,
              opacity: isActive ? 1 : 0,
            }}
          />
          <Icon
            className="h-[15px] w-[15px] shrink-0 transition-colors duration-150"
            strokeWidth={1.6}
            style={{ color: isActive ? 'var(--accent)' : undefined }}
            aria-hidden="true"
          />
          {label}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  // Filtered rather than disabled: a nav entry that cannot be opened is noise.
  const visibleNav = NAV.filter((item) => !item.adminOnly || isAdmin(user))

  return (
    <aside className="relative z-10 hidden w-[220px] shrink-0 flex-col border-r border-hairline bg-surface md:flex">
      <div className="px-5 pb-7 pt-7">
        <span className="display text-[19px] text-text">TransactGuard</span>
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {visibleNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      <div className="mt-auto border-t border-hairline px-5 py-4">
        {user && (
          <div className="mb-3">
            <p className="truncate text-[12.5px] font-medium text-text">{user.name}</p>
            <div className="mt-1"><RoleChip role={user.role} /></div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-[12.5px] text-dim transition-colors duration-150 hover:text-text"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

/** Bottom bar below 768px. */
export function MobileNav() {
  const location = useLocation()
  const user = useAuth((s) => s.user)
  const visibleNav = NAV.filter((item) => !item.adminOnly || isAdmin(user))

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-hairline bg-surface md:hidden"
    >
      {visibleNav.map(({ to, label, icon: Icon }) => {
        const active = location.pathname.startsWith(to)
        return (
          <NavLink
            key={to}
            to={to}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-1 px-3 py-2.5 text-center text-[10.5px]',
              active ? 'font-medium text-text' : 'text-dim',
            )}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-3 top-0 h-px transition-opacity"
              style={{
                background: 'var(--accent)',
                boxShadow: active ? 'var(--accent-glow)' : undefined,
                opacity: active ? 1 : 0,
              }}
            />
            <Icon
              className="h-4 w-4"
              strokeWidth={1.6}
              style={{ color: active ? 'var(--accent)' : undefined }}
              aria-hidden="true"
            />
            {label}
          </NavLink>
        )
      })}
    </nav>
  )
}
