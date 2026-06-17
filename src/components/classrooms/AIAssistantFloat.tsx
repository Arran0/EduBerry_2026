'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowUpRight } from 'lucide-react'

const MAX_CHARS = 2000

// ─── Brand logos ──────────────────────────────────────────────────────────────
// Perplexity: multiple sub-paths need fillRule="evenodd" so inner shapes
// render as cutouts rather than filling the entire bounding area solid.

function PerplexityIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M22.3977 7.0896l-4.9972-4.9965a.4673.4673 0 00-.6603 0L12 6.7428 8.2598 2.9931a.4673.4673 0 00-.6603 0L2.6023 7.0896a.4673.4673 0 000 .6603L6.352 11.5l-3.7497 4.7497v.001l-.0004.0003a.467.467 0 00.0004.6597l4.9972 4.9965a.4673.4673 0 00.6603 0L12 17.2572l3.7402 3.7494a.4673.4673 0 00.6603 0l4.9972-4.9965a.467.467 0 00.0004-.6597l-.0004-.0003v-.001L17.648 11.5l3.7497-3.7501a.4673.4673 0 000-.6603zM12 16.1272l-3.3744-3.3745H8.624v-2.505h2.0019a.4673.4673 0 000-.9345H8.624V7.8728L12 4.4984l3.376 3.3744v1.4696h-2.002a.4673.4673 0 000 .9345h2.002v2.505H15.374L12 16.1272zM7.6894 3.7428l3.0752 3.0754H7.6894V3.7428zm0 16.514v-3.0754h3.0752L7.6894 20.2568zM16.3106 20.2568l-3.0752-3.0754h3.0752v3.0754zm0-16.514v3.0754h-3.0752l3.0752-3.0754z"
      />
    </svg>
  )
}

function ChatGPTIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.019-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.4-.681zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function ClaudeIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H4.71a.79.79 0 0 1-.79-.79v-.048a.79.79 0 0 1 .79-.79h4.71l.08-.128-.08-.23-4.72-2.648a.79.79 0 0 1-.29-1.08l.025-.04a.79.79 0 0 1 1.08-.29l4.72 2.648.184-.13V9.3a.79.79 0 0 1 .79-.79h.048a.79.79 0 0 1 .79.79v4.71l.128.08.23-.08 2.648-4.72a.79.79 0 0 1 1.08-.29l.04.025a.79.79 0 0 1 .29 1.08l-2.648 4.72.08.23.128-.08h4.71a.79.79 0 0 1 .79.79v.048a.79.79 0 0 1-.79.79H15.29l-.08.128.08.23 2.648 4.72a.79.79 0 0 1-.29 1.08l-.04.025a.79.79 0 0 1-1.08-.29l-2.648-4.72-.23.08v4.71a.79.79 0 0 1-.79.79h-.048a.79.79 0 0 1-.79-.79v-4.71l-.23-.08-4.72 2.648a.79.79 0 0 1-1.08-.29l-.025-.04a.79.79 0 0 1 .29-1.08z" />
    </svg>
  )
}

// ─── Provider config ──────────────────────────────────────────────────────────

export interface AIProvider {
  id: string
  name: string
  buildUrl: (prompt: string) => string
  icon: React.ReactNode
}

export const AI_PROVIDERS: Record<string, AIProvider> = {
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    buildUrl: (p) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
    icon: <PerplexityIcon />,
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    buildUrl: (p) => `https://chat.openai.com/?q=${encodeURIComponent(p)}`,
    icon: <ChatGPTIcon />,
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    buildUrl: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}`,
    icon: <ClaudeIcon />,
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AIAssistantFloatProps {
  provider?: AIProvider
}

export default function AIAssistantFloat({
  provider = AI_PROVIDERS.perplexity,
}: AIAssistantFloatProps) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => textareaRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [open])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    if (val.length > MAX_CHARS) return
    setPrompt(val)
    if (error && val.trim()) setError(null)
  }

  const handleSubmit = () => {
    const trimmed = prompt.trim()
    if (!trimmed) { setError('Type a question first.'); return }
    setError(null)
    window.open(provider.buildUrl(trimmed), '_blank', 'noopener,noreferrer')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  if (!mounted) return null

  const charsLeft = MAX_CHARS - prompt.length
  const showCounter = charsLeft <= 200

  const content = (
    /*
     * Mobile:  left-3 right-3  → panel spans near full width
     * Desktop: left-auto right-6 → panel is right-anchored, 384px wide
     */
    <div className="fixed bottom-20 sm:bottom-6 left-3 right-3 sm:left-auto sm:right-6 z-[9999] flex flex-col items-end gap-2.5">

      {/* ── Search panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className="w-full sm:w-96 rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
          >
            {/* Textarea — no header, just the input */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={`Ask anything about this class…`}
              rows={2}
              className="w-full px-4 pt-4 pb-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none resize-none bg-white block"
              style={{ minHeight: '72px', maxHeight: '200px' }}
            />

            {/* Bottom bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
              <span className="text-[11px] leading-none">
                {error ? (
                  <span className="text-rose-500 font-medium">{error}</span>
                ) : showCounter ? (
                  <span className={charsLeft <= 0 ? 'text-rose-400' : 'text-slate-400'}>
                    {prompt.length}/{MAX_CHARS}
                  </span>
                ) : (
                  <span className="text-slate-400">Shift+Enter for new line</span>
                )}
              </span>
              <button
                onClick={handleSubmit}
                className="flex items-center gap-1 pl-2.5 pr-2 py-1.5 bg-slate-900 hover:bg-black text-white rounded-lg text-xs font-semibold transition-colors active:scale-95"
              >
                Search <ArrowUpRight size={13} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating button ── */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Close AI assistant' : `Ask ${provider.name}`}
        animate={open ? { scale: 1 } : {
          scale: [1, 1.06, 1],
          boxShadow: [
            '0 4px 16px rgba(0,0,0,0.22)',
            '0 8px 28px rgba(0,0,0,0.38)',
            '0 4px 16px rgba(0,0,0,0.22)',
          ],
        }}
        transition={open ? {} : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.92 }}
        className="w-14 h-14 rounded-full bg-slate-900 hover:bg-black text-white flex items-center justify-center shadow-xl flex-shrink-0 transition-colors"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="x"
              initial={{ rotate: -80, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 80, opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <X size={20} />
            </motion.span>
          ) : (
            <motion.span
              key="logo"
              initial={{ rotate: 80, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -80, opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {provider.icon}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  )

  return createPortal(content, document.body)
}
