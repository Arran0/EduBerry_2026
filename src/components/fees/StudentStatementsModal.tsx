'use client'

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { X, ScrollText, FileSpreadsheet, AlertTriangle, BadgeCheck, CalendarRange } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { UserProfile } from '@/lib/supabase'
import { SchoolFee } from '@/lib/fees'
import {
  StatementSpec, buildTranscript, buildLedger, buildOutstanding, buildNoDue, buildAnnual, hasNoDue,
} from './statements/generate'

const StatementPreviewModal = dynamic(() => import('./statements/StatementPreviewModal'))

interface Props {
  student: UserProfile
  fees: SchoolFee[]
  year: string
  onClose: () => void
}

export default function StudentStatementsModal({ student, fees, year, onClose }: Props) {
  const [preview, setPreview] = useState<{ spec: StatementSpec; title: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const noDue = hasNoDue(fees)

  const openPreview = async (key: string, title: string, builder: () => Promise<StatementSpec>) => {
    setBusy(key)
    try { setPreview({ spec: await builder(), title }) }
    catch (e) { console.error('statement generation failed:', e) }
    setBusy(null)
  }

  const DOCS = [
    {
      key: 't', label: 'Transcript', icon: <ScrollText size={18} />,
      onClick: () => openPreview('t', `Fee Transcript · ${student.full_name}`, () => buildTranscript(student, year, fees)),
    },
    {
      key: 'l', label: 'Ledger', icon: <FileSpreadsheet size={18} />,
      onClick: () => openPreview('l', `Fee Ledger · ${student.full_name}`, () => buildLedger(student.id, student, year)),
    },
    {
      key: 'd', label: 'Dues', icon: <AlertTriangle size={18} />,
      onClick: () => openPreview('d', `Outstanding Dues · ${student.full_name}`, () => buildOutstanding(student, year, fees)),
    },
    {
      key: 'a', label: 'Annual', icon: <CalendarRange size={18} />,
      onClick: () => openPreview('a', `Annual Statement · ${student.full_name}`, () => buildAnnual(student, year, fees)),
    },
    {
      key: 'n', label: 'No-Due', icon: <BadgeCheck size={18} />, disabled: !noDue,
      title: noDue ? 'Preview No-Due Certificate' : 'Blocked — outstanding dues exist',
      onClick: () => openPreview('n', `No-Due Certificate · ${student.full_name}`, () => buildNoDue(student, year)),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E4E7]">
          <div className="flex items-center gap-3">
            <Avatar avatarUrl={student.avatar_url} name={student.full_name} size={36} userId={student.id} />
            <div>
              <p className="font-bold text-[#18181B] text-sm">{student.full_name}</p>
              <p className="text-[11px] text-[#71717A]">
                {student.grade != null
                  ? `Grade ${student.grade}${student.section ? ` ${student.section}` : ''}`
                  : 'Student'} · {year}
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
          <div className="grid grid-cols-3 gap-2">
            {DOCS.map(doc => (
              <button
                key={doc.key}
                onClick={doc.onClick}
                disabled={busy === doc.key || doc.disabled}
                title={doc.title}
                className={`flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl border text-xs font-semibold transition-all ${
                  doc.disabled
                    ? 'bg-[#FAFAFA] border-[#E4E4E7] text-[#C4C4C8] cursor-not-allowed'
                    : 'bg-white border-[#E4E4E7] text-[#27272A] hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm disabled:opacity-50'
                }`}
              >
                <span className={doc.disabled ? 'text-[#C4C4C8]' : 'text-[#A8896B]'}>{doc.icon}</span>
                {busy === doc.key ? '…' : doc.label}
              </button>
            ))}
          </div>
          {!noDue && (
            <p className="text-[11px] text-[#A1A1AA] mt-2.5">
              No-Due Certificate unlocks once all dues for {year} are cleared.
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
