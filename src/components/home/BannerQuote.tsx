'use client'

import React, { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { getDailyQuote } from '@/lib/quotes'

/**
 * The quote of the day as one line under the home greeting.
 *
 * It used to be a pill of its own below the banner — a whole row of the page
 * for a sentence, which then collapsed after seven seconds and dragged the
 * dashboard up with it. Here it rides in the banner's own space as the
 * greeting's subtitle: no row, no collapse, nothing below it moves. The words
 * drift in one after another once the banner has opened (`show`).
 */
export default function BannerQuote({ onDark, show }: { onDark: boolean; show: boolean }) {
  const quote = useMemo(() => getDailyQuote(), [])
  const reduceMotion = useReducedMotion()
  const words = useMemo(() => `“${quote.text}”`.split(' '), [quote.text])
  const ink = onDark ? 'text-white/90' : 'text-slate-700'
  const shadow = onDark ? { textShadow: '0 1px 4px rgba(0,0,0,0.45)' } : undefined

  return (
    <p
      className={`mt-1.5 max-w-3xl line-clamp-2 sm:line-clamp-1 leading-snug ${ink}`}
      style={shadow}
      title={`${quote.text} — ${quote.author}`}
    >
      <span className="sr-only">Quote of the day: {quote.text}, by {quote.author}.</span>
      <span aria-hidden="true" style={{ fontFamily: "'Caveat', cursive", fontWeight: 700 }} className="text-[16px] sm:text-[18px]">
        {words.map((w, i) => (
          <motion.span
            key={i}
            className="inline-block whitespace-pre"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={reduceMotion || show ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35, delay: 1.05 + i * 0.045, ease: 'easeOut' }}
          >
            {w}{i < words.length - 1 ? ' ' : ''}
          </motion.span>
        ))}
      </span>
      <motion.span
        aria-hidden="true"
        className={`ml-2 text-[11px] sm:text-xs font-semibold ${onDark ? 'text-white/75' : 'text-slate-500'}`}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={reduceMotion || show ? { opacity: 1 } : { opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4, delay: 1.1 + words.length * 0.045 }}
      >
        — {quote.author}
      </motion.span>
    </p>
  )
}
