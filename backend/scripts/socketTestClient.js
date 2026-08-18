#!/usr/bin/env node
/**
 * Socket.IO test client — stands in for the frontend until Step 9.
 *
 *   node scripts/socketTestClient.js --feed
 *   node scripts/socketTestClient.js --job <batchJobId>
 *   node scripts/socketTestClient.js --feed --job <batchJobId>
 *   node scripts/socketTestClient.js --bad-token     # expect a rejected handshake
 *   node scripts/socketTestClient.js --no-token      # expect a rejected handshake
 *
 * Options:
 *   --email / --password   which account to log in as (defaults to the demo admin)
 *   --url                  API base URL (default http://localhost:4000)
 *   --exit-after <n>       disconnect after n seconds (default: run until Ctrl-C)
 *
 * Logs in over REST, opens a socket with the resulting access token, joins the
 * requested rooms and prints every event as it arrives.
 */

import { io } from 'socket.io-client'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const BASE_URL = value('url', 'http://localhost:4000')
const EMAIL = value('email', process.env.TG_EMAIL ?? 'admin@transactguard.com')
// No default: pass --password, or set TG_PASSWORD in your shell.
const PASSWORD = value('password', process.env.TG_PASSWORD ?? '')
const JOB_ID = value('job', null)
const WANT_FEED = flag('feed')
const EXIT_AFTER = Number(value('exit-after', 0))

const stamp = () => new Date().toISOString().slice(11, 23)
const log = (...parts) => console.log(`[${stamp()}]`, ...parts)

async function login() {
  if (!PASSWORD) {
    throw new Error(
      'No password supplied. Pass --password <value>, or export TG_PASSWORD in your shell.',
    )
  }
  const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const body = await res.json()
  if (!res.ok) {
    throw new Error(`Login failed (HTTP ${res.status}): ${JSON.stringify(body)}`)
  }
  return body.data.tokens.accessToken
}

async function resolveToken() {
  if (flag('no-token')) {
    log('connecting with NO token (expecting rejection)')
    return undefined
  }
  if (flag('bad-token')) {
    log('connecting with an INVALID token (expecting rejection)')
    return 'not.a.real.jwt'
  }
  const token = await login()
  log(`logged in as ${EMAIL}`)
  return token
}

const token = await resolveToken()

const socket = io(BASE_URL, {
  // The handshake `auth` payload — not a query string, which would leak the
  // token into proxy logs and browser history.
  auth: token ? { token } : {},
  transports: ['websocket'],
  reconnection: false,
})

let eventCount = 0

socket.on('connect', () => log(`connected  socket=${socket.id}`))

socket.on('connected', (payload) => {
  log('server ack:', JSON.stringify(payload))

  if (JOB_ID) {
    socket.emit('subscribe:job', { jobId: JOB_ID }, (ack) =>
      log(`subscribe:job ${JOB_ID} ->`, JSON.stringify(ack)),
    )
  }
  if (WANT_FEED) {
    socket.emit('subscribe:feed', {}, (ack) => log('subscribe:feed ->', JSON.stringify(ack)))
  }
  if (!JOB_ID && !WANT_FEED) {
    log('no rooms requested — pass --job <id> and/or --feed')
  }
})

socket.on('job:progress', (data) => {
  eventCount++
  const pct = data.totalTxns ? Math.round(((data.processedCount + data.failedCount) / data.totalTxns) * 100) : 0
  log(
    `job:progress   ${data.processedCount}/${data.totalTxns} ` +
      `failed=${data.failedCount} status=${data.status} (${pct}%)`,
  )
})

socket.on('job:completed', (data) => {
  eventCount++
  log(
    `job:completed  status=${data.status} ` +
      `processed=${data.processedCount} failed=${data.failedCount}`,
  )
})

socket.on('feed:prediction', (data) => {
  eventCount++
  const amount = data.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  log(
    `feed:prediction #${eventCount}  ${data.txnId}  ${data.txnType.padEnd(8)} ` +
      `${amount.padStart(14)}  score=${String(data.riskScore).padStart(3)} ${data.riskLevel}`,
  )
})

socket.on('error:subscription', (err) => log('subscription error:', JSON.stringify(err)))

socket.on('connect_error', (err) => {
  log(`REJECTED: ${err.message}`)
  process.exit(flag('bad-token') || flag('no-token') ? 0 : 1)
})

socket.on('disconnect', (reason) => log(`disconnected (${reason})`))

if (EXIT_AFTER > 0) {
  setTimeout(() => {
    log(`exiting after ${EXIT_AFTER}s — ${eventCount} event(s) received`)
    socket.close()
    process.exit(0)
  }, EXIT_AFTER * 1000)
}

process.on('SIGINT', () => {
  log(`closing — ${eventCount} event(s) received`)
  socket.close()
  process.exit(0)
})
