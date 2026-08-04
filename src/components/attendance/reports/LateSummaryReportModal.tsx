'use client'

import React, { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { X, Clock, Loader2, FileText, FileSpreadsheet, AlertCircle } from 'lucide-react'
import { fetchLateSummaryReport, LateSummaryRow } from '@/lib/attendance'
import { StatementSpec, buildLateSummaryReport, downloadLateSummaryExcel } from './generate'

const LateSummaryPreviewModal = dynamic(() => import('./LateSummaryPreviewModal'))

interface Props {
  onClose: () => void
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function firstOfMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function LateSummaryReportModal({ onClose }: Props) {
  const [startDate, setStartDate] = useState(firstOfMonthStr())
  const [endDate, setEndDate] = useState(todayStr())
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<LateSummaryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [busy, setBusy] = useState<'preview' | 'excel' | null>(null)

  const today = useMemo(() => todayStr(), [])
  const rangeInvalid = startDate > endDate

  const runReport = async () => {
    if (rangeInvalid) return
    setLoading(true)
    setError(null)
    setRows(null)
    try {
      const data = await fetchLateSummaryReport(startDate, endDate)
      setRows(data)
    } catch (e) {
      console.error('fetchLateSummaryReport failed:', e)
      setError('Could not load the report. Please try again.')
    }
    setLoading(false)
  }

  const openPreview = async () => {
    if (!rows) return
    setBusy('preview')
    try {
      const spec = await buildLateSummaryReport(rows, startDate, endDate)
      setPreview({ spec, title: 'Late Summary Report' })
    } catch (e) {
      console.error('buildLateSummaryReport failed:', e)
    }
    setBusy(null)
  }

  const exportExcel = () => {
    if (!rows) return
    setBusy('excel')
    try { downloadLateSummaryExcel(rows, startDate, endDate) } finally { setBusy(null) }
  }

  return (
    <>
      {typeof document !== 'undefined' && createPortal(
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 16 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
              <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Clock size={16} className="text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800 text-sm">Late Summary Report</p>
                <p className="text-[11px] text-slate-500">Preview or download late arrivals for a date range</p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">From</span>
                  <input
                    type="date"
                    value={startDate}
                    max={today}
                    onChange={e => { setStartDate(e.target.value); setRows(null) }}
                    className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-500"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">To</span>
                  <input
                    type="date"
                    value={endDate}
                    max={today}
                    onChange={e => { setEndDate(e.target.value); setRows(null) }}
                    className="mt-1 w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-slate-500"
                  />
                </label>
              </div>

              {rangeInvalid && (
                <p className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle size={12} /> "From" date must be before "To" date.
                </p>
              )}

              <button
                onClick={runReport}
                disabled={loading || rangeInvalid}
                className="w-full flex items-center justify-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? 'Loading…' : 'Generate Report'}
              </button>

              {error && <p className="text-xs text-red-600">{error}</p>}

              {rows && (
                <div className="border border-slate-200 bg-slate-50 rounded-xl p-3.5 space-y-3">
                  <p className="text-sm text-slate-700">
                    <span className="font-bold">{rows.length}</span> late arrival{rows.length === 1 ? '' : 's'} found
                    {rows.length > 0 && (
                      <> across <span className="font-semibold">{new Set(rows.map(r => r.staff_id)).size}</span> staff</>
                    )}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={openPreview}
                      disabled={busy !== null || rows.length === 0}
                      className="flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:border-slate-400 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <FileText size={13} /> {busy === 'preview' ? 'Opening…' : 'Preview PDF'}
                    </button>
                    <button
                      onClick={exportExcel}
                      disabled={busy !== null || rows.length === 0}
                      className="flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:border-slate-400 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <FileSpreadsheet size={13} /> {busy === 'excel' ? 'Saving…' : 'Download Excel'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>,
        document.body
      )}

      <AnimatePresence>
        {preview && (
          <LateSummaryPreviewModal spec={preview.spec} title={preview.title} onClose={() => setPreview(null)} />
        )}
      </AnimatePresence>
    </>
  )
}
