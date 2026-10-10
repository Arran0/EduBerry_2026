'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
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

  // Typing animation — ~28 ms per character
  const [displayed, setDisplayed] = useState('')
  useEffect(() => {
    setDisplayed('')
    let i = 0
    const tick = () => {
      i++
      setDisplayed(fullText.slice(0, i))
      if (i < fullText.length) setTimeout(tick, 28)
    }
    const t = setTimeout(tick, 200) // small initial delay
    return () => clearTimeout(t)
  }, [fullText])

  return (
    // Wrapper paddingLeft = PR so the portrait's left half sits outside the pill
    <div className="relative md:max-w-[70ch]" style={{ paddingLeft: PR }}>

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

          {/* Handwritten Caveat font, typing character by character */}
          <p
            className="text-slate-800 leading-snug min-h-[1.3em]"
            style={{
              fontFamily: "'Caveat', cursive",
              fontWeight: 700,
              fontSize: '15px',
              textAlign: 'justify',
              textAlignLast: 'left',
              wordSpacing: '0.05em',
            }}
          >
            {displayed}
            {/* blinking cursor while typing */}
            {displayed.length < fullText.length && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, repeatType: 'reverse' }}
                style={{ fontFamily: 'monospace', marginLeft: 1 }}
              >|</motion.span>
            )}
          </p>

          <p className="text-[9px] md:text-[11px] text-slate-500 mt-[4px] font-semibold tracking-tight">
            — {quote.author}
          </p>

        </div>
      </div>
    </div>
  )
}
