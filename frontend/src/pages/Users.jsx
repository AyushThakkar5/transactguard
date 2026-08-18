/**
 * Users — administrator account management.
 *
 * Admin-only, and hidden from the nav for everyone else. A role can be moved
 * between ANALYST and VIEWER inline; ADMIN is deliberately absent from the
 * options because the API refuses to grant it. Promotion to administrator is a
 * database action, so that a single compromised admin session cannot mint more
 * administrators.
 *
 * Rows for administrators, and the row for the signed-in user, render their
 * role as static text rather than a control — the API would refuse those edits,
 * and offering a dropdown that always fails is worse than offering none.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Users as UsersIcon, Lock } from 'lucide-react'

import { api, ApiError } from '../lib/api.js'
import { useAuth } from '../store/auth.js'
import { toast } from '../store/toast.js'
import { formatDate, formatCount } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card, CardHeader, CardTitle } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Select } from '../components/ui/Input.jsx'
import { SkeletonTable } from '../components/ui/Skeleton.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { RoleChip } from '../components/ui/RoleChip.jsx'

const ASSIGNABLE = ['ANALYST', 'VIEWER']

function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

export default function Users() {
  const queryClient = useQueryClient()
  const me = useAuth((s) => s.user)

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/auth/users'),
  })

  const changeRole = useMutation({
    mutationFn: ({ id, role }) => api.patch(`/auth/users/${id}/role`, { role }),
    onSuccess: (data) => {
      const u = data.user
      toast.success(`${u.name} is now ${u.role}`, u.email)
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (err) => {
      toast.error(
        'Could not change that role',
        err instanceof ApiError
          ? err.message
          : 'The API did not respond. Check that the backend is running on port 4000.',
      )
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const rows = users.data?.users ?? []
  const adminCount = rows.filter((u) => u.role === 'ADMIN').length

  return (
    <>
      <PageHeader
        title="Users"
        description="Every registered account. Roles can be moved between analyst and viewer."
        actions={
          users.data && (
            <span className="num text-[12px] text-dim">
              {formatCount(users.data.count)} account{users.data.count === 1 ? '' : 's'}
            </span>
          )
        }
      />

      <PageBody className="flex flex-col gap-4">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
            <span className="flex items-center gap-1.5 text-[11px] text-dim">
              <ShieldCheck className="h-3 w-3" strokeWidth={1.7} aria-hidden="true" />
              {adminCount} administrator{adminCount === 1 ? '' : 's'}
            </span>
          </CardHeader>

          {users.isLoading ? (
            <SkeletonTable rows={5} columns={4} />
          ) : users.isError ? (
            <EmptyState
              icon={UsersIcon}
              title="Accounts could not be loaded."
              description={
                users.error instanceof ApiError && users.error.status === 403
                  ? 'Your role cannot list accounts.'
                  : 'The API did not respond. Check that the backend is running on port 4000.'
              }
              action={
                <Button variant="outline" onClick={() => users.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No accounts yet." />
          ) : (
            <>
              {/* Table — 640px and up */}
              <table className="hidden w-full border-collapse sm:table">
                <thead className="border-b border-hairline bg-void/40">
                  <tr>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Name</th>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Email</th>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Joined</th>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const isSelf = u.id === me?.id
                    const locked = u.role === 'ADMIN' || isSelf
                    const pending = changeRole.isPending && changeRole.variables?.id === u.id

                    return (
                      <tr key={u.id} className="border-b border-hairline last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-hairline text-[9.5px] text-dim">
                              {initials(u.name)}
                            </span>
                            <span className="text-[12.5px] text-text">{u.name}</span>
                            {isSelf && <span className="label-caps text-dim">you</span>}
                          </div>
                        </td>
                        <td className="num px-4 py-3 text-[11.5px] text-dim">{u.email}</td>
                        <td className="num px-4 py-3 text-[11.5px] text-dim">
                          {formatDate(u.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          {locked ? (
                            <span className="flex items-center gap-2">
                              <RoleChip role={u.role} />
                              <span
                                className="flex items-center gap-1 text-[10.5px] text-dim"
                                title={
                                  isSelf
                                    ? 'You cannot change your own role'
                                    : 'Administrator roles are changed in the database, not through the API'
                                }
                              >
                                <Lock className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
                                {isSelf ? 'self' : 'locked'}
                              </span>
                            </span>
                          ) : (
                            <Select
                              aria-label={`Role for ${u.name}`}
                              value={u.role}
                              disabled={pending}
                              onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value })}
                              className="h-7 w-[110px] text-[12px]"
                            >
                              {ASSIGNABLE.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </Select>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Stacked cards — below 640px */}
              <ul className="sm:hidden">
                {rows.map((u) => {
                  const locked = u.role === 'ADMIN' || u.id === me?.id
                  return (
                    <li key={u.id} className="border-b border-hairline px-4 py-3 last:border-b-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[12.5px] text-text">{u.name}</p>
                          <p className="num mt-0.5 truncate text-[11px] text-dim">{u.email}</p>
                          <p className="num mt-1 text-[10.5px] text-dim">{formatDate(u.createdAt)}</p>
                        </div>
                        {locked ? (
                          <RoleChip role={u.role} />
                        ) : (
                          <Select
                            aria-label={`Role for ${u.name}`}
                            value={u.role}
                            onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value })}
                            className="h-7 w-[104px] shrink-0 text-[12px]"
                          >
                            {ASSIGNABLE.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </Select>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Card>

        <Card className="flex items-start gap-2.5 px-5 py-3.5">
          <Lock className="mt-[2px] h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={1.7} aria-hidden="true" />
          <p className="text-[11.5px] leading-relaxed text-dim">
            <span className="text-text">Administrator cannot be granted here.</span> The API accepts
            only ANALYST and VIEWER, refuses any change to an existing administrator, and refuses to
            let you change your own role — so a single compromised admin session cannot mint more
            administrators or lock everyone else out. Promotion is a deliberate database action.
          </p>
        </Card>
      </PageBody>
    </>
  )
}
