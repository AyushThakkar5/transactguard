/**
 * Country risk map.
 *
 * Paths are projected and drawn directly with d3-geo rather than going through
 * a map component library — the same call made for the gauge, and for the same
 * reason: the glow, pulse and hover treatment are the point, and a wrapper's
 * component API would sit between us and them.
 *
 * WHAT THE ENCODINGS MEAN, because this matters more than the visuals:
 *
 *   fill        transaction volume. Real and strong — a 10x spread across
 *               countries, so the choropleth carries genuine information.
 *   glow+pulse  the countries holding the most CRITICAL transactions. Also
 *               real: it is a count, and counts vary with volume.
 *   NOT encoded average risk score. It sits between 48.0 and 50.1 across every
 *               country because geography is assigned independently of the
 *               fraud labels (see prisma/seedGeography.js). Colouring by it
 *               would imply a geographic risk signal that does not exist, so it
 *               appears in the tooltip as a figure and nowhere as a visual
 *               weight.
 *
 * Countries too small to appear in the 110m atlas (Singapore, and any other
 * micro-state) are drawn as markers at their centroid rather than dropped.
 */

import { useMemo, useState } from 'react'
import { geoEqualEarth, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import worldAtlas from 'world-atlas/countries-110m.json'
import { formatCompactMoney, formatCount } from '../lib/format.js'

const WIDTH = 900
const HEIGHT = 440

/** ISO 3166-1 alpha-2 → numeric, for the codes the geography seed assigns. */
const ALPHA2_TO_NUMERIC = {
  US: '840', IN: '356', GB: '826', NG: '566', BR: '076', DE: '276',
  KE: '404', CN: '156', FR: '250', ZA: '710', MX: '484', ID: '360',
  PH: '608', AU: '036', CA: '124', JP: '392', PK: '586', EG: '818',
  TR: '792', AE: '784', RU: '643', SG: '702', ES: '724', IT: '380',
  VN: '704', TH: '764',
}

const NAMES = {
  US: 'United States', IN: 'India', GB: 'United Kingdom', NG: 'Nigeria',
  BR: 'Brazil', DE: 'Germany', KE: 'Kenya', CN: 'China', FR: 'France',
  ZA: 'South Africa', MX: 'Mexico', ID: 'Indonesia', PH: 'Philippines',
  AU: 'Australia', CA: 'Canada', JP: 'Japan', PK: 'Pakistan', EG: 'Egypt',
  TR: 'Türkiye', AE: 'United Arab Emirates', RU: 'Russia', SG: 'Singapore',
  ES: 'Spain', IT: 'Italy', VN: 'Vietnam', TH: 'Thailand',
}

/** Approximate centroids for anything the atlas omits at this resolution. */
const MICROSTATE_POINTS = { SG: [103.82, 1.35] }

export function GeoRiskMap({ data, onSelectCountry }) {
  const [hovered, setHovered] = useState(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })

  const { features, path, projection } = useMemo(() => {
    const collection = feature(worldAtlas, worldAtlas.objects.countries)
    const proj = geoEqualEarth().fitExtent(
      [
        [12, 12],
        [WIDTH - 12, HEIGHT - 12],
      ],
      collection,
    )
    return { features: collection.features, path: geoPath(proj), projection: proj }
  }, [])

  const { byNumeric, maxTransactions, criticalThreshold } = useMemo(() => {
    const countries = data?.countries ?? []
    const map = new Map()
    for (const country of countries) {
      const numeric = ALPHA2_TO_NUMERIC[country.code]
      if (numeric) map.set(String(Number(numeric)), country)
    }

    // "Hot" is the top quartile by critical count — a defined cut rather than a
    // magic number, so the pulse always marks a meaningful group.
    const criticals = countries.map((c) => c.critical).sort((a, b) => b - a)
    const cut = criticals[Math.max(0, Math.floor(criticals.length * 0.25) - 1)] ?? Infinity

    return {
      byNumeric: map,
      maxTransactions: Math.max(...countries.map((c) => c.transactions), 1),
      criticalThreshold: cut,
    }
  }, [data])

  /** Volume → fill. Square-rooted so mid-volume countries stay distinguishable. */
  const fillFor = (country) => {
    if (!country) return 'var(--surface-raised)'
    const t = Math.sqrt(country.transactions / maxTransactions)
    return `rgba(99,102,241,${(0.1 + t * 0.55).toFixed(3)})`
  }

  const isHot = (country) => country && country.critical >= criticalThreshold

  const hoveredData = hovered ? byNumeric.get(hovered) : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Transaction volume and critical count by country"
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <filter id="geo-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Graticule-ish frame so the map reads as an instrument, not a picture. */}
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="transparent" />

        {features.map((f) => {
          const id = String(Number(f.id))
          const country = byNumeric.get(id)
          const active = hovered === id
          const hot = isHot(country)

          return (
            <path
              key={f.id}
              d={path(f)}
              fill={active ? 'rgba(99,102,241,0.85)' : fillFor(country)}
              stroke={hot ? 'var(--critical)' : 'var(--hairline)'}
              strokeWidth={hot ? 0.9 : 0.5}
              filter={hot ? 'url(#geo-glow)' : undefined}
              className={hot ? 'breathe' : undefined}
              style={{
                transition: 'fill 200ms ease, stroke 200ms ease',
                cursor: country ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => {
                if (!country) return
                setHovered(id)
                setPointer({ x: e.clientX, y: e.clientY })
              }}
              onMouseMove={(e) => country && setPointer({ x: e.clientX, y: e.clientY })}
              onClick={() => country && onSelectCountry?.(country)}
            />
          )
        })}

        {/* Micro-states the atlas has no polygon for. */}
        {Object.entries(MICROSTATE_POINTS).map(([code, coords]) => {
          const country = (data?.countries ?? []).find((c) => c.code === code)
          if (!country) return null
          const [x, y] = projection(coords) ?? []
          if (x == null) return null
          const hot = isHot(country)
          return (
            <circle
              key={code}
              cx={x}
              cy={y}
              r="3.2"
              fill={hot ? 'var(--critical)' : 'var(--accent)'}
              filter="url(#geo-glow)"
              className={hot ? 'breathe' : undefined}
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                setHovered(String(Number(ALPHA2_TO_NUMERIC[code])))
                setPointer({ x: e.clientX, y: e.clientY })
              }}
              onClick={() => onSelectCountry?.(country)}
            />
          )
        })}
      </svg>

      {/* Tooltip. Fixed-positioned so it escapes the SVG's coordinate space. */}
      {hoveredData && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[210px] rounded-card border border-hairline bg-surface p-3"
          style={{
            left: Math.min(pointer.x + 14, window.innerWidth - 226),
            top: Math.max(12, pointer.y - 110),
            boxShadow: '0 12px 40px -12px rgba(0,0,0,0.8), var(--accent-glow)',
          }}
        >
          <p className="text-[13px] font-medium text-text">
            {NAMES[hoveredData.code] ?? hoveredData.code}
            <span className="num ml-1.5 text-[11px] text-dim">{hoveredData.code}</span>
          </p>
          <dl className="mt-2.5 flex flex-col gap-1.5">
            {[
              ['Transactions', formatCount(hoveredData.transactions)],
              ['Critical', formatCount(hoveredData.critical)],
              ['Critical rate', hoveredData.criticalRate != null ? `${hoveredData.criticalRate}%` : '—'],
              ['Avg score', hoveredData.averageScore ?? '—'],
              ['Value', formatCompactMoney(hoveredData.totalAmount)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-dim">{k}</dt>
                <dd className="num text-[11.5px] text-text">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

export { NAMES as COUNTRY_NAMES }
