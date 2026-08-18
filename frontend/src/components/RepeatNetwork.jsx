/**
 * Repeat participants graph.
 *
 * WHAT THIS SHOWS, precisely: accounts that appear in more than one flagged
 * transaction, and the transactions attached to them.
 *
 * WHAT IT IS NOT: a fraud-ring graph. PaySim generates independent
 * transactions — across ~62,000 accounts involved in SUSPICIOUS or CRITICAL
 * transactions, only 665 appear more than once, and zero flagged transactions
 * connect two of those. There are no rings, chains or communities in this data.
 * The topology is hub-and-spoke because that is genuinely all there is, and the
 * card says so rather than implying a structure the data does not contain.
 *
 * d3-force supplies the physics; the drawing is ours, so the glow, hub sizing
 * and highlight behave like the rest of the system.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force'
import { RISK_META, formatMoney } from '../lib/format.js'

const RGB = { CLEAR: '52,211,153', SUSPICIOUS: '251,191,36', CRITICAL: '244,63,94' }

export function RepeatNetwork({ data, onSelectEdge, height = 420 }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const simRef = useRef(null)
  const rafRef = useRef()
  const stateRef = useRef({ nodes: [], edges: [] })
  const reduceMotion = useReducedMotion()

  const [width, setWidth] = useState(0)
  const [hovered, setHovered] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })

  const maxAmount = useMemo(
    () => Math.max(...(data?.edges ?? []).map((e) => e.amount), 1),
    [data],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Build and run the simulation.
  useEffect(() => {
    if (!data || width === 0) return

    // d3-force mutates what it is given, so it gets copies — otherwise the
    // query cache would end up holding nodes with x/y/vx/vy bolted on.
    const nodes = data.nodes.map((n) => ({ ...n }))
    const edges = data.edges.map((e) => ({ ...e }))
    stateRef.current = { nodes, edges }

    const sim = forceSimulation(nodes)
      .force('link', forceLink(edges).id((d) => d.id).distance(46).strength(0.85))
      .force('charge', forceManyBody().strength(-120))
      .force('center', forceCenter(width / 2, height / 2))
      // Hubs get a larger collision radius so their spokes stay legible.
      .force('collide', forceCollide((d) => (d.hub ? 14 : 7)))
      // Gentle pull to centre keeps disconnected stars from drifting off-canvas
      // — with no inter-hub edges, nothing else holds the layout together.
      .force('x', forceX(width / 2).strength(0.04))
      .force('y', forceY(height / 2).strength(0.06))

    simRef.current = sim

    if (reduceMotion) {
      // Settle synchronously and paint once.
      sim.tick(220)
      sim.stop()
    }

    return () => sim.stop()
  }, [data, width, height, reduceMotion])

  // Draw loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    function draw(time) {
      const { nodes, edges } = stateRef.current
      ctx.clearRect(0, 0, width, height)

      const pulse = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(time / 700)
      const focus = selectedNode

      // Edges first, so nodes sit on top.
      for (const e of edges) {
        if (typeof e.source !== 'object' || typeof e.target !== 'object') continue
        const connected = !focus || e.source.id === focus || e.target.id === focus
        const rgb = RGB[e.riskLevel] ?? '99,102,241'
        const isHoveredEdge = hovered?.kind === 'edge' && hovered.id === e.id

        ctx.strokeStyle = `rgba(${rgb},${connected ? (isHoveredEdge ? 1 : 0.55) : 0.08})`
        // Thickness by amount — the money moving, not the count.
        ctx.lineWidth = 0.6 + Math.sqrt(e.amount / maxAmount) * 2.6
        ctx.shadowBlur = connected && e.riskLevel === 'CRITICAL' ? 8 : 0
        ctx.shadowColor = `rgba(${rgb},0.8)`
        ctx.beginPath()
        ctx.moveTo(e.source.x, e.source.y)
        ctx.lineTo(e.target.x, e.target.y)
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      for (const n of nodes) {
        const connected =
          !focus ||
          n.id === focus ||
          edges.some(
            (e) =>
              typeof e.source === 'object' &&
              ((e.source.id === focus && e.target.id === n.id) ||
                (e.target.id === focus && e.source.id === n.id)),
          )

        // Hubs scale with how many flagged transactions they touch.
        const r = n.hub ? 4 + n.degree * 1.9 : 2.6
        const alpha = connected ? 1 : 0.15
        const isSelected = n.id === focus
        const isHoveredNode = hovered?.kind === 'node' && hovered.id === n.id

        if (n.hub) {
          ctx.shadowBlur = (isSelected || isHoveredNode ? 20 : 11) * (n.degree >= 3 ? pulse : 1)
          ctx.shadowColor = `rgba(244,63,94,${alpha})`
          ctx.fillStyle = `rgba(244,63,94,${alpha})`
        } else {
          ctx.shadowBlur = 0
          ctx.fillStyle = `rgba(139,144,158,${alpha})`
        }

        ctx.beginPath()
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2)
        ctx.fill()

        if (isSelected) {
          ctx.shadowBlur = 0
          ctx.strokeStyle = '#E8E9ED'
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.arc(n.x, n.y, r + 4, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.shadowBlur = 0

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [width, height, hovered, selectedNode, maxAmount, reduceMotion])

  /** Hit-test nodes first, then edges — a node under the cursor wins. */
  const findAt = useCallback((cx, cy) => {
    const { nodes, edges } = stateRef.current

    for (const n of nodes) {
      const r = (n.hub ? 4 + n.degree * 1.9 : 2.6) + 4
      if ((n.x - cx) ** 2 + (n.y - cy) ** 2 <= r * r) {
        return { kind: 'node', id: n.id, node: n }
      }
    }

    for (const e of edges) {
      if (typeof e.source !== 'object') continue
      const { x: x1, y: y1 } = e.source
      const { x: x2, y: y2 } = e.target
      const dx = x2 - x1
      const dy = y2 - y1
      const lenSq = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lenSq))
      const px = x1 + t * dx
      const py = y1 + t * dy
      if ((px - cx) ** 2 + (py - cy) ** 2 <= 16) return { kind: 'edge', id: e.id, edge: e }
    }

    return null
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
        onClick={() => {
          if (!hovered) {
            setSelectedNode(null)
            return
          }
          if (hovered.kind === 'node') {
            setSelectedNode((prev) => (prev === hovered.id ? null : hovered.id))
          } else {
            onSelectEdge?.(hovered.edge)
          }
        }}
      />

      {hovered && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[212px] rounded-card border border-hairline bg-surface p-3"
          style={{
            left: Math.min(pointer.x + 14, window.innerWidth - 228),
            top: Math.max(12, pointer.y - 100),
            boxShadow: '0 12px 40px -12px rgba(0,0,0,0.8), var(--accent-glow)',
          }}
        >
          {hovered.kind === 'node' ? (
            <>
              <p className="label-caps text-dim">{hovered.node.hub ? 'Repeat account' : 'Counterparty'}</p>
              <p className="num mt-1 truncate text-[12.5px] text-text">{hovered.node.id}</p>
              {hovered.node.hub && (
                <p className="num mt-1.5 text-[11.5px] text-dim">
                  in <span style={{ color: 'var(--critical)' }}>{hovered.node.degree}</span> flagged
                  transactions
                </p>
              )}
            </>
          ) : (
            <>
              <p className="num truncate text-[11px] text-dim">{hovered.edge.txnId}</p>
              <p className="num mt-1 text-[14px] text-text">{formatMoney(hovered.edge.amount)}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="label-caps text-dim">{hovered.edge.txnType}</span>
                <span
                  className="num text-[13px]"
                  style={{ color: RISK_META[hovered.edge.riskLevel]?.color }}
                >
                  {hovered.edge.riskScore}
                </span>
              </div>
              <p className="mt-2 text-[10.5px] text-dim">Click to open detail</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
