'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Quote as QuoteIcon } from 'lucide-react'
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
        className="w-16 h-16 rounded-full object-cover grayscale border-2 border-white/60 flex-shrink-0 shadow-md"
      />
    )
  }
  return (
    <div className="w-16 h-16 rounded-full flex-shrink-0 bg-gradient-to-br from-slate-300 to-slate-400 grayscale flex items-center justify-center text-white font-bold text-base border-2 border-white/60 shadow-md">
      {initials}
    </div>
  )
}

export default function DailyQuoteCard() {
  const quote = useMemo(() => getDailyQuote(), [])

  return (
    <div className="relative rounded-2xl overflow-hidden backdrop-blur-sm bg-white/60 border border-white/70 shadow-sm">
      <QuoteIcon size={100} className="absolute -bottom-4 -right-3 text-slate-200/70 pointer-events-none" />
      <div className="relative flex items-start gap-5 p-5">
        <AuthorPortrait wiki={quote.wiki} author={quote.author} />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Quote of the day</p>
          <p className="text-sm text-slate-700 leading-relaxed font-medium">&ldquo;{quote.text}&rdquo;</p>
          <p className="text-xs text-slate-500 mt-2 font-semibold">— {quote.author}</p>
        </div>
      </div>
    </div>
  )
}
