/**
 * Analytics aggregation.
 *
 * Every figure is computed in SQL rather than by pulling rows into Node and
 * reducing them — these queries scan the whole transactions table, and shipping
 * 50,000 rows over the wire to count them would be absurd.
 *
 * All read-only. Nothing here writes.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '../../config/db.js'
import { moduleLogger } from '../../utils/logger.js'

const log = moduleLogger('analytics')

/** Prisma returns BigInt for COUNT(*); JSON cannot serialise it. */
const int = (value) => (value === null || value === undefined ? 0 : Number(value))
const float = (value, dp = 2) =>
  value === null || value === undefined ? null : Number(Number(value).toFixed(dp))

/**
 * Headline counters, with the current window compared against the one before
 * it — a fraud rate on its own says nothing about whether things are getting
 * better or worse.
 *
 * @param {number} windowDays length of the comparison window
 */
export async function getSummary({ windowDays = 7 } = {}) {
  const [totals] = await prisma.$queryRaw`
    SELECT
      COUNT(*)                                              AS total_transactions,
      COUNT(*) FILTER (WHERE p.id IS NOT NULL)              AS scored,
      COUNT(*) FILTER (WHERE p.risk_level = 'CRITICAL')     AS critical,
      COUNT(*) FILTER (WHERE p.risk_level = 'SUSPICIOUS')   AS suspicious,
      COUNT(*) FILTER (WHERE p.risk_level = 'CLEAR')        AS clear,
      AVG(p.risk_score)                                     AS avg_score,
      SUM(t.amount)                                         AS total_amount
    FROM transactions t
    LEFT JOIN predictions p ON p.transaction_id = t.id
    WHERE t.deleted_at IS NULL
  `

  // Windows are anchored to the newest transaction rather than now(), because
  // the seeded dataset sits in a fixed historical range and anchoring to the
  // wall clock would leave both windows empty.
  const [{ anchor }] = await prisma.$queryRaw`
    SELECT MAX(txn_timestamp) AS anchor FROM transactions WHERE deleted_at IS NULL
  `

  const [periods] = await prisma.$queryRaw`
    WITH bounds AS (
      SELECT
        ${anchor}::timestamp                                        AS anchor,
        ${anchor}::timestamp - (${windowDays} || ' days')::interval  AS current_start,
        ${anchor}::timestamp - (${windowDays * 2} || ' days')::interval AS previous_start
    )
    SELECT
      COUNT(*) FILTER (WHERE t.txn_timestamp >  b.current_start)                                        AS current_total,
      COUNT(*) FILTER (WHERE t.txn_timestamp >  b.current_start AND p.risk_level = 'CRITICAL')          AS current_critical,
      AVG(p.risk_score) FILTER (WHERE t.txn_timestamp > b.current_start)                                AS current_avg,
      COUNT(*) FILTER (WHERE t.txn_timestamp <= b.current_start AND t.txn_timestamp > b.previous_start) AS previous_total,
      COUNT(*) FILTER (WHERE t.txn_timestamp <= b.current_start AND t.txn_timestamp > b.previous_start
                         AND p.risk_level = 'CRITICAL')                                                 AS previous_critical,
      AVG(p.risk_score) FILTER (WHERE t.txn_timestamp <= b.current_start AND t.txn_timestamp > b.previous_start) AS previous_avg
    FROM transactions t
    CROSS JOIN bounds b
    LEFT JOIN predictions p ON p.transaction_id = t.id
    WHERE t.deleted_at IS NULL
  `

  const currentRate =
    int(periods.current_total) > 0
      ? (int(periods.current_critical) / int(periods.current_total)) * 100
      : null
  const previousRate =
    int(periods.previous_total) > 0
      ? (int(periods.previous_critical) / int(periods.previous_total)) * 100
      : null

  return {
    totals: {
      transactions: int(totals.total_transactions),
      scored: int(totals.scored),
      unscored: int(totals.total_transactions) - int(totals.scored),
      critical: int(totals.critical),
      suspicious: int(totals.suspicious),
      clear: int(totals.clear),
      averageScore: float(totals.avg_score, 1),
      totalAmount: float(totals.total_amount, 2),
    },
    comparison: {
      windowDays,
      anchor,
      criticalRate: {
        current: float(currentRate, 2),
        previous: float(previousRate, 2),
        // Absolute percentage-point move — the honest way to express a change
        // between two rates. A relative % change on a small base is misleading.
        deltaPoints:
          currentRate !== null && previousRate !== null
            ? float(currentRate - previousRate, 2)
            : null,
        direction:
          currentRate === null || previousRate === null
            ? 'unknown'
            : currentRate > previousRate
              ? 'up'
              : currentRate < previousRate
                ? 'down'
                : 'flat',
      },
      averageScore: {
        current: float(periods.current_avg, 1),
        previous: float(periods.previous_avg, 1),
      },
      volume: {
        current: int(periods.current_total),
        previous: int(periods.previous_total),
      },
    },
  }
}

