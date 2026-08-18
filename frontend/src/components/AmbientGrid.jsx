/**
 * Ambient surveillance backdrop.
 *
 * A drifting grid with a slow scan line, held at ~5% opacity so it reads as
 * texture rather than content. Pure CSS gradients animated on `transform` only,
 * so it composites on the GPU and never triggers layout — a canvas particle
 * field would cost far more for the same impression.
 *
 * Fixed and pointer-events-none: it sits behind everything and can never
 * intercept a click.
 */

export function AmbientGrid({ intensity = 1 }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Drifting grid. The tile is 44px, and the animation travels exactly one
          tile, so the loop is seamless. */}
      <div
        className="absolute inset-x-0 -top-[44px] bottom-0"
        style={{
          opacity: 0.05 * intensity,
          backgroundImage:
            'linear-gradient(var(--accent) 1px, transparent 1px), linear-gradient(90deg, var(--accent) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          animation: 'grid-drift 7s linear infinite',
          willChange: 'transform',
        }}
      />

      {/* Radial vignette pulls the eye to the centre and stops the grid from
          reaching the edges of the viewport. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, transparent 0%, var(--void) 78%)',
        }}
      />

      {/* Scan line. One faint band, one slow pass. */}
      <div
        className="absolute inset-x-0 h-[36vh]"
        style={{
          opacity: 0.55 * intensity,
          background:
            'linear-gradient(to bottom, transparent 0%, rgba(99,102,241,0.05) 45%, rgba(99,102,241,0.09) 50%, rgba(99,102,241,0.05) 55%, transparent 100%)',
          animation: 'sweep-line 13s linear infinite',
          willChange: 'transform',
        }}
      />
    </div>
  )
}
