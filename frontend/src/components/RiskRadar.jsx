/**
 * Risk radar — amount against risk score, one glowing dot per transaction.
 *
 * The encoding is the argument for this view: fraud in this dataset is
 * characterised by large amounts scoring high, so the cases that matter land in
 * the top-right and are visible as a shape before a single row is read. A table
 * can only show that by sorting twice.
 *
 * Canvas rather than SVG or a charting library: 3,000 glowing, pulsing dots is
 * 3,000 DOM nodes with filters attached, which no browser enjoys. Canvas draws
 * the same frame in a few milliseconds and keeps the glow under our control.
 *
 * X is log-scaled because amounts span $0 to $10M — linear would pile 95% of
 * the data into the left edge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { RISK_META, formatMoney } from '../lib/format.js'

const PADDING = { top: 18, right: 18, bottom: 34, left: 46 }
const MIN_AMOUNT = 1 // log(0) is undefined; $0 transactions clamp to the axis floor

const RGB = {
  CLEAR: '52,211,153',
  SUSPICIOUS: '251,191,36',
  CRITICAL: '244,63,94',
}

export function RiskRadar({ points = [], onSelect, height = 460 }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const laidOutRef = useRef([])
  const rafRef = useRef()
  const reduceMotion = useReducedMotion()

  const [size, setSize] = useState({ width: 0, height })
  const [hovered, setHovered] = useState(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })

  // Amount extent drives the x scale; recomputed only when the data changes.
  const extent = useMemo(() => {
    if (points.length === 0) return { min: 1, max: 10 }
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      const a = Math.max(MIN_AMOUNT, p.amount)
      if (a < min) min = a
      if (a > max) max = a
    }
    return { min, max }
  }, [points])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [height])

  const project = useCallback(
    (point, width) => {
      const plotW = width - PADDING.left - PADDING.right
      const plotH = height - PADDING.top - PADDING.bottom
      const logMin = Math.log10(extent.min)
      const logMax = Math.log10(extent.max)
      const span = Math.max(0.0001, logMax - logMin)
      const tx = (Math.log10(Math.max(MIN_AMOUNT, point.amount)) - logMin) / span
      const ty = point.riskScore / 100
      return {
        x: PADDING.left + tx * plotW,
        y: PADDING.top + (1 - ty) * plotH,
      }
    },
    [extent, height],
  )

  // Draw loop. Runs continuously only while a critical pulse is animating;
  // otherwise it paints once per data or size change.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size.width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const laid = points.map((p) => ({
      ...p,
      ...project(p, size.width),
      // Radius by amount, square-rooted so a $10M dot is prominent without
      // swallowing the plot.
      r: 1.6 + Math.sqrt(Math.max(MIN_AMOUNT, p.amount) / extent.max) * 5.4,
    }))
    laidOutRef.current = laid

    const css = getComputedStyle(document.documentElement)
    const hairline = css.getPropertyValue('--hairline').trim()
    const dim = css.getPropertyValue('--text-dim').trim()

    const plotW = size.width - PADDING.left - PADDING.right
    const plotH = height - PADDING.top - PADDING.bottom

    function frame(time) {
      ctx.clearRect(0, 0, size.width, height)

      // Grid: risk bands, so the y axis is readable as CLEAR / SUSPICIOUS /
      // CRITICAL rather than bare numbers.
      for (const [score, label] of [[40, '40'], [75, '75']]) {
        const y = PADDING.top + (1 - score / 100) * plotH
        ctx.strokeStyle = hairline
        ctx.lineWidth = 1
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(PADDING.left, y)
        ctx.lineTo(size.width - PADDING.right, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = dim
        ctx.font = '10px "IBM Plex Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText(label, PADDING.left - 8, y + 3)
      }

      ctx.fillStyle = dim
      ctx.font = '10px "IBM Plex Mono", monospace'
      ctx.textAlign = 'right'
      ctx.fillText('100', PADDING.left - 8, PADDING.top + 4)
      ctx.fillText('0', PADDING.left - 8, PADDING.top + plotH + 3)

      // X ticks at decade boundaries — the natural marks for a log axis.
      ctx.textAlign = 'center'
      const decadeStart = Math.ceil(Math.log10(extent.min))
      const decadeEnd = Math.floor(Math.log10(extent.max))
      for (let d = decadeStart; d <= decadeEnd; d++) {
        const value = 10 ** d
        const { x } = project({ amount: value, riskScore: 0 }, size.width)
        if (x < PADDING.left || x > size.width - PADDING.right) continue
        ctx.strokeStyle = hairline
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.moveTo(x, PADDING.top)
        ctx.lineTo(x, PADDING.top + plotH)
        ctx.stroke()
        ctx.globalAlpha = 1
        const label = value >= 1e6 ? `$${value / 1e6}M` : value >= 1e3 ? `$${value / 1e3}K` : `$${value}`
        ctx.fillStyle = dim
        ctx.fillText(label, x, height - 12)
      }

      // Pulse phase for critical dots. One shared oscillator so every critical
      // dot breathes in step rather than shimmering independently.
      const pulse = reduceMotion ? 1 : 0.72 + 0.28 * Math.sin(time / 620)

      // Painted in risk order so critical dots land on top of the cloud.
      for (const level of ['CLEAR', 'SUSPICIOUS', 'CRITICAL']) {
        for (const p of laid) {
          if (p.riskLevel !== level) continue
          const rgb = RGB[level] ?? '99,102,241'
          const isCritical = level === 'CRITICAL'
          const alpha = isCritical ? pulse : level === 'SUSPICIOUS' ? 0.72 : 0.5

          if (isCritical) {
            ctx.shadowBlur = 12 * pulse
            ctx.shadowColor = `rgba(${rgb},0.9)`
          } else {
            ctx.shadowBlur = 0
          }

          ctx.fillStyle = `rgba(${rgb},${alpha})`
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.shadowBlur = 0

      // Hover ring.
      if (hovered) {
        ctx.strokeStyle = '#E8E9ED'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(hovered.x, hovered.y, hovered.r + 4, 0, Math.PI * 2)
        ctx.stroke()
      }

      if (!reduceMotion) rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [points, size, height, project, extent, hovered, reduceMotion])

  /** Nearest-point lookup. A linear scan of 3,000 points is well under a frame. */
  const findAt = useCallback((cx, cy) => {
    let best = null
    let bestDist = 14 ** 2
    for (const p of laidOutRef.current) {
      const dx = p.x - cx
      const dy = p.y - cy
      const d = dx * dx + dy * dy
      if (d < bestDist) {
        bestDist = d
        best = p
      }
    }
    return best
  }, [])

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        className="block w-full"
        style={{ height }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const found = findAt(e.clientX - rect.left, e.clientY - rect.top)
          setHovered(found)
          setPointer({ x: e.clientX, y: e.clientY })
          e.currentTarget.style.cursor = found ? 'pointer' : 'default'
        }}
        onMouseLeave={() => setHovered(null)}
        onClick={() => hovered && onSelect?.(hovered.id)}
      />

      <div className="num pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-dim">
        transaction amount (log scale)
      </div>
      <div
        className="num pointer-events-none absolute left-1 top-1/2 text-[10px] text-dim"
        style={{ transform: 'rotate(-90deg) translateX(-50%)', transformOrigin: 'left center' }}
      >
        risk score
      </div>

      {hovered && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[196px] rounded-card border border-hairline bg-surface p-3"
          style={{
            left: Math.min(pointer.x + 14, window.innerWidth - 212),
            top: Math.max(12, pointer.y - 96),
            boxShadow: `0 12px 40px -12px rgba(0,0,0,0.8), ${RISK_META[hovered.riskLevel]?.glow ?? ''}`,
          }}
        >
          <p className="num truncate text-[11px] text-dim">{hovered.txnId}</p>
          <p className="num mt-1 text-[15px] text-text">{formatMoney(hovered.amount)}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="label-caps text-dim">{hovered.txnType}</span>
            <span
              className="num text-[13px]"
              style={{ color: RISK_META[hovered.riskLevel]?.color }}
            >
              {hovered.riskScore}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
