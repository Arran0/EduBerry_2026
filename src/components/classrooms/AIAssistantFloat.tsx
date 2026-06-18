'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

const MAX_CHARS = 2000
const PILL = 56 // closed circle size (px)

export interface AIProvider {
  id: string
  name: string
  buildUrl: (prompt: string) => string
}

export const AI_PROVIDERS: Record<string, AIProvider> = {
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    buildUrl: (p) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    buildUrl: (p) => `https://chat.openai.com/?q=${encodeURIComponent(p)}`,
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    buildUrl: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}`,
  },
}

interface AIAssistantFloatProps {
  provider?: AIProvider
  // Extra px above the default mobile baseline (80 px = above BottomNav).
  // Pass the compose-bar height when rendering on the Discussion tab so the
  // button clears both the BottomNav and the compose bar.
  mobileBottomOffset?: number
}

export default function AIAssistantFloat({
  provider = AI_PROVIDERS.perplexity,
  mobileBottomOffset = 0,
}: AIAssistantFloatProps) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [mounted, setMounted] = useState(false)
  const [openWidth, setOpenWidth] = useState(360)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Track keyboard height with direct DOM writes so the button and its expanded
  // panel always sit above the keyboard — same technique as the compose bar.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const mobileBase = 80 + mobileBottomOffset
    const update = () => {
      const el = containerRef.current
      if (!el || window.innerWidth >= 640) return
      const kh = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      el.style.bottom = kh > 0 ? `${kh + 8}px` : `${mobileBase}px`
    }
    // Apply immediately so there's no flash on first render
    if (typeof window !== 'undefined' && window.innerWidth < 640 && containerRef.current) {
      containerRef.current.style.bottom = `${mobileBase}px`
    }
    vv.addEventListener('resize', update)
    return () => vv.removeEventListener('resize', update)
  }, [mobileBottomOffset])

  // Compute expanded width: near-full-width on mobile, fixed on desktop
  useEffect(() => {
    const calc = () => setOpenWidth(window.innerWidth < 640 ? window.innerWidth - 24 : 360)
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  // Auto-grow textarea as user types
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt])

  // Focus textarea once the morph animation has had time to widen
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => textareaRef.current?.focus(), 230)
    return () => clearTimeout(t)
  }, [open])

  const submit = useCallback(() => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    window.open(provider.buildUrl(trimmed), '_blank', 'noopener,noreferrer')
  }, [prompt, provider])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  if (!mounted) return null

  const content = (
    <div ref={containerRef} className="fixed sm:bottom-6 right-3 sm:right-6 z-[9999]" style={{ bottom: `${80 + mobileBottomOffset}px` }}>
      {/*
        Single motion.div that morphs between circle and search bar.
        Right edge stays anchored; width grows leftward.
      */}
      <motion.div
        onClick={() => { if (!open) setOpen(true) }}
        animate={{
          width: open ? openWidth : PILL,
          borderRadius: open ? 18 : PILL / 2,
        }}
        transition={{
          width:        { type: 'spring', stiffness: 340, damping: 30 },
          borderRadius: { type: 'spring', stiffness: 340, damping: 30 },
        }}
        className="bg-[#0f172a] text-white overflow-hidden relative select-none"
        style={{
          minHeight: PILL,
          cursor: open ? 'default' : 'pointer',
          boxShadow: open
            ? '0 8px 36px rgba(0,0,0,0.45)'
            : '0 4px 20px rgba(0,0,0,0.32)',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>

          {/* ── Closed: pulsing Perplexity logo ── */}
          {!open && (
            <motion.div
              key="ai"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.14 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <motion.img
                src="https://cdn.brandfetch.io/idNdawywEZ/w/200/h/200/theme/dark/icon.jpeg?c=1bxid64Mup7aczewSAYMX&t=1754453551906"
                alt="Perplexity"
                width={30}
                height={30}
                animate={{ opacity: [0.75, 1, 0.75] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                className="rounded-full"
                draggable={false}
              />
            </motion.div>
          )}

          {/* ── Open: inline search bar ── */}
          {open && (
            <motion.div
              key="bar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, delay: 0.14 }}
              className="flex items-start gap-3 px-4 py-[15px]"
            >
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => {
                  if (e.target.value.length <= MAX_CHARS) setPrompt(e.target.value)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about this class…"
                rows={1}
                className="flex-1 bg-transparent text-white text-sm leading-relaxed placeholder:text-slate-500 focus:outline-none resize-none overflow-hidden"
                style={{ minHeight: '22px', maxHeight: '160px' }}
              />
              <button
                onClick={e => { e.stopPropagation(); setOpen(false) }}
                aria-label="Close"
                className="flex-shrink-0 mt-[3px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X size={14} />
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  )

  return createPortal(content, document.body)
}
