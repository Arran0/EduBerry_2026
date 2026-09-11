'use client'

import React, { useState } from 'react'
import { motion, useIsPresent } from 'framer-motion'
import dynamic from 'next/dynamic'
import { X, Download, FileText } from 'lucide-react'
import { StatementSpec, downloadStatement } from './generate'

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then(m => ({ default: m.PDFViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <div className="spinner mb-3" />
        <p className="text-sm">Rendering preview…</p>
      </div>
    ),
  },
)

interface Props {
  spec: StatementSpec
  title: string
  onClose: () => void
  /** Square the panel and its chrome — used from the Salary Manager's sharp-edged
   *  Download Centre, so a preview doesn't read as a different product mid-flow. */
  sharp?: boolean
}

export default function StatementPreviewModal({ spec, title, onClose, sharp }: Props) {
  const [downloading, setDownloading] = useState(false)
  // This overlay covers the viewport, so it must stop intercepting clicks the
  // moment AnimatePresence marks it as leaving rather than when its fade ends.
  // See ModalShell for the same guard and why it matters.
  const isPresent = useIsPresent()

  const onDownload = async () => {
    setDownloading(true)
    try { await downloadStatement(spec) } catch (e) { console.error('download failed:', e) }
    setDownloading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 bg-black/60 backdrop-blur-sm"
      style={isPresent ? undefined : { pointerEvents: 'none' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`bg-white ${sharp ? 'rounded-t-lg sm:rounded-none' : 'rounded-t-3xl sm:rounded-2xl'} shadow-2xl w-full sm:max-w-3xl max-h-[92dvh] sm:h-[88vh] flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`p-1.5 bg-slate-100 ${sharp ? '' : 'rounded-lg'} flex-shrink-0`}><FileText size={16} className="text-slate-700" /></div>
            <h2 className="font-bold text-slate-800 truncate">{title}</h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onDownload} disabled={downloading}
              className={`flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold px-4 py-2 ${sharp ? '' : 'rounded-lg'} transition-colors disabled:opacity-50`}>
              <Download size={15} /> {downloading ? 'Saving…' : 'Download'}
            </button>
            <button onClick={onClose} className={`p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 ${sharp ? '' : 'rounded-lg'}`}>
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100 min-h-0">
          <PDFViewer showToolbar={false} style={{ width: '100%', height: '100%', border: 'none' }}>
            {spec.element}
          </PDFViewer>
        </div>
      </motion.div>
    </motion.div>
  )
}