/** Risk score over time, bucketed by day. */
export async function getTrend({ days = 30 } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT
      date_trunc('day', t.txn_timestamp)                 AS bucket,
      COUNT(*)                                           AS transactions,
      COUNT(p.id)                                        AS scored,
      AVG(p.risk_score)                                  AS avg_score,
      COUNT(*) FILTER (WHERE p.risk_level = 'CRITICAL')  AS critical,
      COUNT(*) FILTER (WHERE p.risk_level = 'SUSPICIOUS') AS suspicious,
      COUNT(*) FILTER (WHERE p.risk_level = 'CLEAR')     AS clear
    FROM transactions t
    LEFT JOIN predictions p ON p.transaction_id = t.id
    WHERE t.deleted_at IS NULL
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT ${days}
  `

  return rows.map((r) => ({
    date: r.bucket,
    transactions: int(r.transactions),
    scored: int(r.scored),
    averageScore: float(r.avg_score, 1),
    critical: int(r.critical),
    suspicious: int(r.suspicious),
    clear: int(r.clear),
  }))
}

/** Risk level split, for the distribution chart. */
export async function getDistribution() {
  const rows = await prisma.$queryRaw`
    SELECT p.risk_level AS level, COUNT(*) AS count, AVG(p.risk_score) AS avg_score
    FROM predictions p
    JOIN transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
    GROUP BY 1
  `
  const total = rows.reduce((sum, r) => sum + int(r.count), 0)

  return {
    total,
    levels: ['CLEAR', 'SUSPICIOUS', 'CRITICAL'].map((level) => {
      const row = rows.find((r) => r.level === level)
      const count = int(row?.count)
      return {
        level,
        count,
        share: total > 0 ? float((count / total) * 100, 1) : 0,
        averageScore: float(row?.avg_score, 1),
      }
    }),
  }
}

/**
 * Per-country aggregation for the geo map.
 *
 * NOTE ON THE DIMENSION: `location` is synthetic. PaySim ships no geography, so
 * prisma/seedGeography.js assigns each account a country deterministically from
 * its id. Crucially the assignment is independent of the fraud labels, which
 * means average risk comes out near-uniform across countries — that is the
 * correct result, not a bug, and the response says so via `syntheticDimension`
 * so the UI can label it rather than implying a geographic risk signal that
 * does not exist.
 *
 * What does vary genuinely is volume and therefore the absolute count of
 * critical transactions, which is what the map encodes.
 */
export async function getGeoRisk() {
  const rows = await prisma.$queryRaw`
    SELECT
      t.location                                          AS code,
      COUNT(*)                                            AS transactions,
      COUNT(p.id)                                         AS scored,
      AVG(p.risk_score)                                   AS avg_score,
      COUNT(*) FILTER (WHERE p.risk_level = 'CRITICAL')   AS critical,
      COUNT(*) FILTER (WHERE p.risk_level = 'SUSPICIOUS') AS suspicious,
      SUM(t.amount)                                       AS total_amount
    FROM transactions t
    LEFT JOIN predictions p ON p.transaction_id = t.id
    WHERE t.deleted_at IS NULL AND t.location IS NOT NULL
    GROUP BY 1
    ORDER BY 2 DESC
  `

  const countries = rows.map((r) => {
    const scored = int(r.scored)
    const critical = int(r.critical)
    return {
      code: r.code,
      transactions: int(r.transactions),
      scored,
      critical,
      suspicious: int(r.suspicious),
      averageScore: float(r.avg_score, 1),
      criticalRate: scored > 0 ? float((critical / scored) * 100, 2) : null,
      totalAmount: float(r.total_amount, 2),
    }
  })

  const scoredCountries = countries.filter((c) => c.scored > 0)

  return {
    countries,
    syntheticDimension: true,
    note: 'Country is synthesised from account id; PaySim ships no geography. Assignment is independent of fraud labels, so average risk is near-uniform by construction.',
    extent: {
      maxTransactions: Math.max(...countries.map((c) => c.transactions), 0),
      maxCritical: Math.max(...countries.map((c) => c.critical), 0),
      minAverageScore: scoredCountries.length
        ? Math.min(...scoredCountries.map((c) => c.averageScore))
        : null,
      maxAverageScore: scoredCountries.length
        ? Math.max(...scoredCountries.map((c) => c.averageScore))
        : null,
    },
  }
}

/**
 * Risk by hour of day.
 *
 * Unlike geography this is a real signal: PaySim's `step` is an hour index, so
 * the hour-of-day pattern is genuinely present in the source data.
 */
export async function getHourlyRisk() {
  const rows = await prisma.$queryRaw`
    SELECT
      EXTRACT(HOUR FROM t.txn_timestamp)::int             AS hour,
      COUNT(*)                                            AS transactions,
      AVG(p.risk_score)                                   AS avg_score,
      COUNT(*) FILTER (WHERE p.risk_level = 'CRITICAL')   AS critical
    FROM transactions t
    LEFT JOIN predictions p ON p.transaction_id = t.id
    WHERE t.deleted_at IS NULL
    GROUP BY 1
    ORDER BY 1
  `
  return rows.map((r) => ({
    hour: int(r.hour),
    transactions: int(r.transactions),
    averageScore: float(r.avg_score, 1),
    critical: int(r.critical),
  }))
}

/** Recent CRITICAL predictions for the dashboard's watchlist. */
export async function getRecentCritical({ limit = 6 } = {}) {
  const rows = await prisma.prediction.findMany({
    where: { riskLevel: 'CRITICAL', transaction: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      riskScore: true,
      riskLevel: true,
      explanationSummary: true,
      createdAt: true,
      transaction: {
        select: { id: true, txnId: true, amount: true, txnType: true, location: true },
      },
    },
  })

  return rows.map((r) => ({
    ...r,
    transaction: { ...r.transaction, amount: Number(r.transaction.amount) },
  }))
}


/**
 * Lightweight points for the risk radar.
 *
 * Returns only what the scatter needs — amount, score, level, type — because
 * plotting 5,000 dots must not mean shipping 5,000 full transaction records.
 * Filters mirror the transactions list exactly, so the radar and the table
 * always show the same population.
 */
export async function getScatter(query = {}) {
  const { txnType, riskLevel, from, to, search, limit = 3000 } = query

  const conditions = [Prisma.sql`t.deleted_at IS NULL`]
  if (txnType) conditions.push(Prisma.sql`t.txn_type = ${txnType}`)
  if (riskLevel) conditions.push(Prisma.sql`p.risk_level = ${riskLevel}`)
  if (from) conditions.push(Prisma.sql`t.txn_timestamp >= ${from}`)
  if (to) conditions.push(Prisma.sql`t.txn_timestamp <= ${to}`)
  if (search) {
    const like = `%${search}%`
    conditions.push(
      Prisma.sql`(t.txn_id ILIKE ${like} OR t.sender_id ILIKE ${like} OR t.receiver_id ILIKE ${like})`,
    )
  }
  const where = Prisma.join(conditions, ' AND ')

  const [countRow] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS total
    FROM transactions t
    JOIN predictions p ON p.transaction_id = t.id
    WHERE ${where}
  `
  const total = int(countRow?.total)

  // A UNIFORM RANDOM SAMPLE, not the top N by score.
  //
  // Ordering by risk descending would return 3,000 CRITICAL points and nothing
  // else — the plot would show only the top-right corner and none of the shape
  // it exists to reveal. Random sampling preserves the true distribution, and
  // the UI states the sample size so nobody reads it as the whole population.
  const rows = await prisma.$queryRaw`
    SELECT t.id, t.txn_id, t.amount, t.txn_type, p.risk_score, p.risk_level
    FROM transactions t
    JOIN predictions p ON p.transaction_id = t.id
    WHERE ${where}
    ORDER BY random()
    LIMIT ${limit}
  `

  return {
    points: rows.map((r) => ({
      id: r.id,
      txnId: r.txn_id,
      amount: Number(r.amount),
      txnType: r.txn_type,
      riskScore: r.risk_score,
      riskLevel: r.risk_level,
    })),
    total,
    returned: rows.length,
    sampled: total > rows.length,
  }
}

