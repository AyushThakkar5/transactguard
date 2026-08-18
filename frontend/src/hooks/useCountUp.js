/**
 * Animated counter.
 *
 * Drives a number from 0 to its target on an ease-out curve using rAF, so the
 * value settles quickly and then creeps the last few units — which reads as a
 * readout locking on rather than a linear tick.
 *
 * Returns the target immediately when the viewer has asked for reduced motion,
 * or when the target is not a number.
 */

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

const easeOut = (t) => 1 - Math.pow(1 - t, 3)

export function useCountUp(target, { duration = 800, decimals = 0, enabled = true } = {}) {
  const reduceMotion = useReducedMotion()
  const numeric = Number(target)
  const valid = Number.isFinite(numeric)
  const [value, setValue] = useState(valid && (reduceMotion || !enabled) ? numeric : 0)
  const frame = useRef()

  useEffect(() => {
    if (!valid) return
    if (reduceMotion || !enabled) {
      setValue(numeric)
      return
    }

    const start = performance.now()
    const factor = 10 ** decimals

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      const next = numeric * easeOut(progress)
      setValue(Math.round(next * factor) / factor)
      if (progress < 1) frame.current = requestAnimationFrame(step)
    }

    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [numeric, valid, duration, decimals, reduceMotion, enabled])

  return valid ? value : target
}
