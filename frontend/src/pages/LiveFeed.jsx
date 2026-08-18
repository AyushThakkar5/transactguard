/**
 * Live feed.
 *
 * Simulator controls plus a stream of freshly-scored transactions arriving over
 * Socket.IO. The simulator replays seeded transactions through the scorer at a
 * chosen rate; each result is published to Redis by the API process and relayed
 * to this room.
 *
 * The list is capped and newest-first, so the page never grows without bound
 * during a long run.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'framer-motion'
import { useCallback, useRef, useState } from 'react'
import { Radio, Play, Square, Wifi, WifiOff } from 'lucide-react'

import { api, ApiError } from '../lib/api.js'
import { useUI } from '../store/ui.js'
import { toast } from '../store/toast.js'
import { RISK_META, formatCount } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card, CardHeader, CardTitle } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Field, Input } from '../components/ui/Input.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { FeedRow } from '../components/FeedRow.jsx'
import { useFeed, useSocket } from '../hooks/useSocket.jsx'

/** Rows kept in the DOM. Older ones fall off the end. */
const MAX_ROWS = 60

function ConnectionPill({ status }) {
  const connected = status === 'connected'
  const Icon = connected ? Wifi : WifiOff
  const color = connected ? 'var(--clear)' : status === 'connecting' ? 'var(--suspicious)' : 'var(--critical)'

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-control border px-2 py-[3px] label-caps"
      style={{ color, borderColor: `${color}55`, boxShadow: connected ? 'var(--clear-glow)' : undefined }}
    >
      <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
      {status}
    </span>
  )
}

export default function LiveFeed() {
  const queryClient = useQueryClient()
  const openDrawer = useUI((s) => s.openDrawer)
  const { status: socketStatus } = useSocket()

  const [rows, setRows] = useState([])
  const [rate, setRate] = useState(3)
  const [count, setCount] = useState(60)
  const seen = useRef(0)

  const simulator = useQuery({
    queryKey: ['simulator', 'status'],
    queryFn: () => api.get('/simulator/status'),
    // Polled as a fallback: the run's own progress is not pushed over the
    // socket, only the predictions it produces.
    refetchInterval: (query) => (query.state.data?.active ? 1200 : false),
  })

  const onPrediction = useCallback((item) => {
    seen.current += 1
    setRows((prev) => [{ ...item, receivedAt: Date.now(), key: `${item.txnId}-${seen.current}` }, ...prev].slice(0, MAX_ROWS))
  }, [])

  useFeed(onPrediction, true)

  const start = useMutation({
    mutationFn: () => api.post('/simulator/start', { transactionsPerSecond: rate, count }),
    onSuccess: (data) => {
      toast.success(
        `Replaying ${formatCount(data.run.total)} transactions`,
        `${data.run.transactionsPerSecond}/second · about ${Math.round(data.run.total / data.run.transactionsPerSecond)}s`,
      )
      queryClient.invalidateQueries({ queryKey: ['simulator'] })
    },
    onError: (err) => {
      toast.error(
        'Could not start the simulator',
        err instanceof ApiError && err.code === 'SIMULATOR_ALREADY_RUNNING'
          ? 'A run is already active. Stop it first.'
          : err instanceof ApiError && err.status === 403
            ? 'Your role cannot start a simulator run.'
            : (err?.message ?? 'The API did not respond.'),
      )
    },
  })

  const stop = useMutation({
    mutationFn: () => api.post('/simulator/stop', { simulatorRunId: simulator.data?.run?.simulatorRunId }),
    onSuccess: (data) => {
      toast.info('Simulator stopped', `${formatCount(data.run.sent)} of ${formatCount(data.run.total)} sent`)
      queryClient.invalidateQueries({ queryKey: ['simulator'] })
    },
    onError: (err) => toast.error('Could not stop the simulator', err?.message),
  })

  const run = simulator.data?.run
  const active = simulator.data?.active

  const mix = rows.reduce((acc, r) => ({ ...acc, [r.riskLevel]: (acc[r.riskLevel] ?? 0) + 1 }), {})

  return (
    <>
      <PageHeader
        title="Live feed"
        description="Replay seeded transactions through the scorer and watch results land in real time."
        actions={<ConnectionPill status={socketStatus} />}
      />

      <PageBody className="flex flex-col gap-4">
        {/* Controls */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Per second" htmlFor="rate" className="w-[110px]">
              <Input
                id="rate"
                type="number"
                mono
                min={1}
                max={20}
                value={rate}
                disabled={active}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </Field>

            <Field label="Count" htmlFor="count" className="w-[110px]">
              <Input
                id="count"
                type="number"
                mono
                min={1}
                max={500}
                value={count}
                disabled={active}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>

            {active ? (
              <Button variant="danger" loading={stop.isPending} onClick={() => stop.mutate()}>
                <Square className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Stop
              </Button>
            ) : (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
                <Play className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                Start replay
              </Button>
            )}

            {run && (
              <div className="ml-auto flex items-center gap-5">
                <div>
                  <p className="label-caps text-dim">Sent</p>
                  <p className="num mt-0.5 text-[15px] text-text">
                    {formatCount(run.sent)}
                    <span className="text-[12px] text-dim"> / {formatCount(run.total)}</span>
                  </p>
                </div>
                <div>
                  <p className="label-caps text-dim">Skipped</p>
                  <p
                    className="num mt-0.5 text-[15px]"
                    style={{ color: run.failed > 0 ? 'var(--critical)' : 'var(--text-dim)' }}
                  >
                    {formatCount(run.failed)}
                  </p>
                </div>
                <div>
                  <p className="label-caps text-dim">Status</p>
                  <p className="num mt-0.5 text-[13px] text-text">{run.status}</p>
                </div>
              </div>
            )}
          </div>

          {/* Progress rail for the active run. */}
          {active && run && (
            <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${Math.round((run.sent / Math.max(1, run.total)) * 100)}%`,
                  background: 'var(--accent)',
                  boxShadow: 'var(--accent-glow)',
                }}
              />
            </div>
          )}
        </Card>

        {/* Stream */}
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-baseline gap-3">
              <CardTitle>Incoming</CardTitle>
              <span className="num text-[11px] text-dim">
                {formatCount(seen.current)} received this session
              </span>
            </div>
            <div className="flex items-center gap-3">
              {['CRITICAL', 'SUSPICIOUS', 'CLEAR'].map((level) => (
                <span key={level} className="flex items-center gap-1.5 text-[11px] text-dim">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background: RISK_META[level].color,
                      boxShadow: level === 'CRITICAL' ? RISK_META[level].glow : undefined,
                    }}
                  />
                  <span className="num">{mix[level] ?? 0}</span>
                </span>
              ))}
            </div>
          </CardHeader>

          {rows.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="Nothing on the wire yet."
              description={
                socketStatus === 'connected'
                  ? 'Start a replay above and scored transactions will appear here as they land.'
                  : 'Waiting for the realtime connection. Check that the API is running on port 4000.'
              }
            />
          ) : (
            <ul className="max-h-[560px] overflow-y-auto">
              <AnimatePresence initial={false}>
                {rows.map((item) => (
                  <FeedRow key={item.key} item={item} onSelect={() => openDrawer(item.transactionId)} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  )
}
