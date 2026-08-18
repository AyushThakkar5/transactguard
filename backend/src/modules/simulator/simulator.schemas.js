/**
 * Zod schemas for the simulator module.
 *
 * A fourth file beyond the three the step listed, kept for consistency with
 * every other module: routes wire, controllers handle req/res, services hold
 * logic, schemas hold validation. Putting these two objects in routes.js would
 * have been the only place in the codebase where that separation breaks.
 */

import { z } from 'zod'
import { DEFAULT_COUNT, DEFAULT_TPS, MAX_COUNT, MAX_TPS, MIN_TPS } from './simulator.service.js'

export const startSimulatorSchema = z
  .object({
    /**
     * A rate, not a delay: 3 means three transactions per second (one every
     * ~333ms).
     */
    transactionsPerSecond: z.coerce
      .number()
      .int()
      .min(MIN_TPS, `Must be at least ${MIN_TPS} transaction per second`)
      .max(MAX_TPS, `Must be at most ${MAX_TPS} transactions per second`)
      .default(DEFAULT_TPS),

    count: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_COUNT, `A run can replay at most ${MAX_COUNT} transactions`)
      .default(DEFAULT_COUNT),
  })
  .strict()

export const stopSimulatorSchema = z
  .object({
    simulatorRunId: z.uuid('simulatorRunId must be a UUID'),
  })
  .strict()
