'use client'

import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, ExternalLink, Sparkles, AlertCircle, Check, Copy } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export interface AIProvider {
  id: string
  label: string
  url: string
}

const DEFAULT_PROVIDERS: AIProvider[] = [
  {
    id: 'gemini',
    label: 'Continue with Gemini →',
    url: 'https://gemini.google.com/app',
  },
]

const MAX_CHARS = 2000

interface AIAssistantCardProps {
  placeholder?: string
  providers?: AIProvider[]
}

export default function AIAssistantCard({
  placeholder = 'Ask Gemini anything about this class...',
  providers = DEFAULT_PROVIDERS,
}: AIAssistantCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [copiedProviderId, setCopiedProviderId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    if (val.length > MAX_CHARS) return
    setPrompt(val)
    if (validationError && val.trim()) setValidationError(null)
  }

  const handleSubmit = async (provider: AIProvider) => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      setValidationError('Please enter a question before continuing.')
      return
    }
    setValidationError(null)

    // Copy prompt to clipboard so it's ready to paste in Gemini
    try {
      await navigator.clipboard.writeText(trimmed)
      setCopiedProviderId(provider.id)
      setTimeout(() => setCopiedProviderId(null), 4000)
    } catch {
      // clipboard denied — still open the tab
    }

    window.open(provider.url, '_blank', 'noopener,noreferrer')
  }

  const charsLeft = MAX_CHARS - prompt.length
  const nearLimit = charsLeft <= 100

  return (
    <section className="glass rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/60 transition-colors"
        aria-expanded={expanded}
      >
        <div className="p-1.5 bg-violet-100 rounded-lg flex-shrink-0">
          <Sparkles size={13} className="text-violet-600" />
        </div>
        <h2 className="font-semibold text-slate-700 text-sm flex-1 text-left">✨ Ask AI</h2>
        <span className="text-xs text-slate-400 font-normal mr-1 hidden sm:block">
          Ask Gemini about this class
        </span>
        <ChevronDown
          size={15}
          className={`text-slate-400 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-t border-slate-100"
          >
            <div className="p-4 space-y-3">
              {/* Textarea */}
              <div
                className={`relative bg-white border rounded-2xl focus-within:ring-2 transition-all ${
                  validationError
                    ? 'border-rose-300 focus-within:ring-rose-200'
                    : 'border-slate-200 focus-within:ring-violet-200 focus-within:border-violet-300'
                }`}
              >
                <textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={handleChange}
                  placeholder={placeholder}
                  rows={3}
                  className="w-full bg-transparent px-4 pt-3 pb-8 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none resize-none overflow-hidden"
                  style={{ minHeight: '96px' }}
                />
                <div
                  className={`absolute bottom-2 right-3 text-[11px] font-medium tabular-nums select-none transition-colors ${
                    nearLimit
                      ? charsLeft <= 0
                        ? 'text-rose-500'
                        : 'text-amber-500'
                      : 'text-slate-300'
                  }`}
                >
                  {prompt.length}/{MAX_CHARS}
                </div>
              </div>

              {/* Validation error */}
              <AnimatePresence>
                {validationError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-center gap-1.5 text-rose-600 text-xs font-medium"
                  >
                    <AlertCircle size={13} />
                    {validationError}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Provider buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {providers.map(provider => {
                  const copied = copiedProviderId === provider.id
                  return (
                    <button
                      key={provider.id}
                      onClick={() => handleSubmit(provider)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm hover:shadow-md active:scale-[0.98] ${
                        copied
                          ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                          : 'bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white'
                      }`}
                    >
                      {copied ? <Check size={13} /> : <ExternalLink size={13} />}
                      {copied ? 'Copied! Paste in Gemini (Ctrl+V)' : provider.label}
                    </button>
                  )
                })}
              </div>

              {/* Disclaimer */}
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Your prompt will be copied to your clipboard — just paste it when Gemini opens.
                You&apos;ll continue using your own Google account.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
