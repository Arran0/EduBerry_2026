'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import DailyQuoteCard from '@/components/home/DailyQuoteCard'

/**
 * Quote of the day for the smart board — the exact home-page style (author
 * portrait + cursive typing) that appears on load and then leaves, collapsing
 * its space just below the banner. Mirrors the home page's QuoteBanner.
 */
export default function SmartboardQuote() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    // Long enough for the typing animation to finish before it leaves.
    const t = setTimeout(() => setVisible(false), 9000)
    return () => clearTimeout(t)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
          transition={{ duration: 0.45, ease: 'easeInOut' }}
          className="overflow-hidden"
        >
          <div className="pt-1 pb-1">
            <DailyQuoteCard />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
