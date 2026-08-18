/**
 * Seed the demo database from the PaySim dataset.
 *
 *   node prisma/seedTransactions.js [--target 50000] [--reset]
 *
 * The source file is ~493 MB / 6.36 M rows, so it is streamed through
 * csv-parse and never held in memory. Peak memory is bounded by the batch
 * buffer (~1000 rows), not by the file size.
 *
 * Sampling keeps the class imbalance visible: EVERY fraud row is kept (they are
 * only ~0.13% of the data, and a demo database with a handful of them would be
 * useless), topped up with a random sample of legitimate rows to reach the
 * target. The resulting fraud rate is reported at the end so the skew is
 * explicit rather than hidden.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

import {
  extractFraudLabel,
  mapRowToTransaction,
  validateCsvHeaders,
} from '../src/modules/transactions/paysim.mapper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CSV_PATH = path.join(__dirname, 'data', 'PS_20174392719_1491204439457_log.csv')
const BATCH_SIZE = 1000
const PROGRESS_EVERY = 5000

// Total rows in the source file. Used to size the sampling probability up front
// so the file only has to be read once instead of twice.
const SOURCE_ROW_COUNT = 6_362_620

function parseArgs(argv) {
  const args = { target: 50_000, reset: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') args.target = Number(argv[++i])
    else if (argv[i] === '--reset') args.reset = true
  }
  if (!Number.isFinite(args.target) || args.target < 1) {
    throw new Error(`--target must be a positive number, got "${args.target}"`)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const stats = {
  read: 0,
  fraudKept: 0,
  legitKept: 0,
  inserted: 0,
  skipped: 0,
  labelsInserted: 0,
  malformed: 0,
}

const malformedSamples = []

/**
 * Insert one batch of transactions plus their ground-truth labels.
 *
 * skipDuplicates makes the whole script idempotent: txn ids are derived from the
 * row's natural key (see paysim.mapper.js), so re-running never double-inserts.
 */
async function flush(transactions, labels) {
  if (transactions.length === 0) return

  const result = await prisma.transaction.createMany({
    data: transactions,
    skipDuplicates: true,
  })

  stats.inserted += result.count
  stats.skipped += transactions.length - result.count

  // Labels must land after the transactions they reference — fraud_labels.txn_id
  // is a foreign key onto transactions.txn_id.
  if (labels.length > 0) {
    const labelResult = await prisma.fraudLabel.createMany({
      data: labels,
      skipDuplicates: true,
    })
    stats.labelsInserted += labelResult.count
  }
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(
      `PaySim CSV not found at ${CSV_PATH}\n` +
        '  Download it from https://www.kaggle.com/datasets/ealaxi/paysim1 and place it there.',
    )
  }

  const sizeMb = (fs.statSync(CSV_PATH).size / 1024 / 1024).toFixed(0)
  console.log(`\nSeeding transactions from PaySim (${sizeMb} MB)`)
  console.log(`  target sample size: ${args.target.toLocaleString()}\n`)

  if (args.reset) {
    // fraud_labels cascade from transactions, but deleting explicitly keeps the
    // intent obvious and the counts below honest.
    const labels = await prisma.fraudLabel.deleteMany({})
    const txns = await prisma.transaction.deleteMany({})
    console.log(`  --reset: removed ${txns.count} transactions, ${labels.count} labels\n`)
  }

  // Attribute seeded rows to the admin account so uploadedBy is populated and
  // GET /transactions/:id has an uploader to include.
  const admin = await prisma.user.findUnique({
    where: { email: 'admin@transactguard.com' },
    select: { id: true },
  })
  if (!admin) {
    throw new Error('Admin user not found — run `npx prisma db seed` first.')
  }

  // Every fraud row is kept, so the legit rows only need to cover the remainder.
  // ~0.129% of PaySim is fraud (8,213 rows).
  const estimatedFraud = 8_213
  const legitNeeded = Math.max(0, args.target - estimatedFraud)
  const legitTotal = SOURCE_ROW_COUNT - estimatedFraud
  const keepProbability = Math.min(1, legitNeeded / legitTotal)

  console.log(`  keeping all fraud rows + ~${(keepProbability * 100).toFixed(3)}% of legitimate rows\n`)

  const parser = fs.createReadStream(CSV_PATH).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }),
  )

  let headersChecked = false
  let transactions = []
  let labels = []
  const startedAt = Date.now()

  for await (const row of parser) {
    if (!headersChecked) {
      const { valid, missing } = validateCsvHeaders(Object.keys(row))
      if (!valid) throw new Error(`CSV is missing required columns: ${missing.join(', ')}`)
      headersChecked = true
    }

    stats.read++

    const isFraud = row.isFraud === '1'

    // Keep all fraud; sample the rest.
    if (!isFraud && Math.random() >= keepProbability) continue
    // Stop sampling legitimate rows once the target is met, but keep scanning
    // for fraud rows so none are lost.
    if (!isFraud && stats.fraudKept + stats.legitKept >= args.target) continue

    let transaction
    try {
      transaction = mapRowToTransaction(row, { uploadedById: admin.id })
    } catch (err) {
      stats.malformed++
      if (malformedSamples.length < 5) {
        malformedSamples.push(`row ${stats.read}: ${err.message}`)
      }
      continue
    }

    transactions.push(transaction)

    const label = extractFraudLabel(row, transaction.txnId)
    if (label) labels.push(label)

    if (isFraud) stats.fraudKept++
    else stats.legitKept++

    if (transactions.length >= BATCH_SIZE) {
      await flush(transactions, labels)
      transactions = []
      labels = []
    }

    if (stats.read % PROGRESS_EVERY === 0) {
      const pct = ((stats.read / SOURCE_ROW_COUNT) * 100).toFixed(1)
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
      process.stdout.write(
        `\r  read ${stats.read.toLocaleString()} (${pct}%) · ` +
          `kept ${(stats.fraudKept + stats.legitKept).toLocaleString()} ` +
          `(${stats.fraudKept.toLocaleString()} fraud) · ${elapsed}s   `,
      )
    }
  }

  await flush(transactions, labels)

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  const kept = stats.fraudKept + stats.legitKept
  const fraudRate = kept > 0 ? ((stats.fraudKept / kept) * 100).toFixed(3) : '0.000'

  console.log('\n')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  rows read           ${stats.read.toLocaleString()}`)
  console.log(`  rows sampled        ${kept.toLocaleString()}`)
  console.log(`  inserted            ${stats.inserted.toLocaleString()}`)
  console.log(`  skipped (existing)  ${stats.skipped.toLocaleString()}`)
  console.log(`  fraud labels        ${stats.labelsInserted.toLocaleString()}`)
  console.log('  ─────────────────────────────────────────────')
  console.log(`  fraud               ${stats.fraudKept.toLocaleString()}`)
  console.log(`  non-fraud           ${stats.legitKept.toLocaleString()}`)
  console.log(`  fraud rate          ${fraudRate}%`)
  console.log('  ─────────────────────────────────────────────')
  if (stats.malformed > 0) {
    console.log(`  malformed rows      ${stats.malformed.toLocaleString()} (skipped)`)
    for (const sample of malformedSamples) console.log(`    · ${sample}`)
    console.log('  ─────────────────────────────────────────────')
  }
  console.log(`  completed in ${elapsed}s\n`)
}

main()
  .catch((err) => {
    console.error(`\nSeed failed: ${err.message}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
