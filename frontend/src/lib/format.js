/**
 * Display formatting. Everything numeric renders through here so the mono /
 * tabular-figures treatment is applied consistently.
 */

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const formatMoney = (value) => money.format(Number(value ?? 0))
export const formatCompactMoney = (value) => compactMoney.format(Number(value ?? 0))
export const formatCount = (value) => new Intl.NumberFormat('en-US').format(Number(value ?? 0))

export function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('en-GB', { hour12: false })
}

/**
 * "amount_anomaly" → "Amount anomaly".
 *
 * The scorer emits snake_case factor keys; the evidence ledger reads as prose,
 * so they are humanised at the display layer rather than in the API.
 */
export function humanizeFactor(key) {
  if (!key) return ''
  const words = String(key).replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Zero-padded ordinal for the ledger's rank column: 1 → "01". */
export const rank = (index) => String(index + 1).padStart(2, '0')

export const RISK_LEVELS = ['CLEAR', 'SUSPICIOUS', 'CRITICAL']

/** Glyph, colour and glow per risk level — colour is never the only signal. */
export const RISK_META = {
  CLEAR: {
    glyph: '\u25cf',
    label: 'Clear',
    color: 'var(--clear)',
    glow: 'var(--clear-glow)',
    rgb: '52,211,153',
  },
  SUSPICIOUS: {
    glyph: '\u25b2',
    label: 'Suspicious',
    color: 'var(--suspicious)',
    glow: 'var(--suspicious-glow)',
    rgb: '251,191,36',
  },
  CRITICAL: {
    glyph: '\u25a0',
    label: 'Critical',
    color: 'var(--critical)',
    glow: 'var(--critical-glow)',
    rgb: '244,63,94',
  },
}

export function riskFromScore(score) {
  if (score == null) return null
  if (score <= 40) return 'CLEAR'
  if (score <= 75) return 'SUSPICIOUS'
  return 'CRITICAL'
}
