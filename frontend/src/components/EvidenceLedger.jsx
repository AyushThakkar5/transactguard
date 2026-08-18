/**
 * The evidence ledger.
 *
 * The scorer's feature_contributions as a ranked list rather than a chart
 * widget — a sequence of findings, read the way an analyst reads numbered
 * evidence, strongest first.
 *
 * Bars carry the prediction's risk colour and a matching glow, and grow from
 * zero in a staggered cascade on open, so the ranking builds in front of you
 * instead of appearing fully formed.
 *
 * Bar length encodes `contribution` (points the factor put on the 0-100 score)
 * because that is what determines the ordering — a bar disagreeing with the
 * sort would read as a bug. The mono number is `magnitude`: how hard the rule
 * itself fired, independent of how much the model weights it.
 */

import { motion, useReducedMotion } from 'framer-motion'
import { RISK_META, humanizeFactor, rank } from '../lib/format.js'

export function EvidenceLedger({ contributions = [], riskLevel }) {
  const reduceMotion = useReducedMotion()
  const meta = RISK_META[riskLevel] ?? null

  if (contributions.length === 0) {
    return (
      <p className="px-1 py-4 text-[13px] leading-relaxed text-dim">
        No factors fired for this transaction. Nothing about it deviated from normal account
        activity.
      </p>
    )
  }

  const maxContribution = Math.max(
    ...contributions.map((c) => c.contribution ?? c.magnitude ?? 0),
    0.0001,
  )

  return (
    <ol className="border-t border-hairline">
      {contributions.map((factor, index) => {
        const contribution = factor.contribution ?? factor.magnitude ?? 0
        const width = Math.max(2, (contribution / maxContribution) * 100)

        return (
          <li key={factor.factor ?? index} className="border-b border-hairline py-3">
            <div className="flex items-baseline gap-3">
              <span className="num shrink-0 text-[10.5px] text-dim">{rank(index)}</span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-text">
                    {humanizeFactor(factor.factor)}
                  </span>
                  <span className="num shrink-0 text-[12px]" style={{ color: meta?.color }}>
                    {Number(factor.magnitude ?? 0).toFixed(2)}
                  </span>
                </div>

                <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-hairline">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: meta?.color ?? 'var(--accent)',
                      boxShadow: meta?.glow ?? 'var(--accent-glow)',
                    }}
                    initial={reduceMotion ? false : { width: 0 }}
                    animate={{ width: `${width}%` }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : {
                            duration: 0.7,
                            // Staggered so the ranking reads as it builds.
                            delay: 0.25 + index * 0.07,
                            ease: [0.22, 1, 0.36, 1],
                          }
                    }
                  />
                </div>

                {factor.description && (
                  <p className="mt-2 text-[12px] leading-relaxed text-dim">{factor.description}</p>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
