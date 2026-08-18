/**
 * Transaction detail drawer — the signature surface.
 *
 * Slides in from the right over a fading backdrop. Built on Radix Dialog for
 * the accessibility work that is tedious and easy to get wrong (focus trap,
 * escape to close, aria wiring, restoring focus to the trigger), with
 * framer-motion driving the movement, since Radix's own animation hooks cannot
 * express a spring.
 *
 * Reads top to bottom the way an investigator would work: what is this, how bad
 * is it, why does the model think so, what are the underlying facts, what do I
 * do about it.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { Trash2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { useUI } from '../store/ui.js'
import { useAuth } from '../store/auth.js'
import { can } from '../lib/permissions.js'
import { toast } from '../store/toast.js'
import { api, qs, ApiError } from '../lib/api.js'
import { RISK_META, formatDateTime, formatMoney } from '../lib/format.js'
import { RiskBadge } from './ui/RiskBadge.jsx'
import { Button } from './ui/Button.jsx'
import { Segmented } from './ui/Input.jsx'
import { Skeleton } from './ui/Skeleton.jsx'
import { RiskGauge } from './RiskGauge.jsx'
import { EvidenceLedger } from './EvidenceLedger.jsx'

/**
 * Load the transaction, then its prediction.
 *
 * Sequential because the API has no endpoint returning a prediction by
 * transaction id — the prediction is found by searching on the transaction's
 * txn_id, which is only known after the first call.
 */
function useTransactionDetail(transactionId) {
  const transaction = useQuery({
    queryKey: ['transaction', transactionId],
    queryFn: () => api.get(`/transactions/${transactionId}`),
    enabled: Boolean(transactionId),
    select: (data) => data.transaction,
  })

  const txnId = transaction.data?.txnId

  const prediction = useQuery({
    queryKey: ['prediction-for', txnId],
    queryFn: async () => {
      const data = await api.get(`/predictions${qs({ search: txnId, pageSize: 1 })}`)
      return data.predictions?.[0] ?? null
    },
    enabled: Boolean(txnId),
  })

  return { transaction, prediction }
}

function SectionLabel({ children, className = '' }) {
  return <h3 className={`label-caps text-dim ${className}`}>{children}</h3>
}

/** Two-column key/value: keys in Inter slate, values in mono. */
function DetailRow({ label, children, mono = true }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2.5 last:border-b-0">
      <dt className="shrink-0 text-[12px] text-dim">{label}</dt>
      <dd className={`min-w-0 break-words text-right text-[12.5px] text-text ${mono ? 'num' : ''}`}>
        {children}
      </dd>
    </div>
  )
}

const CASE_OPTIONS = [
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'CONFIRMED_FRAUD', label: 'Confirmed fraud' },
  { value: 'FALSE_POSITIVE', label: 'False positive' },
]

