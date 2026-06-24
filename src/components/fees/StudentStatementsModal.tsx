'use client'

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { X, ScrollText, FileSpreadsheet, AlertTriangle, BadgeCheck, CalendarRange, Loader2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { SchoolFee, fetchFeesForStudent } from '@/lib/fees'
import {
  StatementSpec, buildTranscript, buildLedger, buildOutstanding, buildNoDue, buildAnnual, hasNoDue,
} from './statements/generate'

const StatementPreviewModal = dynamic(() => import('./statements/StatementPreviewModal'))

interface Props {
  student: UserProfile
  year: string
  onClose: () => void
}

export default function StudentStatementsModal({ student, year: yearProp, onClose }: Props) {
  // Snapshot the year at open time so toggling the parent year doesn't affect an open popup.
  const [capturedYear] = useState(yearProp)
  const [allFees, setAllFees] = useState<SchoolFee[]>([])
  const [loadingFees, setLoadingFees] = useState(true)
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setLoadingFees(true)
    fetchFeesForStudent(student.id).then(f => { setAllFees(f); setLoadingFees(false) })
  }, [student.id])

  const yearFees = allFees.filter(f => f.academic_year === capturedYear)
  const noDue = !loadingFees && hasNoDue(allFees)

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('statement generation failed:', e) }
    setBusy(null)
  }

  const DOCS = [
    {
      key: 't', label: 'Transcript', sub: capturedYear,
      icon: <ScrollText size={15} />,
      onClick: () => openPreview('t', `Fee Transcript · ${student.full_name}`, () => buildTranscript(student, capturedYear, yearFees)),
    },
    {
      key: 'l', label: 'Ledger', sub: 'All years',
      icon: <FileSpreadsheet size={15} />,
      onClick: () => openPreview('l', `Fee Ledger · ${student.full_name}`, () => buildLedger(student.id, student)),
    },
    {
      key: 'd', label: 'Dues', sub: 'All years',
      icon: <AlertTriangle size={15} />,
      onClick: () => openPreview('d', `Outstanding Dues · ${student.full_name}`, () => buildOutstanding(student, undefined, allFees)),
    },
    {
      key: 'a', label: 'Annual', sub: capturedYear,
      icon: <CalendarRange size={15} />,
      onClick: () => openPreview('a', `Annual Statement · ${student.full_name}`, () => buildAnnual(student, capturedYear, yearFees)),
    },
    {
      key: 'n', label: 'No-Due', sub: 'All years',
      icon: <BadgeCheck size={15} />, disabled: !noDue,
      title: noDue ? 'Preview No-Due Certificate' : 'Blocked — outstanding dues exist',
      onClick: () => openPreview('n', `No-Due Certificate · ${student.full_name}`, () => buildNoDue(student, capturedYear)),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3 mb-1 sm:hidden" />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7]">
          <div className="flex items-center gap-3">
            <Avatar avatarUrl={student.avatar_url} name={student.full_name} size={36} userId={student.id} />
            <div>
              <p className="font-bold text-[#18181B] text-sm">{student.full_name}</p>
              <p className="text-[11px] text-[#71717A]">
                {student.grade != null
                  ? `Grade ${student.grade}${student.section ? ` ${student.section}` : ''}`
                  : 'Student'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-[#A1A1AA] hover:text-[#27272A] hover:bg-[#F4F4F5] rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Statement buttons */}
        <div className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-3">Financial Statements</p>
          {loadingFees ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[#A1A1AA]">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {DOCS.map(doc => (
                <button
                  key={doc.key}
                  onClick={doc.onClick}
                  disabled={busy === doc.key || doc.disabled}
                  title={doc.title}
                  className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border transition-all ${
                    doc.disabled
                      ? 'bg-[#FAFAFA] border-[#E4E4E7] text-[#C4C4C8] cursor-not-allowed'
                      : 'bg-white border-[#E4E4E7] text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
                  }`}
                >
                  <span className={doc.disabled ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{doc.icon}</span>
                  <span className="text-[11px] font-semibold">{busy === doc.key ? '…' : doc.label}</span>
                  <span className={`text-[9px] font-normal leading-none ${doc.disabled ? 'text-[#D4D4D8]' : 'text-[#A1A1AA]'}`}>{doc.sub}</span>
                </button>
              ))}
            </div>
          )}
          {!loadingFees && !noDue && (
            <p className="text-[11px] text-[#A1A1AA] mt-2.5">
              No-Due unlocks once all dues across all years are cleared.
            </p>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {preview && (
          <StatementPreviewModal
            spec={preview.spec}
            title={preview.title}
            onClose={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
