/**
 * Dashboard.
 *
 * KPI row, then the repeat-participants graph as the hero, then the risk trend.
 * The graph gets the most space because it is the only view in the product that
 * shows relationships rather than rows.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Network, Info } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { api } from '../lib/api.js'
import { useUI } from '../store/ui.js'
import { formatCompactMoney, formatCount, formatDate } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card, CardHeader, CardTitle } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { RepeatNetwork } from '../components/RepeatNetwork.jsx'
import { useCountUp } from '../hooks/useCountUp.js'

function Kpi({ label, value, format = formatCount, suffix, comparison }) {
  const animated = useCountUp(value, { duration: 800, decimals: format === formatCount ? 0 : 1 })

  return (
    <div className="border-hairline px-5 py-4 sm:border-r sm:last:border-r-0">
      <p className="label-caps text-dim">{label}</p>
      <p className="num mt-1.5 text-[24px] leading-none text-text">
        {typeof value === 'number' ? format(animated) : '—'}
        {suffix && <span className="ml-0.5 text-[14px] text-dim">{suffix}</span>}
      </p>
      {comparison && <Delta {...comparison} />}
    </div>
  )
}

/**
 * Period-over-period indicator.
 *
 * Expressed in percentage points, not a relative percentage — a rate moving
 * from 30% to 33% is "up 3 points", and calling it "up 10%" invites the wrong
 * reading. Direction drives both the arrow and the colour, and the arrow means
 * the colour is never doing the work alone.
 */
function Delta({ deltaPoints, direction, previous, windowDays }) {
  if (deltaPoints == null) return null

  const rising = direction === 'up'
  const flat = direction === 'flat' || deltaPoints === 0
  const Icon = flat ? Minus : rising ? ArrowUpRight : ArrowDownRight
  // For a fraud rate, up is bad.
  const color = flat ? 'var(--text-dim)' : rising ? 'var(--critical)' : 'var(--clear)'

  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" strokeWidth={2} style={{ color }} aria-hidden="true" />
      <span className="num text-[12px]" style={{ color }}>
        {deltaPoints > 0 ? '+' : ''}
        {deltaPoints} pts
      </span>
      <span className="text-[11px] text-dim">
        vs prior {windowDays}d ({previous}%)
      </span>
    </div>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-card border border-hairline bg-surface px-3 py-2 shadow-[var(--accent-glow)]">
      <p className="num text-[11px] text-dim">{formatDate(label)}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="num mt-1 text-[12px]" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const openDrawer = useUI((s) => s.openDrawer)
  const [hubLimit, setHubLimit] = useState(60)

  const summary = useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => api.get('/analytics/summary?windowDays=7'),
  })
  const network = useQuery({
    queryKey: ['analytics', 'network', hubLimit],
    queryFn: () => api.get(`/analytics/network?limit=${hubLimit}`),
  })
  const trend = useQuery({
    queryKey: ['analytics', 'trend'],
    queryFn: () => api.get('/analytics/trend?days=31'),
  })

  const totals = summary.data?.totals
  const comparison = summary.data?.comparison

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Portfolio health at a glance, and the accounts that keep reappearing."
      />

      <PageBody className="flex flex-col gap-4">
        {/* KPI row */}
        <Card>
          {summary.isLoading ? (
            <div className="grid gap-4 p-5 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4">
              <Kpi label="Transactions" value={totals?.transactions} />
              <Kpi label="Critical" value={totals?.critical} />
              <Kpi
                label="Critical rate"
                value={comparison?.criticalRate?.current}
                format={(v) => Number(v).toFixed(2)}
                suffix="%"
                comparison={{
                  deltaPoints: comparison?.criticalRate?.deltaPoints,
                  direction: comparison?.criticalRate?.direction,
                  previous: comparison?.criticalRate?.previous,
                  windowDays: comparison?.windowDays,
                }}
              />
              <Kpi
                label="Average score"
                value={totals?.averageScore}
                format={(v) => Number(v).toFixed(1)}
              />
            </div>
          )}
        </Card>

        {/* Hero: repeat participants */}
        <Card className="overflow-hidden">
          <CardHeader>
            <div className="flex items-baseline gap-3">
              <CardTitle>Repeat participants</CardTitle>
              {network.data && (
                <span className="num text-[11px] text-dim">
                  {formatCount(network.data.stats.hubsShown)} of{' '}
                  {formatCount(network.data.stats.hubsTotal)} accounts
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {[60, 160, 400].map((n) => (
                <button
                  key={n}
                  onClick={() => setHubLimit(n)}
                  className={
                    'num rounded-control border px-2 py-0.5 text-[11px] transition-all duration-200 ' +
                    (hubLimit === n
                      ? 'border-accent text-text shadow-[var(--accent-glow)]'
                      : 'border-hairline text-dim hover:text-text')
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </CardHeader>

          {network.isLoading ? (
            <div className="p-6">
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : network.isError ? (
            <EmptyState
              icon={Network}
              title="The graph could not be loaded."
              description="The analytics service did not respond. Check that the backend is running on port 4000."
              action={
                <Button variant="outline" onClick={() => network.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <RepeatNetwork
              data={network.data}
              height={420}
              onSelectEdge={(edge) => openDrawer(edge.id)}
            />
          )}

          <div className="flex items-start gap-2 border-t border-hairline px-5 py-3">
            <Info className="mt-[1px] h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={1.6} aria-hidden="true" />
            <p className="text-[11.5px] leading-relaxed text-dim">
              Hubs are accounts appearing in more than one flagged transaction; size and glow scale
              with how many. This is <span className="text-text">hub-and-spoke, not a ring
              network</span> — of the ~62,000 accounts in flagged transactions only{' '}
              <span className="num">665</span> recur, and{' '}
              <span className="num">zero</span> flagged transactions connect two of them. PaySim
              generates independent transactions, so no clusters exist to find. Click a hub to
              isolate it; click an edge to open the transaction.
            </p>
          </div>
        </Card>

        {/* Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Risk over time</CardTitle>
            <span className="text-[11px] text-dim">daily average score</span>
          </CardHeader>
          <div className="p-4">
            {trend.isLoading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend.data?.points ?? []} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--hairline)" strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => new Date(v).getDate()}
                    tick={{ fill: 'var(--text-dim)', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                    axisLine={{ stroke: 'var(--hairline)' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: 'var(--text-dim)', fontSize: 10, fontFamily: 'IBM Plex Mono' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--accent)', strokeWidth: 1 }} />
                  <Area
                    type="monotone"
                    dataKey="averageScore"
                    name="Avg score"
                    stroke="var(--accent)"
                    strokeWidth={1.6}
                    fill="url(#trendFill)"
                    dot={false}
                    activeDot={{ r: 3.5, fill: 'var(--accent)', stroke: 'var(--void)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Value footer */}
        {totals && (
          <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="label-caps text-dim">Total value scored</p>
              <p className="num mt-1 text-[19px] text-text">
                {formatCompactMoney(totals.totalAmount)}
              </p>
            </div>
            <div className="flex gap-8">
              {[
                ['Clear', totals.clear, 'var(--clear)'],
                ['Suspicious', totals.suspicious, 'var(--suspicious)'],
                ['Critical', totals.critical, 'var(--critical)'],
              ].map(([label, count, color]) => (
                <div key={label}>
                  <p className="label-caps text-dim">{label}</p>
                  <p className="num mt-1 text-[15px]" style={{ color }}>
                    {formatCount(count)}
                  </p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
