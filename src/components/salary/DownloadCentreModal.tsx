'use client'

import React from 'react'
import { FileText, Landmark, ShieldCheck } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'

/** The cycle-statements picker, shared by the staff and driver pay cycle pages. */
export default function DownloadCentreModal({
  periodLabel, recordCount, busyKey, sharp, onClose, onRegister, onBankTransfer, onStatutory,
}: {
  periodLabel: string
  recordCount: number
  busyKey: string | null
  /** Square the panel and its tiles, for the sheets drawn with hard edges. */
  sharp?: boolean
  onClose: () => void
  onRegister: () => void
  onBankTransfer: () => void
  /** Opens the EPF/ESI filing set. Omitted where a cycle has no statutory returns of its own. */
  onStatutory?: () => void
}) {
  return (
    <ModalShell
      onClose={onClose}
      size="sm"
      sharp={sharp}
      title="Download Centre"
      subtitle={`${periodLabel} · ${recordCount} record${recordCount === 1 ? '' : 's'}`}
      icon={<FileText size={16} />}
      iconClassName={sharp ? 'bg-[#27272A] text-white' : 'bg-slate-800 text-white'}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Cycle statements</p>
      {/* Tailwind only emits classes it can find written out, so both column
          counts are spelled in full rather than assembled. */}
      <div className={`grid gap-2 ${onStatutory ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <button
          disabled={busyKey === 'register'}
          onClick={onRegister}
          className={`flex flex-col items-center justify-center gap-1.5 py-4 ${sharp ? '' : 'rounded-xl'} border border-slate-200 bg-white text-slate-800 hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all disabled:opacity-50`}
        >
          <FileText size={18} className="text-[#A8896B]" />
          <span className="text-xs font-semibold">{busyKey === 'register' ? 'Building…' : 'Salary Register'}</span>
        </button>
        <button
          disabled={busyKey === 'bank'}
          onClick={onBankTransfer}
          className={`flex flex-col items-center justify-center gap-1.5 py-4 ${sharp ? '' : 'rounded-xl'} border border-slate-200 bg-white text-slate-800 hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all disabled:opacity-50`}
        >
          <Landmark size={18} className="text-[#A8896B]" />
          <span className="text-xs font-semibold">{busyKey === 'bank' ? 'Building…' : 'Bank Transfer'}</span>
        </button>
        {onStatutory && (
          <button
            onClick={onStatutory}
            title="EPF ECR and ESI monthly contribution files for this cycle"
            className={`flex flex-col items-center justify-center gap-1.5 py-4 ${sharp ? '' : 'rounded-xl'} border border-slate-200 bg-white text-slate-800 hover:border-[#A8896B] hover:bg-[#FBFAF7] hover:-translate-y-0.5 shadow-sm transition-all`}
          >
            <ShieldCheck size={18} className="text-[#A8896B]" />
            <span className="text-xs font-semibold">EPF / ESI</span>
          </button>
        )}
      </div>
    </ModalShell>
  )
}
