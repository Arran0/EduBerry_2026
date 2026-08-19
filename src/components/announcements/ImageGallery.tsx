'use client'

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Instagram-style image carousel.
 *
 * One frame at a time in a fixed 4:5-ish window, swipeable on touch via native
 * scroll-snap, arrows on hover for desktop, a count pill top-right and dots
 * underneath. Native scrolling does the dragging, so there is no gesture
 * library and momentum feels right on every platform.
 */

interface ImageGalleryProps {
  images: { url: string; name: string }[]
}

export default function ImageGallery({ images }: ImageGalleryProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)

  // Derive the active frame from scroll position — keeps the dots honest
  // whether the user swiped, clicked an arrow, or flung the track.
  const handleScroll = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const frame = el.clientWidth
    if (frame === 0) return
    setIndex(Math.round(el.scrollLeft / frame))
  }, [])

  const scrollTo = useCallback((i: number) => {
    const el = trackRef.current
    if (!el) return
    const clamped = Math.max(0, Math.min(images.length - 1, i))
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' })
  }, [images.length])

  // Keyboard access for the arrows when the gallery has focus
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollTo(index - 1) }
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollTo(index + 1) }
  }

  useEffect(() => { setIndex(0) }, [images.length])

  if (images.length === 0) return null

  // A lone image keeps its natural shape — cropping a single photo into a
  // carousel frame would be worse than showing it as it is.
  if (images.length === 1) {
    return (
      <a href={images[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[0].url}
          alt={images[0].name}
          className="w-auto max-w-full max-h-[300px] sm:max-h-[520px] rounded-2xl border border-slate-200/70"
        />
      </a>
    )
  }

  return (
    <div
      className="group/gal relative w-full max-w-full lg:max-w-[560px] select-none"
      onClick={e => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label={`Image gallery, ${images.length} images`}
    >
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory rounded-2xl border border-slate-200/70 bg-slate-100 gallery-track"
      >
        {images.map((img, i) => (
          <a
            key={i}
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative flex-none w-full snap-center aspect-[4/5] sm:aspect-[4/3]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.name}
              loading={i === 0 ? undefined : 'lazy'}
              className="absolute inset-0 w-full h-full object-cover"
            />
          </a>
        ))}
      </div>

      {/* Count pill */}
      <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full bg-slate-900/65 text-white text-[11px] font-bold tabular-nums backdrop-blur-sm pointer-events-none">
        {index + 1}/{images.length}
      </div>

      {/* Arrows — desktop affordance, revealed on hover */}
      {index > 0 && (
        <button
          type="button"
          onClick={() => scrollTo(index - 1)}
          aria-label="Previous image"
          className="hidden sm:flex absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-md opacity-0 group-hover/gal:opacity-100 focus:opacity-100 transition-opacity"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          type="button"
          onClick={() => scrollTo(index + 1)}
          aria-label="Next image"
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-md opacity-0 group-hover/gal:opacity-100 focus:opacity-100 transition-opacity"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* Dots */}
      <div className="flex items-center justify-center gap-1.5 mt-2">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Go to image ${i + 1}`}
            aria-current={i === index}
            className={`rounded-full transition-all ${
              i === index ? 'w-1.5 h-1.5 bg-indigo-500' : 'w-1.5 h-1.5 bg-slate-300 hover:bg-slate-400'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
