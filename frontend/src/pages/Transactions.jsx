/**
 * Transactions.
 *
 * Filterable, sortable, paginated. Rows open the detail drawer rather than
 * navigating, so the filter set and scroll position survive an investigation.
 *
 * Below 640px the table becomes stacked cards: a horizontally scrolling table
 * would technically work, but reading a transaction means comparing amount
 * against balances, and side-scrolling to do that is miserable.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, qs, ApiError } from '../lib/api.js'
import { useUI } from '../store/ui.js'
import { formatDateTime, formatMoney, formatCount } from '../lib/format.js'
import { PageHeader, PageBody } from '../components/layout/AppShell.jsx'
import { Card } from '../components/ui/Card.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Input, Select, Field } from '../components/ui/Input.jsx'
import { SkeletonTable } from '../components/ui/Skeleton.jsx'
import { EmptyState } from '../components/ui/EmptyState.jsx'
import { RiskBadge } from '../components/ui/RiskBadge.jsx'
import { useRowPredictions } from '../hooks/useRowPredictions.js'
import { RISK_META } from '../lib/format.js'
import { SearchX, ScatterChart, Rows3 } from 'lucide-react'
import { RiskRadar } from '../components/RiskRadar.jsx'

const TXN_TYPES = ['TRANSFER', 'CASH_OUT', 'PAYMENT', 'CASH_IN', 'DEBIT']
const PAGE_SIZE = 25

function SortHeader({ label, field, filters, onSort, align = 'left', className = '' }) {
  const active = filters.sortBy === field
  return (
    <th className={`px-4 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>
      <button
        onClick={() => onSort(field)}
        className="label-caps inline-flex items-center gap-1 text-dim transition-colors hover:text-text"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-text' : 'opacity-0'}>
          {filters.sortOrder === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  )
}

export default function Transactions() {
  const filters = useUI((s) => s.transactionFilters)
  const setFilter = useUI((s) => s.setTransactionFilter)
  const clearFilters = useUI((s) => s.clearTransactionFilters)
  const openDrawer = useUI((s) => s.openDrawer)

  const [page, setPage] = useState(1)
  const [searchDraft, setSearchDraft] = useState(filters.search)
  const [view, setView] = useState('radar')

  // The radar reads the same filters as the table, so both views always show
  // the same population. Only fetched while the radar is on screen.
  const radar = useQuery({
    queryKey: ['scatter', filters],
    queryFn: () =>
      api.get(
        `/analytics/scatter${qs({
          txnType: filters.txnType,
          from: filters.from,
          to: filters.to,
          search: filters.search,
          limit: 3000,
        })}`,
      ),
    enabled: view === 'radar',
    placeholderData: keepPreviousData,
  })

  const query = useQuery({
    queryKey: ['transactions', filters, page],
    queryFn: () => api.get(`/transactions${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  })

  const rows = query.data?.transactions ?? []
  const pagination = query.data?.pagination
  const { byTxnId } = useRowPredictions(rows)

  const hasFilters = Boolean(filters.search || filters.txnType || filters.from || filters.to)

  function applySearch(event) {
    event.preventDefault()
    setPage(1)
    setFilter({ search: searchDraft.trim() })
  }

  function handleSort(field) {
    setPage(1)
    setFilter({
      sortBy: field,
      sortOrder: filters.sortBy === field && filters.sortOrder === 'desc' ? 'asc' : 'desc',
    })
  }

  function resetAll() {
    setSearchDraft('')
    setPage(1)
    clearFilters()
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description={
          view === 'radar'
            ? 'Amount against risk score. The cases that matter sit top-right.'
            : 'Every ingested payment. Select a row to inspect its assessment.'
        }
        actions={
          <div
            role="radiogroup"
            aria-label="View"
            className="inline-flex rounded-control border border-hairline bg-surface p-0.5"
          >
            {[
              { value: 'radar', label: 'Radar', icon: ScatterChart },
              { value: 'list', label: 'List', icon: Rows3 },
            ].map(({ value, label, icon: Icon }) => {
              const active = view === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setView(value)}
                  className={
                    'flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-all duration-200 ' +
                    (active
                      ? 'bg-accent text-white shadow-[var(--accent-glow)]'
                      : 'text-dim hover:text-text')
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {label}
                </button>
              )
            })}
          </div>
        }
      />

      <PageBody className="flex flex-col gap-4">
        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <form onSubmit={applySearch} className="flex items-end gap-2">
              <Field label="Search" htmlFor="search" className="w-[240px]">
                <Input
                  id="search"
                  mono
                  placeholder="Transaction, sender or receiver id"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="outline">
                Apply
              </Button>
            </form>

            <Field label="Type" htmlFor="txnType" className="w-[150px]">
              <Select
                id="txnType"
                value={filters.txnType}
                onChange={(e) => {
                  setPage(1)
                  setFilter({ txnType: e.target.value })
                }}
              >
                <option value="">All types</option>
                {TXN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="From" htmlFor="from" className="w-[150px]">
              <Input
                id="from"
                type="date"
                mono
                value={filters.from}
                onChange={(e) => {
                  setPage(1)
                  setFilter({ from: e.target.value })
                }}
              />
            </Field>

            <Field label="To" htmlFor="to" className="w-[150px]">
              <Input
                id="to"
                type="date"
                mono
                value={filters.to}
                onChange={(e) => {
                  setPage(1)
                  setFilter({ to: e.target.value })
                }}
              />
            </Field>

            {hasFilters && (
              <Button variant="ghost" onClick={resetAll}>
                Clear filters
              </Button>
            )}

            <div className="ml-auto self-center">
              {pagination && (
                <p className="text-[12px] text-dim">
                  <span className="num text-text">{formatCount(pagination.total)}</span> results
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Radar */}
        {view === 'radar' ? (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
              <div className="flex items-center gap-4">
                {['CRITICAL', 'SUSPICIOUS', 'CLEAR'].map((level) => (
                  <span key={level} className="flex items-center gap-1.5 text-[11px] text-dim">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        background: RISK_META[level].color,
                        boxShadow: level === 'CRITICAL' ? RISK_META[level].glow : undefined,
                      }}
                    />
                    {RISK_META[level].label}
                  </span>
                ))}
              </div>
              {radar.data && (
                <p className="text-[11.5px] text-dim">
                  <span className="num text-text">{formatCount(radar.data.returned)}</span> of{' '}
                  <span className="num">{formatCount(radar.data.total)}</span>
                  {radar.data.sampled && ' · random sample'}
                </p>
              )}
            </div>

            {radar.isLoading ? (
              <div className="p-6">
                <SkeletonTable rows={1} columns={1} />
                <div className="skeleton mt-2 h-[400px] w-full rounded-[3px]" />
              </div>
            ) : radar.isError ? (
              <EmptyState
                icon={ScatterChart}
                title="The radar could not be loaded."
                description="The analytics service did not respond. Switch to List view, or try again."
                action={
                  <Button variant="outline" onClick={() => radar.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : (radar.data?.points?.length ?? 0) === 0 ? (
              <EmptyState
                icon={SearchX}
                title="No transactions match these filters."
                description="Widen the date range or clear the search to see more."
                action={
                  hasFilters ? (
                    <Button variant="outline" onClick={resetAll}>
                      Clear filters
                    </Button>
                  ) : null
                }
              />
            ) : (
              <div className="px-2 py-2">
                <RiskRadar points={radar.data.points} onSelect={openDrawer} height={460} />
              </div>
            )}

            <p className="border-t border-hairline px-5 py-2.5 text-[11.5px] leading-relaxed text-dim">
              Each dot is one transaction, sized by amount. Fraud in this dataset means large
              amounts scoring high, so the cases worth opening cluster top-right — visible as a
              shape before a single row is read. Switch to <span className="text-text">List</span>{' '}
              for precise sorting, keyboard navigation and screen-reader access.
            </p>
          </Card>
        ) : (
        <Card className="overflow-hidden">
          {query.isError ? (
            <EmptyState
              title="These results could not be loaded."
              description={
                query.error instanceof ApiError && query.error.status === 400
                  ? (query.error.details?.[0]?.message ??
                    'One of the filters is not valid. Try clearing them.')
                  : 'The API did not respond. Check that the backend is running on port 4000.'
              }
              action={
                <Button variant="outline" onClick={() => query.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : query.isLoading ? (
            <SkeletonTable rows={10} columns={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No transactions match these filters."
              description="Widen the date range or clear the search to see more."
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={resetAll}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <>
              {/* Table — 640px and up */}
              <table className="hidden w-full border-collapse sm:table">
                <thead className="border-b border-hairline bg-void/40">
                  <tr>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Transaction</th>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Risk</th>
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Type</th>
                    <SortHeader label="Amount" field="amount" filters={filters} onSort={handleSort} align="right" />
                    <th className="label-caps px-4 py-2.5 text-left text-dim">Counterparties</th>
                    <SortHeader label="Occurred" field="txnTimestamp" filters={filters} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((txn) => (
                    <tr
                      key={txn.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openDrawer(txn.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openDrawer(txn.id)
                        }
                      }}
                      className="cursor-pointer border-b border-hairline transition-colors last:border-b-0 hover:bg-raised focus-visible:bg-raised"
                      style={
                        byTxnId[txn.txnId]?.riskLevel === 'CRITICAL'
                          ? {
                              // The row itself radiates, rather than relying on
                              // the badge alone to carry the severity.
                              boxShadow: `inset 2px 0 0 var(--critical), inset 0 0 40px -18px rgba(${RISK_META.CRITICAL.rgb},0.75)`,
                            }
                          : undefined
                      }
                    >
                      <td className="num px-4 py-3 text-[12px] text-text">{txn.txnId}</td>
                      <td className="px-4 py-3">
                        <RiskBadge
                          level={byTxnId[txn.txnId]?.riskLevel}
                          size="sm"
                          glow={byTxnId[txn.txnId]?.riskLevel === 'CRITICAL'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="label-caps text-dim">{txn.txnType}</span>
                      </td>
                      <td className="num px-4 py-3 text-right text-[12.5px] text-text">
                        {formatMoney(txn.amount)}
                      </td>
                      <td className="num px-4 py-3 text-[11.5px] text-dim">
                        {txn.senderId} <span className="text-hairline">→</span> {txn.receiverId}
                      </td>
                      <td className="num px-4 py-3 text-[11.5px] text-dim">
                        {formatDateTime(txn.txnTimestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Stacked cards — below 640px */}
              <ul className="sm:hidden">
                {rows.map((txn) => (
                  <li key={txn.id} className="border-b border-hairline last:border-b-0">
                    <button
                      onClick={() => openDrawer(txn.id)}
                      className="w-full px-4 py-3.5 text-left transition-colors hover:bg-raised"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="num truncate text-[11.5px] text-dim">{txn.txnId}</span>
                        <span className="num shrink-0 text-[13px] text-text">
                          {formatMoney(txn.amount)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3">
                        <span className="label-caps text-dim">{txn.txnType}</span>
                        <span className="num text-[11px] text-dim">
                          {formatDateTime(txn.txnTimestamp)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        )}

        {/* Pagination */}
        {view === 'list' && pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="num text-[12px] text-dim">
              Page {pagination.page} of {formatCount(pagination.totalPages)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasPreviousPage}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.hasNextPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </>
  )
}