function DrawerBody({ transactionId, onClose, onRiskChange }) {
  const queryClient = useQueryClient()
  const user = useAuth((s) => s.user)
  const { transaction, prediction } = useTransactionDetail(transactionId)
  const [caseStatus, setCaseStatus] = useState('UNDER_REVIEW')

  const txn = transaction.data
  const pred = prediction.data

  const rescore = useMutation({
    mutationFn: () => api.post(`/predictions/${transactionId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prediction-for', txn?.txnId] })
      queryClient.invalidateQueries({ queryKey: ['predictions'] })
    },
  })

  /**
   * Soft delete. Admin-only — the API refuses it for anyone else, so the
   * control is not offered rather than offered and refused.
   */
  const remove = useMutation({
    mutationFn: () => api.del(`/transactions/${transactionId}`),
    onSuccess: () => {
      toast.success('Transaction deleted', `${txn?.txnId} · removed from all views`)
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['scatter'] })
      onClose?.()
    },
    onError: (err) =>
      toast.error(
        'Could not delete this transaction',
        err instanceof ApiError && err.status === 403
          ? 'Deleting a transaction is an admin action.'
          : err instanceof ApiError && err.code === 'ALREADY_DELETED'
            ? 'It has already been deleted.'
            : (err?.message ?? 'The API did not respond.'),
      ),
  })

  const loading = transaction.isLoading || (Boolean(txn) && prediction.isLoading)

  // Lift the level so the panel edge can glow in the matching colour.
  useEffect(() => onRiskChange?.(pred?.riskLevel ?? null), [pred?.riskLevel, onRiskChange])

  if (transaction.isError) {
    const err = transaction.error
    return (
      <div className="px-6 py-10">
        <p className="text-[13px] leading-relaxed text-critical">
          {err instanceof ApiError && err.status === 404
            ? 'This transaction no longer exists, or it has been deleted.'
            : (err?.message ?? 'The transaction could not be loaded.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* 1 — Header */}
      <header className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
        <div className="min-w-0">
          <p className="label-caps mb-1.5 text-dim">Transaction</p>
          {loading ? (
            <Skeleton className="h-4 w-52" />
          ) : (
            <p className="num truncate text-[13px] text-text">{txn?.txnId}</p>
          )}
          <div className="mt-2.5">
            {loading ? <Skeleton className="h-5 w-24" /> : <RiskBadge level={pred?.riskLevel} />}
          </div>
        </div>

        <Dialog.Close asChild>
          <button
            aria-label="Close detail"
            className="-mr-1 -mt-1 rounded-control p-1.5 text-dim transition-colors hover:bg-hairline/50 hover:text-text"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M3 3l9 9M12 3l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </Dialog.Close>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 2 — The gauge */}
        <section className="border-b border-hairline px-6 py-7">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="h-[150px] w-[190px] rounded-full" />
            </div>
          ) : pred ? (
            <RiskGauge score={pred.riskScore} size={230} />
          ) : (
            <div className="py-6 text-center">
              <p className="text-[13px] text-dim">This transaction has not been scored yet.</p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                loading={rescore.isPending}
                onClick={() => rescore.mutate()}
              >
                Score it now
              </Button>
            </div>
          )}
        </section>

        {pred && (
          <>
            {/* 3 — Explanation, set as a case note */}
            <section className="border-b border-hairline px-6 py-5">
              <SectionLabel>Assessment</SectionLabel>
              <blockquote className="mt-3 border-l-2 border-accent bg-void py-2 pl-4 pr-3">
                <p className="text-[13.5px] leading-[1.65] text-text">{pred.explanationSummary}</p>
              </blockquote>
              <p className="num mt-2.5 text-[11px] text-dim">
                {pred.modelVersion} · scored {formatDateTime(pred.createdAt)}
              </p>
            </section>

            {/* 4 — The evidence ledger */}
            <section className="border-b border-hairline px-6 py-5">
              <SectionLabel>Evidence</SectionLabel>
              <div className="mt-3">
                <EvidenceLedger contributions={pred.featureContributions ?? []} riskLevel={pred.riskLevel} />
              </div>
            </section>
          </>
        )}

        {/* 5 — Underlying facts */}
        <section className="border-b border-hairline px-6 py-5">
          <SectionLabel>Transaction</SectionLabel>
          {loading ? (
            <div className="mt-3 flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </div>
          ) : (
            <dl className="mt-2">
              <DetailRow label="Amount">{formatMoney(txn?.amount)}</DetailRow>
              <DetailRow label="Type" mono={false}>
                <span className="label-caps text-text">{txn?.txnType}</span>
              </DetailRow>
              <DetailRow label="Sender">{txn?.senderId}</DetailRow>
              <DetailRow label="Receiver">{txn?.receiverId}</DetailRow>
              <DetailRow label="Sender balance">
                {formatMoney(txn?.origBalanceBefore)} → {formatMoney(txn?.origBalanceAfter)}
              </DetailRow>
              <DetailRow label="Receiver balance">
                {formatMoney(txn?.destBalanceBefore)} → {formatMoney(txn?.destBalanceAfter)}
              </DetailRow>
              <DetailRow label="Occurred">{formatDateTime(txn?.txnTimestamp)}</DetailRow>
              <DetailRow label="Ingested">{formatDateTime(txn?.createdAt)}</DetailRow>
              {txn?.uploadedBy && (
                <DetailRow label="Uploaded by" mono={false}>
                  <span className="text-[12.5px]">{txn.uploadedBy.name}</span>
                </DetailRow>
              )}
            </dl>
          )}
        </section>

        {/* 6 — Actions */}
        <section className="px-6 py-5">
          <SectionLabel>Actions</SectionLabel>

          <div className="mt-3 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={rescore.isPending}
                onClick={() => rescore.mutate()}
                disabled={!txn}
              >
                Rescore
              </Button>
              {rescore.isError && (
                <span className="text-[12px] text-critical">
                  {rescore.error instanceof ApiError && rescore.error.status === 502
                    ? 'Scoring service unavailable.'
                    : (rescore.error?.message ?? 'Rescore failed.')}
                </span>
              )}
              {rescore.isSuccess && <span className="text-[12px] text-clear">Rescored.</span>}

              {can.deleteTransaction(user) && (
                <Button
                  variant="danger"
                  size="sm"
                  className="ml-auto"
                  loading={remove.isPending}
                  onClick={() => {
                    // A soft delete is reversible in the database but removes the
                    // row from every view, so it still deserves a confirmation.
                    if (window.confirm(`Delete ${txn?.txnId}? It will disappear from all views.`)) {
                      remove.mutate()
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                  Delete
                </Button>
              )}
            </div>

            {/* Only meaningful once something needs a decision. */}
            {(pred?.riskLevel === 'SUSPICIOUS' || pred?.riskLevel === 'CRITICAL') && (
              <div>
                <p className="mb-2 text-[12px] text-dim">Case status</p>
                <Segmented
                  name="Case status"
                  options={CASE_OPTIONS}
                  value={caseStatus}
                  onChange={setCaseStatus}
                />
                <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
                  Not yet persisted — the cases API arrives with the review queue.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export function TransactionDrawer() {
  const transactionId = useUI((s) => s.drawerTransactionId)
  const closeDrawer = useUI((s) => s.closeDrawer)
  const reduceMotion = useReducedMotion()
  const open = Boolean(transactionId)
  const [risk, setRisk] = useState(null)
  const onRiskChange = useCallback((next) => setRisk(next), [])
  const meta = risk ? RISK_META[risk] : null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && closeDrawer()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-accent/25"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.18 }}
              />
            </Dialog.Overlay>

            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-surface sm:w-[420px]"
                style={{
                  borderColor: meta ? `rgba(${meta.rgb},0.4)` : 'var(--hairline)',
                  boxShadow: meta ? `-24px 0 60px -30px rgba(${meta.rgb},0.55)` : undefined,
                }}
                initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
                animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 }
                }
              >
                <Dialog.Title className="sr-only">Transaction detail</Dialog.Title>
                <DrawerBody transactionId={transactionId} onClose={closeDrawer} onRiskChange={onRiskChange} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
