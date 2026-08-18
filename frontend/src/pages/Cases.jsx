/**
 * Cases — the analyst review queue as a board.
 *
 * Three columns matching the CaseStatus enum. Under Review is sorted by risk
 * score descending, which is the whole purpose of a queue: the worst thing
 * nobody has looked at should be the first thing seen.
 *
 * Drag moves a card between columns and PATCHes the case. Native HTML5 drag is
 * used rather than a pointer-based library — it is one dependency fewer and
 * carries its own accessibility affordances. Because dragging is still
 * mouse-only, every card also has a keyboard-reachable status control, so the
 * board is fully operable without a pointer.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { FolderSearch, GripVertical } from 'lucide-react'

import { api, qs, ApiError } from '../lib/api.js'
import { useUI } from '../store/ui.js'
import { toast } from '../store/toast.js'
import { RISK_META, formatCount, formatMoney } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { RiskBadge } from '../components/ui/RiskBadge.jsx'

const COLUMNS = [
  { status: 'UNDER_REVIEW', label: 'Under review', accent: 'var(--accent)' },
  { status: 'CONFIRMED_FRAUD', label: 'Confirmed fraud', accent: 'var(--critical)' },
  { status: 'FALSE_POSITIVE', label: 'False positive', accent: 'var(--clear)' },
]

const PER_COLUMN = 40

/** Initials for the assignee chip. */
function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

