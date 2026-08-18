/**
 * Resolve predictions for the rows currently on screen.
 *
 * WORKAROUND. `GET /transactions` does not embed its prediction, and there is
 * no endpoint that takes a set of transaction ids — so the only way to show a
 * risk level in the table is one lookup per visible row. Bounded to a page
 * (25), fired in parallel, and cached by TanStack under the same key the drawer
 * uses, so opening a row afterwards is free.
 *
 * The right fix is an `include=prediction` option on the transactions list,
 * which is a backend change and is flagged rather than made.
 */

import { useQueries } from '@tanstack/react-query'
import { api, qs } from '../lib/api.js'

export function useRowPredictions(rows = []) {
  const results = useQueries({
    queries: rows.map((row) => ({
      queryKey: ['prediction-for', row.txnId],
      queryFn: async () => {
        const data = await api.get(`/predictions${qs({ search: row.txnId, pageSize: 1 })}`)
        return data.predictions?.[0] ?? null
      },
      enabled: Boolean(row.txnId),
      staleTime: 60_000,
    })),
  })

  const byTxnId = {}
  rows.forEach((row, index) => {
    byTxnId[row.txnId] = results[index]?.data ?? null
  })

  return { byTxnId, isLoading: results.some((r) => r.isLoading) }
}
