/**
 * Insights — geographic and temporal risk distribution.
 *
 * The map answers "where is the volume and where are the critical cases", and
 * the hour-of-day strip answers "when". The second one is worth as much as the
 * first: PaySim's `step` is an hour index, so the temporal pattern is a real
 * signal in the source data, where the geographic dimension is synthesised.
 * Both are labelled as what they are.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Globe, Clock, Info } from 'lucide-react'

import { api } from '../lib/api.js'
import { formatCount, formatCompactMoney, RISK_META } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card, CardHeader, CardTitle } from '../components/ui/Card.jsx'
import { Skeleton } from '../components/ui/Skeleton.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { Button } from '../components/ui/Button.jsx'
import { GeoRiskMap, COUNTRY_NAMES } from '../components/GeoRiskMap.jsx'
import { useCountUp } from '../hooks/useCountUp.js'

function Stat({ label, value, suffix, animate = true }) {
  const shown = useCountUp(value, { duration: 800, enabled: animate && typeof value === 'number' })
  return (
    <div>
      <p className="label-caps text-dim">{label}</p>
      <p className="num mt-1 text-[20px] text-text">
        {typeof value === 'number' ? formatCount(shown) : value}
        {suffix && <span className="ml-0.5 text-[13px] text-dim">{suffix}</span>}
      </p>
    </div>
  )
}

/** Hour-of-day strip. Height encodes volume, colour encodes average risk. */
function HourlyStrip({ hours }) {
  const maxTxns = Math.max(...hours.map((h) => h.transactions), 1)
  const scores = hours.map((h) => h.averageScore).filter((s) => s != null)
  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const span = Math.max(0.01, maxScore - minScore)

  return (
    <div className="flex items-end gap-[3px]" style={{ height: 120 }}>
      {hours.map((h) => {
        // Normalised within the observed range so a 2-point spread is still
        // readable — the absolute range is narrow, and saying so beats
        // flattening the chart into a straight line.
        const t = h.averageScore != null ? (h.averageScore - minScore) / span : 0
        const color =
          t > 0.66 ? RISK_META.CRITICAL : t > 0.33 ? RISK_META.SUSPICIOUS : RISK_META.CLEAR
        return (
          <div
            key={h.hour}
            className="group relative flex-1"
            style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
          >
            <div
              className="w-full rounded-[2px] transition-all duration-200"
              style={{
                height: `${Math.max(4, (h.transactions / maxTxns) * 100)}%`,
                background: color.color,
                opacity: 0.35 + t * 0.55,
                boxShadow: t > 0.66 ? color.glow : undefined,
              }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-control border border-hairline bg-surface px-2 py-1.5 group-hover:block">
              <p className="num text-[11px] text-text">
                {String(h.hour).padStart(2, '0')}:00
              </p>
              <p className="num text-[10.5px] text-dim">
                {formatCount(h.transactions)} txns · avg {h.averageScore ?? '—'}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function Insights() {
  const [selected, setSelected] = useState(null)

  const geo = useQuery({ queryKey: ['analytics', 'geo'], queryFn: () => api.get('/analytics/geo') })
  const hourly = useQuery({
    queryKey: ['analytics', 'hourly'],
    queryFn: () => api.get('/analytics/hourly'),
  })

  const countries = geo.data?.countries ?? []
  const ranked = [...countries].sort((a, b) => b.critical - a.critical).slice(0, 8)
  const totals = countries.reduce(
    (acc, c) => ({
      transactions: acc.transactions + c.transactions,
      critical: acc.critical + c.critical,
      amount: acc.amount + (c.totalAmount ?? 0),
    }),
    { transactions: 0, critical: 0, amount: 0 },
  )

  return (
    <>
      <PageHeader
        title="Insights"
        description="Where the volume sits, where the critical cases cluster, and when they happen."
      />

      <PageBody className="flex flex-col gap-4">
        {geo.isError ? (
          <Card>
            <EmptyState
              icon={Globe}
              title="Insights could not be loaded."
              description="The analytics service did not respond. Check that the backend is running on port 4000."
              action={
                <Button variant="outline" onClick={() => geo.refetch()}>
                  Try again
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {/* Map */}
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Volume and critical cases by country</CardTitle>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-[11px] text-dim">
                    <span
                      className="inline-block h-2 w-6 rounded-[2px]"
                      style={{ background: 'linear-gradient(90deg, rgba(99,102,241,0.12), rgba(99,102,241,0.65))' }}
                    />
                    volume
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-dim">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: 'var(--critical)', boxShadow: 'var(--critical-glow)' }}
                    />
                    top quartile by critical count
                  </span>
                </div>
              </CardHeader>

              {geo.isLoading ? (
                <div className="p-6">
                  <Skeleton className="h-[380px] w-full" />
                </div>
              ) : (
                <div className="px-2 pb-2 pt-1">
                  <GeoRiskMap data={geo.data} onSelectCountry={setSelected} />
                </div>
              )}

              {/* The dimension is synthetic and says so, on the surface itself. */}
              <div className="flex items-start gap-2 border-t border-hairline px-5 py-3">
                <Info className="mt-[1px] h-3.5 w-3.5 shrink-0 text-dim" strokeWidth={1.6} aria-hidden="true" />
                <p className="text-[11.5px] leading-relaxed text-dim">
                  Country is <span className="text-text">synthesised</span> — PaySim ships no
                  geography, so each account is assigned one deterministically from its id.
                  Assignment is independent of the fraud labels, so average risk is near-uniform
                  (48.0–50.1) by construction. The map encodes volume and critical count, which
                  do vary; it deliberately does not colour by average score.
                </p>
              </div>
            </Card>

            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              {/* Hour of day */}
              <Card>
                <CardHeader>
                  <CardTitle>Risk by hour of day</CardTitle>
                  <span className="flex items-center gap-1.5 text-[11px] text-dim">
                    <Clock className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
                    real signal
                  </span>
                </CardHeader>
                <div className="p-5">
                  {hourly.isLoading ? (
                    <Skeleton className="h-[120px] w-full" />
                  ) : (
                    <>
                      <HourlyStrip hours={hourly.data?.hours ?? []} />
                      <div className="num mt-2 flex justify-between text-[10px] text-dim">
                        <span>00:00</span>
                        <span>06:00</span>
                        <span>12:00</span>
                        <span>18:00</span>
                        <span>23:00</span>
                      </div>
                      <p className="mt-3 text-[11.5px] leading-relaxed text-dim">
                        Bar height is volume, colour is average risk normalised across the
                        observed range. Unlike geography this comes straight from the dataset —
                        PaySim's step counter is an hour index.
                      </p>
                    </>
                  )}
                </div>
              </Card>

              {/* Ranked list */}
              <Card>
                <CardHeader>
                  <CardTitle>Most critical cases</CardTitle>
                </CardHeader>
                {geo.isLoading ? (
                  <div className="flex flex-col gap-3 p-5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-4 w-full" />
                    ))}
                  </div>
                ) : (
                  <ol>
                    {ranked.map((country, i) => (
                      <li key={country.code}>
                        <button
                          onClick={() => setSelected(country)}
                          className="flex w-full items-center gap-3 border-b border-hairline px-5 py-2.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-raised"
                        >
                          <span className="num w-5 shrink-0 text-[10.5px] text-dim">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
                            {COUNTRY_NAMES[country.code] ?? country.code}
                          </span>
                          <span
                            className="num shrink-0 text-[12px]"
                            style={{ color: 'var(--critical)' }}
                          >
                            {formatCount(country.critical)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>

            {/* Totals */}
            <Card className="grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
              <Stat label="Countries" value={countries.length} />
              <Stat label="Transactions" value={totals.transactions} />
              <Stat label="Critical" value={totals.critical} />
              <div>
                <p className="label-caps text-dim">Total value</p>
                <p className="num mt-1 text-[20px] text-text">
                  {formatCompactMoney(totals.amount)}
                </p>
              </div>
            </Card>
          </>
        )}

        {/* Selected country detail */}
        {selected && (
          <Card risk={selected.critical > 0 ? 'CRITICAL' : undefined} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label-caps text-dim">Selected</p>
                <p className="display mt-1 text-[19px] text-text">
                  {COUNTRY_NAMES[selected.code] ?? selected.code}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Clear
              </Button>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                ['Transactions', formatCount(selected.transactions)],
                ['Scored', formatCount(selected.scored)],
                ['Critical', formatCount(selected.critical)],
                ['Critical rate', selected.criticalRate != null ? `${selected.criticalRate}%` : '—'],
                ['Avg score', selected.averageScore ?? '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="label-caps text-dim">{k}</dt>
                  <dd className="num mt-1 text-[15px] text-text">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </PageBody>
    </>
  )
}
