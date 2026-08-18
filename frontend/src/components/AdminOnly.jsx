/**
 * Guard for admin-only routes.
 *
 * Renders an explanation rather than a blank page or a redirect. Someone who
 * followed a link, or kept a bookmark from an admin session, should be told
 * what happened and what their role can do instead.
 */

import { ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth.js'
import { isAdmin } from '../lib/permissions.js'
import { PageHeader, PageBody } from './layout/AppShell.jsx'
import { Card } from './ui/Card.jsx'
import { RoleChip } from './ui/RoleChip.jsx'

export function AdminOnly({ children }) {
  const user = useAuth((s) => s.user)

  if (isAdmin(user)) return children

  return (
    <>
      <PageHeader title="Admins only" />
      <PageBody>
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <ShieldAlert
            className="mb-4 h-6 w-6"
            strokeWidth={1.5}
            style={{ color: 'var(--suspicious)' }}
            aria-hidden="true"
          />
          <p className="display text-[17px] text-text">This page is restricted to administrators.</p>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-dim">
            You are signed in as <RoleChip role={user?.role} className="mx-0.5" />, which can read
            and work the queue but not manage accounts. Ask an administrator if you need access.
          </p>
          <Link
            to="/dashboard"
            className="mt-5 text-[12.5px] text-accent transition-colors duration-200 hover:text-text"
          >
            Back to dashboard
          </Link>
        </Card>
      </PageBody>
    </>
  )
}