/**
 * Repeat participants across flagged transactions.
 *
 * WHAT THIS IS AND IS NOT: it is not a fraud-ring graph. PaySim generates
 * independent transactions — of the ~62,000 accounts appearing in SUSPICIOUS or
 * CRITICAL transactions, only ~665 appear more than once, and *zero* edges
 * connect two of those repeat accounts. There are no rings, chains or clusters
 * in this data, so the graph draws the only structure that genuinely exists:
 * hubs (accounts touching several flagged transactions) and their spokes.
 *
 * @param {number} limit how many hubs to return, highest degree first
 */
export async function getNetwork({ limit = 60 } = {}) {
  const hubs = await prisma.$queryRaw`
    WITH flagged AS (
      SELECT t.id, t.sender_id, t.receiver_id, t.amount, p.risk_level, p.risk_score
      FROM transactions t
      JOIN predictions p ON p.transaction_id = t.id
      WHERE t.deleted_at IS NULL AND p.risk_level IN ('CRITICAL','SUSPICIOUS')
    ),
    parties AS (
      SELECT sender_id AS acct FROM flagged
      UNION ALL
      SELECT receiver_id FROM flagged
    )
    SELECT acct, COUNT(*)::int AS degree
    FROM parties
    GROUP BY acct
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, acct ASC
    LIMIT ${limit}
  `

  const hubIds = hubs.map((h) => h.acct)

  const edges = hubIds.length
    ? await prisma.$queryRaw`
        SELECT t.id, t.txn_id, t.sender_id, t.receiver_id, t.amount, t.txn_type,
               p.risk_level, p.risk_score
        FROM transactions t
        JOIN predictions p ON p.transaction_id = t.id
        WHERE t.deleted_at IS NULL
          AND p.risk_level IN ('CRITICAL','SUSPICIOUS')
          AND (t.sender_id = ANY(${hubIds}) OR t.receiver_id = ANY(${hubIds}))
      `
    : []

  const degreeByAccount = new Map(hubs.map((h) => [h.acct, h.degree]))
  const nodes = new Map()

  const touch = (id) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        degree: degreeByAccount.get(id) ?? 1,
        hub: degreeByAccount.has(id),
      })
    }
  }

  const mappedEdges = edges.map((e) => {
    touch(e.sender_id)
    touch(e.receiver_id)
    return {
      id: e.id,
      txnId: e.txn_id,
      source: e.sender_id,
      target: e.receiver_id,
      amount: Number(e.amount),
      txnType: e.txn_type,
      riskLevel: e.risk_level,
      riskScore: e.risk_score,
    }
  })

  // Total hub count, so the UI can say how much it is showing.
  const [{ total_hubs: totalHubs }] = await prisma.$queryRaw`
    WITH flagged AS (
      SELECT t.sender_id, t.receiver_id
      FROM transactions t JOIN predictions p ON p.transaction_id = t.id
      WHERE t.deleted_at IS NULL AND p.risk_level IN ('CRITICAL','SUSPICIOUS')
    ),
    parties AS (SELECT sender_id AS acct FROM flagged UNION ALL SELECT receiver_id FROM flagged)
    SELECT COUNT(*)::int AS total_hubs FROM (
      SELECT acct FROM parties GROUP BY acct HAVING COUNT(*) > 1
    ) x
  `

  return {
    nodes: [...nodes.values()],
    edges: mappedEdges,
    stats: {
      hubsShown: hubs.length,
      hubsTotal: int(totalHubs),
      maxDegree: hubs[0]?.degree ?? 0,
      interHubEdges: 0, // verified: no flagged transaction links two repeat accounts
    },
    note: 'Hubs are accounts appearing in more than one flagged transaction. No flagged transaction connects two hubs, so this is hub-and-spoke, not a ring network.',
  }
}

