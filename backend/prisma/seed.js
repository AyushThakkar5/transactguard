/**
 * Seed accounts.
 *
 * Run with `npm run db:seed`. Idempotent — upsert means re-running resets each
 * password rather than erroring on the unique email index.
 *
 * PRIVILEGED PASSWORDS COME FROM THE ENVIRONMENT. The admin and analyst
 * passwords are read from ADMIN_SEED_PASSWORD and ANALYST_SEED_PASSWORD so no
 * working credential for a write-capable account is ever committed. Locally
 * they fall back to the documented development values; in any deployed
 * environment the seed refuses to run without them, because a public repo plus
 * a predictable admin password is the whole vulnerability.
 *
 * The demo account is the deliberate exception: it is a read-only VIEWER whose
 * credentials are published on the login page by design. See src/config/demo.js.
 */

import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { DEMO_EMAIL, DEMO_NAME, DEMO_PASSWORD } from '../src/config/demo.js'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const SALT_ROUNDS = 12

/**
 * Read a seed password from the environment.
 *
 * There is deliberately NO fallback. A default here would be a working
 * credential for a write-capable account sitting in a public repository, and
 * "it is only for local development" stops being true the moment someone
 * deploys without reading the setup notes.
 */
function seedPassword(varName) {
  const value = process.env[varName]
  if (value && value.length >= 8) return value

  console.error(
    `\n  ${varName} is not set (or is shorter than 8 characters).\n\n` +
      '  Privileged seed passwords are never committed, so you choose them:\n\n' +
      `    echo '${varName}="$(openssl rand -base64 18)"' >> backend/.env\n\n` +
      '  Then run the seed again. The read-only demo account needs no such\n' +
      '  variable — its credentials are public by design.\n',
  )
  process.exit(1)
}

const DEMO_USERS = [
  {
    name: 'Admin User',
    email: 'admin@transactguard.com',
    password: seedPassword('ADMIN_SEED_PASSWORD'),
    role: 'ADMIN',
  },
  {
    name: 'Analyst User',
    email: 'analyst@transactguard.com',
    password: seedPassword('ANALYST_SEED_PASSWORD'),
    role: 'ANALYST',
  },
  {
    // PUBLIC DEMO ACCOUNT — credentials are published on the login page.
    //
    // Seeded as VIEWER on purpose. That role is read-only: RBAC already blocks
    // it from creating or deleting transactions, uploading CSVs, scoring,
    // retrying batch jobs, running the simulator, deciding cases and listing
    // users. Publishing these credentials therefore grants exactly the access a
    // reviewer is meant to have and nothing more.
    //
    // Abuse of the login endpoint itself is handled separately, by
    // src/middleware/demoAccountLimit.js.
    name: DEMO_NAME,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    role: 'VIEWER',
  },
]

async function main() {
  console.log('Seeding database...\n')

  for (const { name, email, password, role } of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

    const user = await prisma.user.upsert({
      where: { email },
      update: { name, passwordHash, role, isActive: true },
      create: { name, email, passwordHash, role },
      select: { id: true, email: true, role: true },
    })

    // The demo password is public by design; the others are not printed.
    const shown = role === 'VIEWER' ? password : '••••••••  (from environment)'
    console.log(`  ${user.role.padEnd(7)}  ${user.email.padEnd(30)}  ${shown}`)
  }

  console.log('\nSeed complete.')
}

main()
  .catch((err) => {
    console.error('\nSeed failed:', err.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
