'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Quote } from 'lucide-react'

const QUOTES: { text: string; author: string }[] = [
  { text: 'The beautiful thing about learning is that no one can take it away from you.', author: 'B.B. King' },
  { text: 'Education is the most powerful weapon which you can use to change the world.', author: 'Nelson Mandela' },
  { text: 'The roots of education are bitter, but the fruit is sweet.', author: 'Aristotle' },
  { text: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', author: 'Mahatma Gandhi' },
  { text: 'Tell me and I forget. Teach me and I remember. Involve me and I learn.', author: 'Benjamin Franklin' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Success is the sum of small efforts repeated day in and day out.', author: 'Robert Collier' },
  { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
  { text: 'A little progress each day adds up to big results.', author: 'Satya Nani' },
  { text: 'Believe you can and you’re halfway there.', author: 'Theodore Roosevelt' },
]

const VISIBLE_MS = 11000 // how long a quote stays on screen
const GAP_MS = 900       // pause between one leaving and the next appearing

/**
 * Quote of the day that appears, lingers, then leaves — cycling through a small
 * set of inspirational lines just below the smart board banner.
 */
export default function SmartboardQuote() {
  // Start the rotation at a quote keyed to today's date so it feels like a
  // "quote of the day" rather than a random pick each refresh.
  const startIndex = new Date().getDate() % QUOTES.length
  const [index, setIndex] = useState(startIndex)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => setVisible(false), VISIBLE_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setIndex(i => (i + 1) % QUOTES.length)
      setVisible(true)
    }, GAP_MS)
    return () => clearTimeout(t)
  }, [visible])

  const quote = QUOTES[index]

  return (
    <div className="min-h-[2.5rem]">
      <AnimatePresence mode="wait">
        {visible && (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="flex items-start gap-2.5 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-violet-50/60 px-4 py-2.5"
          >
            <Quote size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-600 italic leading-snug">
              “{quote.text}”
              <span className="not-italic font-semibold text-slate-500"> — {quote.author}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
