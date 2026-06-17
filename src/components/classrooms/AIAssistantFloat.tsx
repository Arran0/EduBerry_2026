'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowRight, AlertCircle } from 'lucide-react'

const MAX_CHARS = 2000

// ─── Brand logo SVGs ──────────────────────────────────────────────────────────

function ChatGPTIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.843-3.369 2.019-1.168a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.4-.681zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function PerplexityIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.3977 7.0896l-4.9972-4.9965a.4673.4673 0 00-.6603 0L12 6.7428 8.2598 2.9931a.4673.4673 0 00-.6603 0L2.6023 7.0896a.4673.4673 0 000 .6603L6.352 11.5l-3.7497 4.7497v.001l-.0004.0003a.467.467 0 00.0004.6597l4.9972 4.9965a.4673.4673 0 00.6603 0L12 17.2572l3.7402 3.7494a.4673.4673 0 00.6603 0l4.9972-4.9965a.467.467 0 00.0004-.6597l-.0004-.0003v-.001L17.648 11.5l3.7497-3.7501a.4673.4673 0 000-.6603zM12 16.1272l-3.3744-3.3745H8.624v-2.505h2.0019a.4673.4673 0 000-.9345H8.624V7.8728L12 4.4984l3.376 3.3744v1.4696h-2.002a.4673.4673 0 000 .9345h2.002v2.505H15.374L12 16.1272zM7.6894 3.7428l3.0752 3.0754H7.6894V3.7428zm0 16.514v-3.0754h3.0752L7.6894 20.2568zM16.3106 20.2568l-3.0752-3.0754h3.0752v3.0754zm0-16.514v3.0754h-3.0752l3.0752-3.0754z" />
    </svg>
  )
}

function ClaudeIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H4.71a.79.79 0 0 1-.79-.79v-.048a.79.79 0 0 1 .79-.79h4.71l.08-.128-.08-.23-4.72-2.648a.79.79 0 0 1-.29-1.08l.025-.04a.79.79 0 0 1 1.08-.29l4.72 2.648.184-.13V9.3a.79.79 0 0 1 .79-.79h.048a.79.79 0 0 1 .79.79v4.71l.128.08.23-.08 2.648-4.72a.79.79 0 0 1 1.08-.29l.04.025a.79.79 0 0 1 .29 1.08l-2.648 4.72.08.23.128-.08h4.71a.79.79 0 0 1 .79.79v.048a.79.79 0 0 1-.79.79H15.29l-.08.128.08.23 2.648 4.72a.79.79 0 0 1-.29 1.08l-.04.025a.79.79 0 0 1-1.08-.29l-2.648-4.72-.23.08v4.71a.79.79 0 0 1-.79.79h-.048a.79.79 0 0 1-.79-.79v-4.71l-.23-.08-4.72 2.648a.79.79 0 0 1-1.08-.29l-.025-.04a.79.79 0 0 1 .29-1.08z" />
    </svg>
  )
}

// ─── Provider definitions ─────────────────────────────────────────────────────

export interface AIProvider {
  id: string
  name: string
  buildUrl: (prompt: string) => string
  icon: React.ReactNode
  accent: string
  glow: string
}

export const AI_PROVIDERS: Record<string, AIProvider> = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    buildUrl: (p) => `https://chat.openai.com/?q=${encodeURIComponent(p)}`,
    icon: <ChatGPTIcon size={26} />,
    accent: '#10A37F',
    glow: 'rgba(16,163,127,0.45)',
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    buildUrl: (p) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
    icon: <PerplexityIcon size={24} />,
    accent: '#20B2AA',
    glow: 'rgba(32,178,170,0.45)',
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    buildUrl: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}`,
    icon: <ClaudeIcon size={24} />,
    accent: '#CC785C',
    glow: 'rgba(204,120,92,0.45)',
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
  const [validationError, setValidationError] = useState<string | null>(null)
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
    const timer = setTimeout(() => textareaRef.current?.focus(), 120)
    return () => clearTimeout(timer)
  }, [open])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    if (val.length > MAX_CHARS) return
    setPrompt(val)
    if (validationError && val.trim()) setValidationError(null)
  }

  const handleSubmit = () => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      setValidationError('Please type a question first.')
      return
    }
    setValidationError(null)
    window.open(provider.buildUrl(trimmed), '_blank', 'noopener,noreferrer')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!mounted) return null

  const charsLeft = MAX_CHARS - prompt.length

  const content = (
    <div className="fixed bottom-20 sm:bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
      {/* ── Prompt panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.88, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 16 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="w-80 sm:w-96 rounded-2xl overflow-hidden bg-white border border-slate-200/80"
            style={{ boxShadow: `0 24px 60px -8px ${provider.glow}, 0 8px 24px -4px rgba(0,0,0,0.14)` }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ background: `linear-gradient(135deg, ${provider.accent}, ${provider.accent}cc)` }}
            >
              <div className="text-white flex-shrink-0">{provider.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white leading-tight">Ask {provider.name}</p>
                <p className="text-[11px] text-white/65">Opens in a new tab</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="p-3 space-y-2.5 bg-white">
              {/* Textarea wrapper */}
              <div
                className={`relative rounded-xl border bg-slate-50 transition-all focus-within:ring-2 ${
                  validationError
                    ? 'border-rose-300 focus-within:ring-rose-100'
                    : 'border-slate-200 focus-within:ring-slate-200'
                }`}
              >
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder={`Ask ${provider.name} anything about this class…`}
                  rows={3}
                  className="w-full bg-transparent px-3 pt-2.5 pb-7 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none resize-none overflow-hidden"
                  style={{ minHeight: '88px', maxHeight: '220px' }}
                />
                <span
                  className={`absolute bottom-2 right-2.5 text-[10px] font-medium tabular-nums select-none transition-colors ${
                    charsLeft <= 0
                      ? 'text-rose-500'
                      : charsLeft <= 100
                      ? 'text-amber-500'
                      : 'text-slate-300'
                  }`}
                >
                  {prompt.length}/{MAX_CHARS}
                </span>
              </div>

              {/* Validation error */}
              <AnimatePresence>
                {validationError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                    className="flex items-center gap-1 text-rose-600 text-xs font-medium"
                  >
                    <AlertCircle size={12} /> {validationError}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-white text-sm font-semibold rounded-xl transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
                style={{ background: `linear-gradient(135deg, ${provider.accent}, ${provider.accent}ee)` }}
              >
                Ask {provider.name} <ArrowRight size={14} />
              </button>

              <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                You&apos;ll continue in {provider.name} using your own account.
                &nbsp;·&nbsp; Enter to submit · Shift+Enter for new line
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating button ── */}
      <motion.button
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Close AI assistant' : `Ask ${provider.name}`}
        animate={
          open
            ? { scale: 1 }
            : {
                y: [0, -6, 0],
                boxShadow: [
                  `0 4px 18px ${provider.glow}`,
                  `0 10px 32px ${provider.glow}`,
                  `0 4px 18px ${provider.glow}`,
                ],
              }
        }
        transition={
          open
            ? { duration: 0.2 }
            : { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
        }
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.92 }}
        className="w-14 h-14 rounded-full text-white flex items-center justify-center shadow-xl"
        style={{ background: `linear-gradient(135deg, ${provider.accent}, ${provider.accent}bb)` }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <X size={22} />
            </motion.span>
          ) : (
            <motion.span
              key="logo"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.18 }}
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
