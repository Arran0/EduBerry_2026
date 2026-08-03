'use client'

import React from 'react'
import { FileText, Landmark } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'

/** The cycle-statements picker, shared by the staff and driver pay cycle pages. */
export default function DownloadCentreModal({ periodLabel, recordCount, busyKey, onClose, onRegister, onBankTransfer }: {
  periodLabel: string
  recordCount: number
  busyKey: string | null
  onClose: () => void
  onRegister: () => void
  onBankTransfer: () => void
}) {
  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      title="Download Centre"
      subtitle={`${periodLabel} · ${recordCount} record${recordCount === 1 ? '' : 's'}`}
      icon={<FileText size={16} />}
      iconClassName="bg-slate-800 text-white"
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Cycle statements</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={busyKey === 'register'}
          onClick={onRegister}
          className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border border-slate-200 bg-white text-slate-800 hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all disabled:opacity-50"
        >
          <FileText size={18} className="text-[#A8896B]" />
          <span className="text-xs font-semibold">{busyKey === 'register' ? 'Building…' : 'Salary Register'}</span>
        </button>
        <button
          disabled={busyKey === 'bank'}
          onClick={onBankTransfer}
          className="flex flex-col items-center justify-center gap-1.5 py-4 rounded-xl border border-slate-200 bg-white text-slate-800 hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all disabled:opacity-50"
        >
          <Landmark size={18} className="text-[#A8896B]" />
          <span className="text-xs font-semibold">{busyKey === 'bank' ? 'Building…' : 'Bank Transfer'}</span>
        </button>
      </div>
    </ModalShell>
  )
}
