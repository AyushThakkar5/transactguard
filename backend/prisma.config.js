// Prisma 7 configuration.
//
// As of Prisma 7 the datasource URL lives here rather than in schema.prisma.
// This file is read by the Prisma CLI only (migrate, db push, studio, seed) —
// the application itself connects through the PrismaPg driver adapter that
// src/config/db.js builds. Both read the same DATABASE_URL, so there is still a
// single source of truth.

import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    // Run by `npx prisma db seed` and automatically after `migrate reset`.
    seed: 'node prisma/seed.js',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
