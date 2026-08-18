/**
 * Prisma client singleton.
 *
 * Prisma 7 connects through a driver adapter rather than reading `url` from
 * schema.prisma, so the pg pool is constructed here from the validated env.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { env, isProduction } from './env.js'
import { moduleLogger } from '../utils/logger.js'

const log = moduleLogger('db')

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
})

export const prisma = new PrismaClient({
  adapter,
  log: isProduction
    ? [{ emit: 'event', level: 'error' }]
    : [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
})

prisma.$on('error', (e) => log.error({ target: e.target }, e.message))
if (!isProduction) {
  prisma.$on('warn', (e) => log.warn({ target: e.target }, e.message))
}

/** Round-trip a trivial query. Used by /api/v1/health. */
export async function pingDatabase() {
  await prisma.$queryRaw`SELECT 1`
  return true
}

export async function connectDatabase() {
  await prisma.$connect()
  log.info('PostgreSQL connected')
}

export async function disconnectDatabase() {
  await prisma.$disconnect()
  log.info('PostgreSQL disconnected')
}
