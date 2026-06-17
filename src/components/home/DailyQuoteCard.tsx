'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { getDailyQuote } from '@/lib/quotes'

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
    return (
      <img
        src={src}
        alt={author}
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    )
  }
  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white font-bold text-xl">
      {initials}
    </div>
  )
}

export default function DailyQuoteCard() {
  const quote = useMemo(() => getDailyQuote(), [])

  return (
    /*
     * Stadium shape: borderRadius: 9999px on a flex row container.
     * When width >> height, CSS caps each corner at height/2, producing
     * perfect semicircles on both ends — the classic stadium / discorectangle.
     * The left flex item is square (aspect-square + align-self:stretch via
     * default flex), so it exactly fills the left semicircle cap.
     */
    <div
      className="relative overflow-hidden border border-white/60 shadow-md"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.82) 0%, rgba(241,245,249,0.65) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: '9999px',
      }}
    >
      <div className="flex items-stretch">

        {/* Left semicircle — author portrait, square = card height */}
        <div className="flex-shrink-0 aspect-square overflow-hidden grayscale">
          <AuthorPortrait wiki={quote.wiki} author={quote.author} />
        </div>

        {/* Soft divider between portrait and text */}
        <div className="w-px flex-shrink-0 bg-white/50 self-stretch" />

        {/* Quote text */}
        <div className="flex-1 min-w-0 py-3 pl-4 pr-6 flex flex-col justify-center">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
            Quote of the day
          </p>
          <p
            className="text-sm text-slate-700 leading-relaxed text-justify hyphens-auto"
            style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", serif', fontStyle: 'italic' }}
          >
            &ldquo;{quote.text}&rdquo;
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5 font-semibold">
            — {quote.author}
          </p>
        </div>

      </div>
    </div>
  )
}
