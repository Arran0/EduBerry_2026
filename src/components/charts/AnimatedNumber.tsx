'use client'

import React, { useEffect, useRef, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

interface AnimatedNumberProps {
  value: number
  /** Formats each intermediate frame — e.g. fmtINR, or a rounded integer. */
  format?: (n: number) => string
  /** Seconds. */
  duration?: number
  /** Seconds before the first count starts (later changes run at once). */
  delay?: number
  className?: string
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-IN')

/**
 * A figure that counts to its value instead of appearing at it, and glides
 * from one value to the next when it changes — so a statistic swapping to a
 * different scope (hovering a fee head, say) reads as the number moving, not
 * as text being replaced.
 *
 * Frames are written straight to the DOM node rather than through state: a
 * re-render per frame across a dozen figures is exactly the churn the home
 * page works to avoid. React renders the starting text once and never touches
 * it again, so a re-render mid-count can't snap it back.
 */
export default function AnimatedNumber({
  value, format = defaultFormat, duration = 1.2, delay = 0, className,
}: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(reduceMotion ? value : 0)
  const first = useRef(true)
  const formatRef = useRef(format)
  formatRef.current = format
  const [initialText] = useState(() => format(reduceMotion ? value : 0))

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduceMotion) {
      el.textContent = formatRef.current(value)
      from.current = value
      return
    }
    const controls = animate(from.current, value, {
      duration: first.current ? duration : Math.min(duration, 0.6),
      delay: first.current ? delay : 0,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: v => {
        from.current = v
        el.textContent = formatRef.current(v)
      },
    })
    first.current = false
    return () => controls.stop()
  }, [value, duration, delay, reduceMotion])

  return <span ref={ref} className={className}>{initialText}</span>
}