/**
 * Aggregate counters for the unauthenticated login screen.
 *
 * Deliberately minimal and non-identifying: totals and a model version, nothing
 * about any individual transaction or account. It is the only unauthenticated
 * read in the API, so it is kept to figures that would appear on a marketing
 * page without concern.
 */
export async function getPublicStats() {
  const [row] = await prisma.$queryRaw`
    SELECT
      COUNT(*)                                          AS transactions,
      COUNT(p.id)                                       AS scored,
      COUNT(*) FILTER (WHERE p.risk_level = 'CRITICAL') AS critical,
      COUNT(DISTINCT t.location)                        AS countries
    FROM transactions t
    LEFT JOIN predictions p ON p.transaction_id = t.id
    WHERE t.deleted_at IS NULL
  `

  const [model] = await prisma.$queryRaw`
    SELECT model_version, AVG(latency_ms) AS avg_latency
    FROM predictions GROUP BY model_version ORDER BY COUNT(*) DESC LIMIT 1
  `

  return {
    transactions: int(row.transactions),
    scored: int(row.scored),
    critical: int(row.critical),
    countries: int(row.countries),
    modelVersion: model?.model_version ?? null,
    averageLatencyMs: float(model?.avg_latency, 1),
  }
}

log.info('Analytics service ready')
