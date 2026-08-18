/**
 * Backfill transaction geography.
 *
 *   node prisma/seedGeography.js [--reset]
 *
 * WHY THIS EXISTS, PLAINLY: PaySim ships no geography. There is no country,
 * region or coordinate anywhere in the source dataset, and `location` was null
 * on every row. The geo map needs a dimension to aggregate over, so one is
 * synthesised here rather than invented in the browser — that way the API
 * genuinely serves it, aggregation happens in SQL, and there is exactly one
 * place to point at when someone asks where the countries came from.
 *
 * The assignment is:
 *   · deterministic — the same account id always resolves to the same country,
 *     so a re-run is idempotent and a given account never migrates
 *   · volume-weighted — countries get realistic differing shares of traffic
 *     rather than a flat 1/26 each
 *   · independent of fraud labels — country is derived from the account id
 *     alone. Biasing it by isFraud would make geography a perfect predictor of
 *     fraud, which is nonsense, and would quietly poison any model trained on
 *     it later.
 *
 * Risk therefore varies across the map only as far as the real underlying
 * predictions vary. That is the honest result, and the UI labels the dimension
 * as synthetic.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

/** ISO 3166-1 alpha-2 with a rough share of payment traffic. */
const COUNTRIES = [
  { code: 'US', weight: 12 },
  { code: 'IN', weight: 10 },
  { code: 'GB', weight: 8 },
  { code: 'NG', weight: 7 },
  { code: 'BR', weight: 6 },
  { code: 'DE', weight: 6 },
  { code: 'KE', weight: 6 },
  { code: 'CN', weight: 5 },
  { code: 'FR', weight: 5 },
  { code: 'ZA', weight: 5 },
  { code: 'MX', weight: 4 },
  { code: 'ID', weight: 4 },
  { code: 'PH', weight: 4 },
  { code: 'AU', weight: 3 },
  { code: 'CA', weight: 3 },
  { code: 'JP', weight: 3 },
  { code: 'PK', weight: 3 },
  { code: 'EG', weight: 3 },
  { code: 'TR', weight: 3 },
  { code: 'AE', weight: 3 },
  { code: 'RU', weight: 3 },
  { code: 'SG', weight: 2 },
  { code: 'ES', weight: 2 },
  { code: 'IT', weight: 2 },
  { code: 'VN', weight: 2 },
  { code: 'TH', weight: 2 },
]

const RESOLUTION = 4096

/** Cumulative lookup table, so weighting costs one array index per row. */
function buildTable() {
  const total = COUNTRIES.reduce((sum, c) => sum + c.weight, 0)
  const table = []
  for (const { code, weight } of COUNTRIES) {
    const slots = Math.round((weight / total) * RESOLUTION)
    for (let i = 0; i < slots; i++) table.push(code)
  }
  // Pad any rounding shortfall with the largest market.
  while (table.length < RESOLUTION) table.push(COUNTRIES[0].code)
  return table
}

/** FNV-1a — small, stable, and dependency-free. Stability is the whole point. */
function hash(value) {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const TABLE = buildTable()
const countryFor = (accountId) => TABLE[hash(accountId) % RESOLUTION]

async function main() {
  const reset = process.argv.includes('--reset')

  const total = await prisma.transaction.count()
  console.log(`\nAssigning synthetic geography to ${total.toLocaleString()} transactions\n`)

  if (reset) {
    await prisma.$executeRaw`UPDATE transactions SET location = NULL`
    console.log('  --reset: cleared existing locations\n')
  }

  // Pull ids in pages so a large table never lands in memory at once.
  const PAGE = 5000
  const byCountry = new Map()
  let cursor = null
  let read = 0

  for (;;) {
    const page = await prisma.transaction.findMany({
      select: { id: true, senderId: true },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (page.length === 0) break

    for (const row of page) {
      const code = countryFor(row.senderId)
      if (!byCountry.has(code)) byCountry.set(code, [])
      byCountry.get(code).push(row.id)
    }

    read += page.length
    cursor = page[page.length - 1].id
    process.stdout.write(`\r  read ${read.toLocaleString()} / ${total.toLocaleString()}   `)
    if (page.length < PAGE) break
  }

  console.log('\n')

  // One UPDATE per country rather than one per row.
  let updated = 0
  const summary = []
  for (const [code, ids] of [...byCountry.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const result = await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { location: code },
    })
    updated += result.count
    summary.push({ code, count: result.count })
  }

  console.log('  ─────────────────────────────')
  for (const { code, count } of summary.slice(0, 8)) {
    const pct = ((count / total) * 100).toFixed(1)
    console.log(`  ${code}   ${String(count).padStart(6)}   ${pct.padStart(5)}%`)
  }
  console.log(`  … ${summary.length} countries total`)
  console.log('  ─────────────────────────────')
  console.log(`  updated ${updated.toLocaleString()} rows\n`)
}

main()
  .catch((err) => {
    console.error(`\nGeography seed failed: ${err.message}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
