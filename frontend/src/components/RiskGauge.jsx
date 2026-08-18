/**
 * Risk gauge — the drawer centrepiece.
 *
 * A 240° dial graduated every 10 points, with the three risk bands drawn onto
 * the arc. On dark the active band and the needle glow in the band's colour via
 * an SVG blur filter, so the reading carries across the room before the number
 * is legible.
 *
 * Motion, on open, once:
 *   · the needle springs to its value and overshoots slightly before settling —
 *     an instrument snapping onto a reading, not a progress bar filling
 *   · the score counts up from zero, timed to land as the needle settles
 *   · a CRITICAL result keeps a slow breath on the glow radius afterwards
 *
 * All of it is skipped for anyone who has asked for reduced motion: the needle
 * is placed, the number is final, nothing pulses.
 */

import { motion, useReducedMotion } from 'framer-motion'
import { useId } from 'react'
import { RISK_META, riskFromScore } from '../lib/format.js'
import { useCountUp } from '../hooks/useCountUp.js'

const CX = 110
const CY = 118
const R = 86

const START_ANGLE = -120
const END_ANGLE = 120
const SWEEP = END_ANGLE - START_ANGLE

const BANDS = [
  { from: 0, to: 40, key: 'CLEAR' },
  { from: 40, to: 75, key: 'SUSPICIOUS' },
  { from: 75, to: 100, key: 'CRITICAL' },
]

const angleFor = (score) => START_ANGLE + (Math.min(100, Math.max(0, score)) / 100) * SWEEP

function polar(radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CX + radius * Math.sin(rad), y: CY - radius * Math.cos(rad) }
}

function arcPath(radius, fromDeg, toDeg) {
  const start = polar(radius, fromDeg)
  const end = polar(radius, toDeg)
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

function Ticks() {
  const marks = []
  for (let score = 0; score <= 100; score += 10) {
    const angle = angleFor(score)
    const terminal = score === 0 || score === 100
    const boundary = score === 40 || score === 80
    const length = terminal ? 11 : boundary ? 9 : 6
    const outer = polar(R - 5, angle)
    const inner = polar(R - 5 - length, angle)
    marks.push(
      <line
        key={score}
        x1={outer.x}
        y1={outer.y}
        x2={inner.x}
        y2={inner.y}
        stroke="var(--text)"
        strokeWidth={terminal ? 1.25 : 0.75}
        strokeOpacity={terminal ? 0.5 : 0.22}
        strokeLinecap="round"
      />,
    )
  }
  return <g aria-hidden="true">{marks}</g>
}

function Needle({ angle }) {
  const tip = polar(R - 9, angle)
  const baseLeft = polar(R - 34, angle - 2.6)
  const baseRight = polar(R - 34, angle + 2.6)
  const counterweight = polar(R - 40, angle)

  return (
    <g>
      <polygon
        points={`${tip.x},${tip.y} ${baseLeft.x},${baseLeft.y} ${baseRight.x},${baseRight.y}`}
        fill="var(--text)"
      />
      <circle cx={counterweight.x} cy={counterweight.y} r="2.4" fill="var(--text)" />
    </g>
  )
}

export function RiskGauge({ score, size = 240 }) {
  const reduceMotion = useReducedMotion()
  const filterId = useId()

  const level = riskFromScore(score)
  const meta = level ? RISK_META[level] : null
  const target = angleFor(score ?? 0)
  const isCritical = level === 'CRITICAL'

  // Timed to land as the needle settles, so the number stops moving at the same
  // moment the instrument does.
  const displayScore = useCountUp(score, { duration: 900, enabled: score != null })

  return (
    <div
      className="mx-auto"
      style={{ width: size }}
      role="img"
      aria-label={
        score == null
          ? 'No risk score available'
          : `Risk score ${score} out of 100, ${meta?.label ?? 'unknown'}`
      }
    >
      <svg viewBox="0 0 220 176" width={size} height={size * (176 / 220)}>
        <defs>
          {/* Blur-and-merge: the glow is the shape itself, blurred behind it. */}
          <filter id={`glow-${filterId}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`needle-glow-${filterId}`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <path
          d={arcPath(R, START_ANGLE, END_ANGLE)}
          fill="none"
          stroke="var(--hairline)"
          strokeWidth="7"
          strokeLinecap="round"
        />

        {/* Bands. The active one glows and sits at full strength; the other two
            stay dim so the reading is unambiguous. */}
        {BANDS.map((band) => {
          const active = band.key === level
          return (
            <path
              key={band.key}
              d={arcPath(R, angleFor(band.from), angleFor(band.to))}
              fill="none"
              stroke={RISK_META[band.key].color}
              strokeWidth="7"
              strokeOpacity={active ? 1 : 0.2}
              strokeLinecap="butt"
              filter={active ? `url(#glow-${filterId})` : undefined}
              className={active && isCritical && !reduceMotion ? 'breathe' : undefined}
            />
          )
        })}

        <Ticks />

        <text
          x={polar(R - 26, START_ANGLE).x}
          y={polar(R - 26, START_ANGLE).y + 4}
          textAnchor="middle"
          className="num"
          fontSize="9"
          fill="var(--text-dim)"
        >
          0
        </text>
        <text
          x={polar(R - 26, END_ANGLE).x}
          y={polar(R - 26, END_ANGLE).y + 4}
          textAnchor="middle"
          className="num"
          fontSize="9"
          fill="var(--text-dim)"
        >
          100
        </text>

        {score != null && (
          <motion.g
            initial={reduceMotion ? false : { rotate: START_ANGLE - target }}
            animate={{ rotate: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : // Low damping relative to stiffness is what produces the
                  // overshoot-and-settle rather than an asymptotic glide.
                  { type: 'spring', stiffness: 90, damping: 9.5, mass: 1.05 }
            }
            style={{ originX: `${CX}px`, originY: `${CY}px` }}
            filter={`url(#needle-glow-${filterId})`}
          >
            <Needle angle={target} />
          </motion.g>
        )}

        {/* The score. Fraunces appears here and on page titles, nowhere else. */}
        <text
          x={CX}
          y={CY - 4}
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontSize="46"
          fontWeight="500"
          fill="var(--text)"
          style={{
            fontVariantNumeric: 'tabular-nums',
            filter: meta ? `drop-shadow(0 0 14px ${meta.color}88)` : undefined,
          }}
        >
          {score == null ? '—' : displayScore}
        </text>

        <text
          x={CX}
          y={CY + 18}
          textAnchor="middle"
          fontFamily="var(--font-sans)"
          fontSize="9.5"
          fontWeight="500"
          letterSpacing="1.1"
          fill={meta?.color ?? 'var(--text-dim)'}
        >
          {(meta?.label ?? 'Unscored').toUpperCase()}
        </text>
      </svg>
    </div>
  )
}
