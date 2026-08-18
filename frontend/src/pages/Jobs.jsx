/**
 * Batch jobs.
 *
 * A list on the left, live detail on the right. Selecting a job subscribes to
 * its Socket.IO room, so the progress bar fills chunk by chunk as the worker
 * reports in rather than by polling.
 *
 * Beneath the bar is a live tail of transactions scored during the run, reusing
 * the feed row from the live-feed page — a progress bar tells you how far along
 * something is, but the tail tells you what it is actually finding.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { Layers, RotateCw, Plus } from 'lucide-react'

import { api, qs, ApiError } from '../lib/api.js'
import { useUI } from '../store/ui.js'
import { useAuth } from '../store/auth.js'
import { can } from '../lib/permissions.js'
import { toast } from '../store/toast.js'
import { formatCount, formatDateTime } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card, CardHeader, CardTitle } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Select, Field } from '../components/ui/Input.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { FeedRow } from '../components/FeedRow.jsx'
import { useFeed, useJobProgress } from '../hooks/useSocket.jsx'

const STATUS_COLOR = {
  QUEUED: 'var(--text-dim)',
  PROCESSING: 'var(--accent)',
  COMPLETED: 'var(--clear)',
  PARTIALLY_COMPLETED: 'var(--suspicious)',
  FAILED: 'var(--critical)',
}

const RETRYABLE = ['FAILED', 'PARTIALLY_COMPLETED']

function StatusPill({ status }) {
  const color = STATUS_COLOR[status] ?? 'var(--text-dim)'
  return (
    <span
      className="label-caps inline-flex items-center gap-1.5 rounded-control border px-2 py-[2px] whitespace-nowrap"
      style={{ color, borderColor: `${color}55` }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: status === 'PROCESSING' ? `0 0 8px ${color}` : undefined }}
        aria-hidden="true"
      />
      {status.replace('_', ' ')}
    </span>
  )
}

/**
 * Chunk-fill progress bar.
 *
 * Segmented by chunk rather than drawn as one continuous fill, because that is
 * literally how the work completes — 60 chunks landing one at a time, each one
 * lighting up as its worker reports back.
 */