function CaseCard({ item, onOpen, onMove, isDragging, onDragStart, onDragEnd }) {
  const meta = RISK_META[item.riskLevel] ?? null
  const txn = item.transaction

  return (
    <motion.li
      layout
      layoutId={item.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: isDragging ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.id)
        onDragStart(item)
      }}
      onDragEnd={onDragEnd}
      className="rounded-card border bg-surface"
      style={{
        borderColor: meta ? `rgba(${meta.rgb},0.3)` : 'var(--hairline)',
        boxShadow: item.riskLevel === 'CRITICAL' ? meta?.glow : undefined,
        cursor: 'grab',
      }}
    >
      <div className="flex items-start gap-2 p-3">
        <GripVertical
          className="mt-[1px] h-3.5 w-3.5 shrink-0 text-dim"
          strokeWidth={1.6}
          aria-hidden="true"
        />

        <div className="min-w-0 flex-1">
          <button
            onClick={() => onOpen(txn?.id)}
            className="block w-full text-left transition-colors duration-200 hover:text-text"
          >
            <p className="num truncate text-[11px] text-dim">{txn?.txnId}</p>
            <p className="num mt-1 text-[14px] text-text">{formatMoney(txn?.amount)}</p>
          </button>

          <div className="mt-2 flex items-center justify-between gap-2">
            <RiskBadge level={item.riskLevel} size="sm" glow={item.riskLevel === 'CRITICAL'} />
            <span className="num text-[12px]" style={{ color: meta?.color }}>
              {item.riskScore}
            </span>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="label-caps text-dim">{txn?.txnType}</span>
            {item.assignedTo ? (
              <span
                title={item.assignedTo.name}
                className="num flex h-5 w-5 items-center justify-center rounded-full border border-hairline text-[9px] text-dim"
              >
                {initials(item.assignedTo.name)}
              </span>
            ) : (
              <span className="text-[10px] text-dim">unassigned</span>
            )}
          </div>

          {/* Keyboard route to the same action dragging performs. */}
          <div className="mt-2.5 flex gap-1 border-t border-hairline pt-2.5">
            {COLUMNS.filter((c) => c.status !== item.status).map((c) => (
              <button
                key={c.status}
                onClick={() => onMove(item, c.status)}
                className="rounded-control border border-hairline px-1.5 py-0.5 text-[10px] text-dim transition-all duration-200 hover:border-accent hover:text-text"
              >
                → {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.li>
  )
}

export default function Cases() {
  const queryClient = useQueryClient()
  const openDrawer = useUI((s) => s.openDrawer)
  const [dragging, setDragging] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)

  const counts = useQuery({
    queryKey: ['cases', 'counts'],
    queryFn: () => api.get('/cases/counts'),
  })

  // One query per column: each is independently sorted and paged, and a status
  // change only needs to refetch the two columns involved.
  const columns = COLUMNS.map((col) => ({
    ...col,
    query: useQuery({
      queryKey: ['cases', col.status],
      queryFn: () =>
        api.get(`/cases${qs({ status: col.status, pageSize: PER_COLUMN, sortBy: 'riskScore', sortOrder: 'desc' })}`),
    }),
  }))

  const move = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/cases/${id}`, { status }),
    onSuccess: (data, variables) => {
      const label = COLUMNS.find((c) => c.status === variables.status)?.label ?? variables.status
      const txnId = data?.case?.transaction?.txnId
      toast.success(
        `Moved to ${label}`,
        txnId ? `${txnId} · risk ${data.case.riskScore}` : undefined,
      )
      queryClient.invalidateQueries({ queryKey: ['cases'] })
    },
    onError: (err) => {
      toast.error(
        'Could not update this case',
        err instanceof ApiError && err.status === 403
          ? 'Your role can read the queue but not decide cases.'
          : (err?.message ?? 'The API did not respond.'),
      )
      queryClient.invalidateQueries({ queryKey: ['cases'] })
    },
  })

  function handleDrop(status) {
    setDropTarget(null)
    const item = dragging
    setDragging(null)
    if (!item || item.status === status) return
    move.mutate({ id: item.id, status })
  }

  const total = counts.data?.total ?? 0

  return (
    <>
      <PageHeader
        title="Cases"
        description="Flagged transactions awaiting a decision. Highest risk first — drag a card, or use its buttons."
        actions={
          <span className="num text-[12px] text-dim">
            {formatCount(total)} open
          </span>
        }
      />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-3">
          {columns.map((col) => {
            const cases = col.query.data?.cases ?? []
            const count = counts.data?.counts?.[col.status] ?? 0
            const isTarget = dropTarget === col.status

            return (
              <Card
                key={col.status}
                className="flex min-h-[320px] flex-col transition-all duration-200"
                style={
                  isTarget
                    ? { borderColor: col.accent, boxShadow: `0 0 22px -4px ${col.accent}` }
                    : undefined
                }
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropTarget(col.status)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDrop(col.status)
                }}
              >
                <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: col.accent, boxShadow: `0 0 10px ${col.accent}` }}
                      aria-hidden="true"
                    />
                    <span className="label-caps text-dim">{col.label}</span>
                  </div>
                  <span className="num text-[12px] text-text">{formatCount(count)}</span>
                </div>

                {col.query.isLoading ? (
                  <div className="flex flex-col gap-2 p-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-[104px] w-full rounded-card" />
                    ))}
                  </div>
                ) : col.query.isError ? (
                  <EmptyState
                    icon={FolderSearch}
                    title="This column could not load."
                    description="The cases service did not respond."
                    action={
                      <Button variant="outline" size="sm" onClick={() => col.query.refetch()}>
                        Try again
                      </Button>
                    }
                  />
                ) : cases.length === 0 ? (
                  <EmptyState
                    title={
                      col.status === 'UNDER_REVIEW'
                        ? 'Nothing waiting for review.'
                        : `No cases marked ${col.label.toLowerCase()} yet.`
                    }
                    description={
                      col.status === 'UNDER_REVIEW'
                        ? 'New flagged transactions land here as they are scored.'
                        : 'Drag a card here, or use the buttons on a card to move it.'
                    }
                  />
                ) : (
                  <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
                    <AnimatePresence mode="popLayout">
                      {cases.map((item) => (
                        <CaseCard
                          key={item.id}
                          item={item}
                          isDragging={dragging?.id === item.id}
                          onOpen={openDrawer}
                          onMove={(c, status) => move.mutate({ id: c.id, status })}
                          onDragStart={setDragging}
                          onDragEnd={() => {
                            setDragging(null)
                            setDropTarget(null)
                          }}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}

                {count > cases.length && (
                  <p className="num border-t border-hairline px-4 py-2 text-[11px] text-dim">
                    showing {cases.length} of {formatCount(count)}
                  </p>
                )}
              </Card>
            )
          })}
        </div>
      </PageBody>
    </>
  )
}
