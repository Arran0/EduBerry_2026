'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { getDailyQuote } from '@/lib/quotes'

// Portrait radius / diameter in px. The portrait circle is positioned so its
// centre sits exactly on the stadium's left edge — left half outside the card,
// right half inside the left semicircle cap.
const PR = 26 // radius
const PD = PR * 2 // diameter = 52 px

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

  return (
    /*
     * Layout:
     *   Wrapper has paddingLeft = PR so the stadium starts PR px from the
     *   wrapper's left edge. The portrait (absolute, left: 0, width: PD) has its
     *   LEFT edge at x=0 and its CENTRE at x=PR — exactly on the stadium's left
     *   edge. Left half of the circle is in the wrapper's padding area (visible,
     *   outside the stadium); right half is inside the stadium's left semicircle.
     *   The stadium's overflow:hidden does not clip the absolute portrait because
     *   they are siblings, not parent–child.
     */
    <div className="relative" style={{ paddingLeft: PR }}>

      {/* Circle portrait — centre on the stadium's left edge */}
      <div
        className="absolute z-10 rounded-full overflow-hidden grayscale border-[2.5px] border-white shadow-lg"
        style={{ width: PD, height: PD, left: 0, top: '50%', transform: `translateY(-${PR}px)` }}
      >
        <AuthorPortrait wiki={quote.wiki} author={quote.author} />
      </div>

      {/* Stadium */}
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

          <p className="text-[7px] font-black uppercase tracking-[0.14em] text-slate-400 mb-[3px]">
            Quote of the day
          </p>

          {/* Bold italic serif, fully justified across the container width */}
          <p
            className="text-[12px] text-slate-800 leading-snug"
            style={{
              fontFamily: 'Georgia, Cambria, "Times New Roman", serif',
              fontStyle: 'italic',
              fontWeight: 700,
              textAlign: 'justify',
              textAlignLast: 'left',
              hyphens: 'auto',
              wordSpacing: '0.04em',
            }}
          >
            &ldquo;{quote.text}&rdquo;
          </p>

          <p className="text-[9px] text-slate-500 mt-[4px] font-semibold tracking-tight">
            — {quote.author}
          </p>

        </div>
      </div>

    </div>
  )
}