function ChunkBar({ job, live }) {
  const total = job.totalChunks || 1
  const done = live?.completedChunks ?? job.completedChunks ?? 0
  const processed = live?.processedCount ?? job.processedCount
  const failed = live?.failedCount ?? job.failedCount
  const status = live?.status ?? job.status
  const color = STATUS_COLOR[status] ?? 'var(--accent)'

  // Above ~80 chunks the segments are thinner than the gaps, so it degrades to
  // a single continuous bar.
  const segmented = total <= 80

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="num text-[15px] text-text">
          {formatCount(processed)}
          <span className="text-[12px] text-dim"> / {formatCount(job.totalTxns)}</span>
        </span>
        {failed > 0 && (
          <span className="num text-[12px]" style={{ color: 'var(--critical)' }}>
            {formatCount(failed)} failed
          </span>
        )}
      </div>

      {segmented ? (
        <div className="flex gap-[2px]">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className="h-[6px] flex-1 rounded-[1px] transition-all duration-300"
              style={{
                background: i < done ? color : 'var(--hairline)',
                boxShadow: i < done && status === 'PROCESSING' ? `0 0 8px ${color}` : undefined,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="h-[6px] w-full overflow-hidden rounded-full bg-hairline">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${Math.round((done / total) * 100)}%`,
              background: color,
              boxShadow: `0 0 10px ${color}`,
            }}
          />
        </div>
      )}

      <p className="num mt-2 text-[11px] text-dim">
        {formatCount(done)} of {formatCount(total)} chunks
      </p>
    </div>
  )
}

export default function Jobs() {
  const queryClient = useQueryClient()
  const openDrawer = useUI((s) => s.openDrawer)
  const user = useAuth((s) => s.user)

  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [live, setLive] = useState(null)
  const [tail, setTail] = useState([])

  const list = useQuery({
    queryKey: ['jobs', statusFilter],
    queryFn: () => api.get(`/jobs${qs({ status: statusFilter, pageSize: 25 })}`),
    // A slow poll as a safety net: a job created in another tab should still
    // appear, and a socket drop should not freeze the board.
    refetchInterval: 15_000,
  })

  const jobs = list.data?.jobs ?? []
  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null

  // Reset the live overlay whenever the selection changes.
  useEffect(() => {
    setLive(null)
    setTail([])
  }, [selected?.id])

  useJobProgress(selected?.id ?? null, {
    onProgress: (data) => setLive(data),
    onCompleted: (data) => {
      setLive((prev) => ({ ...prev, ...data }))
      toast.success(
        `Job finished — ${data.status.replace('_', ' ').toLowerCase()}`,
        `${formatCount(data.processedCount)} scored, ${formatCount(data.failedCount)} failed`,
      )
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  // The batch worker does not publish per-transaction results, so the tail is
  // fed by the same feed channel the simulator uses. It fills when a simulator
  // run is active alongside the batch; otherwise it stays empty and says so.
  const onPrediction = useCallback((item) => {
    setTail((prev) => [{ ...item, receivedAt: Date.now(), key: `${item.txnId}-${Date.now()}` }, ...prev].slice(0, 5))
  }, [])
  useFeed(onPrediction, Boolean(selected))

  const retry = useMutation({
    mutationFn: (id) => api.post(`/jobs/${id}/retry`),
    onSuccess: (data) => {
      toast.success(
        `Retrying ${formatCount(data.retryingTransactions)} transactions`,
        'Only the rows still missing a prediction were re-queued.',
      )
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (err) => {
      toast.error(
        'Could not retry this job',
        err instanceof ApiError && err.code === 'NOTHING_TO_RETRY'
          ? 'Every transaction on this job already has a prediction.'
          : err instanceof ApiError && err.status === 403
            ? 'Retrying a job is an admin action.'
            : (err?.message ?? 'The API did not respond.'),
      )
    },
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/jobs', { name: `Manual rescore ${new Date().toISOString().slice(0, 16)}`, filter: 'unscored', limit: 500 }),
    onSuccess: (data) => {
      toast.success(`Queued ${formatCount(data.job.totalTxns)} transactions`, `${data.job.totalChunks} chunks`)
      setSelectedId(data.job.id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (err) =>
      toast.error(
        'Could not queue a job',
        err instanceof ApiError && err.status === 400
          ? 'There is nothing left to score — every transaction already has a prediction.'
          : (err?.message ?? 'The API did not respond.'),
      ),
  })

  return (
    <>
      <PageHeader
        title="Batch jobs"
        description="Bulk scoring runs. Select one to watch its chunks land in real time."
        actions={
          can.queueJob(user) && (
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              New job
            </Button>
          )
        }
      />

      <PageBody className="flex flex-col gap-4 lg:flex-row">
        {/* List */}
        <Card className="w-full overflow-hidden lg:w-[380px] lg:shrink-0">
          <CardHeader>
            <CardTitle>Runs</CardTitle>
            <Field label="" htmlFor="status" className="w-[150px]">
              <Select
                id="status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-7 text-[12px]"
              >
                <option value="">All statuses</option>
                {Object.keys(STATUS_COLOR).map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
          </CardHeader>

          {list.isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-card" />
              ))}
            </div>
          ) : list.isError ? (
            <EmptyState
              icon={Layers}
              title="Jobs could not be loaded."
              description="The API did not respond. Check that the backend is running on port 4000."
              action={
                <Button variant="outline" size="sm" onClick={() => list.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No batch jobs yet."
              description="Queue one with New job, and it will appear here with live progress."
            />
          ) : (
            <ul className="max-h-[600px] overflow-y-auto">
              {jobs.map((job) => {
                const isSelected = selected?.id === job.id
                return (
                  <li key={job.id} className="border-b border-hairline last:border-b-0">
                    <button
                      onClick={() => setSelectedId(job.id)}
                      className="w-full px-4 py-3 text-left transition-colors duration-200 hover:bg-raised"
                      style={
                        isSelected
                          ? { background: 'var(--surface-raised)', boxShadow: 'inset 2px 0 0 var(--accent)' }
                          : undefined
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{job.name}</span>
                        <StatusPill status={job.status} />
                      </div>
                      <div className="num mt-1.5 flex items-center gap-3 text-[11px] text-dim">
                        <span>{formatCount(job.totalTxns)} txns</span>
                        <span>{job.progressPercent}%</span>
                        <span className="ml-auto">{formatDateTime(job.createdAt)}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Detail */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {selected ? (
            <>
              <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-text">{selected.name}</p>
                    <p className="num mt-1 text-[11px] text-dim">
                      created {formatDateTime(selected.createdAt)}
                      {selected.createdBy && ` · ${selected.createdBy.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={live?.status ?? selected.status} />
                    {can.retryJob(user) && RETRYABLE.includes(live?.status ?? selected.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={retry.isPending}
                        onClick={() => retry.mutate(selected.id)}
                      >
                        <RotateCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                        Retry
                      </Button>
                    )}
                  </div>
                </div>

                <ChunkBar job={selected} live={live} />
              </Card>

              {/* Live tail */}
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle>Recently scored</CardTitle>
                  <span className="text-[11px] text-dim">last {tail.length || 5} on the wire</span>
                </CardHeader>
                {tail.length === 0 ? (
                  <p className="px-5 py-6 text-[12px] leading-relaxed text-dim">
                    The batch worker reports chunk counts, not individual results — so this tail
                    fills from the live scoring channel. Start a run on the{' '}
                    <span className="text-text">Live feed</span> page to see scored transactions
                    stream through here.
                  </p>
                ) : (
                  <ul>
                    <AnimatePresence initial={false}>
                      {tail.map((item) => (
                        <FeedRow
                          key={item.key}
                          item={item}
                          onSelect={() => openDrawer(item.transactionId)}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </Card>
            </>
          ) : (
            <Card>
              <EmptyState
                icon={Layers}
                title="Select a job to watch it run."
                description="Progress streams over the socket connection as each chunk completes."
              />
            </Card>
          )}
        </div>
      </PageBody>
    </>
  )
}
