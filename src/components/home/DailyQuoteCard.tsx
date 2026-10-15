'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { getDailyQuote } from '@/lib/quotes'

const PR = 26 // portrait radius px
const PD = PR * 2

function AuthorPortrait({ wiki, author }: { wiki: string; author: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSrc(null); setFailed(false)
    if (!wiki || wiki === 'Anonymous') { setFailed(true); return }
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wiki.replace(/ /g, '_'))}`
    fetch(url)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => {
        const thumb = j?.thumbnail?.source as string | undefined
        if (active && thumb) setSrc(thumb)
        else if (active) setFailed(true)
      })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [wiki])

  const initials = author.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()

  if (src && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={author} onError={() => setFailed(true)} className="w-full h-full object-cover" />
  }
  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white font-bold text-base">
      {initials}
    </div>
  )
}

export default function DailyQuoteCard() {
  const quote = useMemo(() => getDailyQuote(), [])
  const fullText = `“${quote.text}”`
  const reduceMotion = useReducedMotion()

  /* The typing effect, without the two things that made it expensive.

     It used to call setState once per character on a 28 ms timer: sixty-odd
     React renders of a component mounted inside the home page, every one of
     them landing in the window where the dashboard's own fetches are resolving
     and its cards are mounting. And because the <p> held only the text typed so
     far, the pill was a different height the moment a quote wrapped to a second
     line — a layout change in the row directly above the cards.

     Both go away by writing to the node instead of through state, and by
     sizing the paragraph with the *whole* quote from the first frame: the full
     text sits underneath at zero opacity reserving the space, and the visible
     copy is laid over it. The box is final-sized before a character appears,
     and React renders this component exactly once.

     Under reduced motion there is no typing at all — the quote is simply
     there. */
  const typedRef = useRef<HTMLSpanElement | null>(null)
  const cursorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const node = typedRef.current
    if (!node) return
    if (reduceMotion) {
      node.textContent = fullText
      if (cursorRef.current) cursorRef.current.style.display = 'none'
      return
    }

    node.textContent = ''
    let raf = 0
    let start = 0
    const MS_PER_CHAR = 28
    const DELAY = 200

    const step = (now: number) => {
      if (!start) start = now
      // Driven off elapsed time rather than a per-character timer, so a frame
      // the browser skips while the dashboard is mounting doesn't stretch the
      // animation out — it catches up on the next one.
      const chars = Math.floor(Math.max(0, now - start - DELAY) / MS_PER_CHAR)
      const next = fullText.slice(0, Math.min(chars, fullText.length))
      if (node.textContent !== next) node.textContent = next
      if (chars < fullText.length) {
        raf = requestAnimationFrame(step)
      } else if (cursorRef.current) {
        cursorRef.current.style.display = 'none'
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [fullText, reduceMotion])

  return (
    // Full width on a phone, 80% and centred from md: — the pill spans the
    // dashboard below it rather than sitting as a stub at its left edge.
    // Wrapper paddingLeft = PR so the portrait's left half sits outside the pill
    <div className="relative w-full md:w-[80%] md:mx-auto" style={{ paddingLeft: PR }}>

      {/* Circle portrait — centre on stadium left edge */}
      <div
        className="absolute z-10 rounded-full overflow-hidden grayscale border-[2.5px] border-white shadow-lg"
        style={{ width: PD, height: PD, left: 0, top: '50%', transform: `translateY(-${PR}px)` }}
      >
        <AuthorPortrait wiki={quote.wiki} author={quote.author} />
      </div>

      {/* Stadium pill */}
      <div
        className="overflow-hidden border border-white/55 shadow-sm"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.84) 0%, rgba(241,245,252,0.68) 100%)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          borderRadius: '9999px',
        }}
      >
        <div style={{ paddingTop: 7, paddingBottom: 7, paddingLeft: PR + 10, paddingRight: PR + 4 }}>

          <p className="text-[7px] md:text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 mb-[3px]">
            Quote of the day
          </p>

          {/* Handwritten Caveat font, typing character by character.
              The full quote sits in the flow at zero opacity so the paragraph
              is its final height from the first frame; the typed copy is laid
              over it. Without that the pill grew a line mid-animation and took
              the dashboard down with it. */}
          <p
            className="relative text-slate-800 leading-snug min-h-[1.3em] text-[15px] md:text-[18px]"
            style={{
              fontFamily: "'Caveat', cursive",
              fontWeight: 700,
              textAlign: 'justify',
              textAlignLast: 'left',
              wordSpacing: '0.05em',
            }}
          >
            <span aria-hidden="true" className="invisible">{fullText}</span>
            <span className="absolute inset-0">
              {/* The accessible copy is this one — a screen reader gets the
                  whole quote at once rather than a string that grows. */}
              <span ref={typedRef} aria-hidden="true" />
              <span className="sr-only">{fullText}</span>
              <span
                ref={cursorRef}
                aria-hidden="true"
                className="quote-caret"
                style={{ fontFamily: 'monospace', marginLeft: 1 }}
              >|</span>
            </span>
          </p>

          <p className="text-[9px] md:text-[11px] text-slate-500 mt-[4px] font-semibold tracking-tight">
            — {quote.author}
          </p>

        </div>
      </div>
    </div>
  )
}
