/**
 * Redis pub/sub subscriber — runs in the Express process only.
 *
 * The other half of the bridge: takes what the worker (or the simulator)
 * published and re-emits it over Socket.IO to the room that asked for it.
 *
 * If several API instances run behind a load balancer, each subscribes and
 * serves its own connected clients, which is exactly the behaviour wanted —
 * Redis fans the message out, Socket.IO delivers it locally.
 */

import IORedis from 'ioredis'
import { env } from '../config/env.js'
import { moduleLogger } from '../utils/logger.js'
import { FEED_CHANNEL, EVENTS, JOB_CHANNEL_PATTERN } from './publisher.js'
import { FEED_ROOM, jobRoom } from '../config/socket.js'

const log = moduleLogger('realtime:sub')

let subscriber = null

function handleMessage(io, channel, raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch (err) {
    log.warn({ channel, err: err.message }, 'Discarded unparseable realtime message')
    return
  }

  const { event, data } = message
  if (!event || !data) {
    log.warn({ channel }, 'Discarded realtime message with no event/data')
    return
  }

  switch (event) {
    case EVENTS.JOB_PROGRESS:
    case EVENTS.JOB_COMPLETED: {
      // Only the clients that asked about this job, never a global broadcast.
      const room = jobRoom(data.jobId)
      io.to(room).emit(event, data)
      log.debug({ event, room, jobId: data.jobId }, 'Relayed job event')
      break
    }

    case EVENTS.FEED_PREDICTION: {
      io.to(FEED_ROOM).emit(event, data)
      log.debug({ event, txnId: data.txnId }, 'Relayed feed event')
      break
    }

    default:
      log.warn({ event, channel }, 'Unknown realtime event, ignored')
  }
}

/**
 * Open the subscription and start relaying.
 *
 * A Redis connection in subscribe mode cannot issue ordinary commands, so this
 * connection is necessarily separate from every other client in the process.
 *
 * @param {import('socket.io').Server} io
 */
export async function startSubscriber(io) {
  if (subscriber) return subscriber

  subscriber = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })

  subscriber.on('error', (err) => log.error({ err: err.message }, 'Realtime subscriber error'))
  // ioredis resubscribes automatically after a reconnect, so a Redis restart
  // costs the events sent while it was down but nothing after.
  subscriber.on('ready', () => log.info('Realtime subscriber connected'))

  // Pattern subscription covers every job without having to subscribe and
  // unsubscribe as jobs come and go.
  await subscriber.psubscribe(JOB_CHANNEL_PATTERN)
  await subscriber.subscribe(FEED_CHANNEL)

  subscriber.on('pmessage', (_pattern, channel, raw) => handleMessage(io, channel, raw))
  subscriber.on('message', (channel, raw) => handleMessage(io, channel, raw))

  log.info(
    { patterns: [JOB_CHANNEL_PATTERN], channels: [FEED_CHANNEL] },
    'Realtime subscriber listening',
  )

  return subscriber
}

export async function stopSubscriber() {
  if (subscriber) {
    await subscriber.quit().catch(() => {})
    subscriber = null
    log.info('Realtime subscriber closed')
  }
}
