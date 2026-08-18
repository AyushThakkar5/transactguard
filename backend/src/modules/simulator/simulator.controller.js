/**
 * HTTP layer for the simulator module.
 */

import * as simulatorService from './simulator.service.js'
import { sendSuccess } from '../../utils/response.js'

export async function start(req, res) {
  const run = await simulatorService.startSimulator(req.body, req.user)

  // 202: the run is scheduled and the first tick has not fired yet. Results
  // arrive over Socket.IO as `feed:prediction`, not in this response.
  return sendSuccess(res, { run }, 202)
}

export async function stop(req, res) {
  const run = simulatorService.stopSimulator(req.body)
  return sendSuccess(res, { message: 'Simulator stopped', run })
}

export async function status(_req, res) {
  return sendSuccess(res, simulatorService.getSimulatorStatus())
}
