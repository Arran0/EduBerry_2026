'use client'

import React from 'react'
import { FileText, FileSpreadsheet, Landmark, ShieldCheck, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { SALARY_ICON, SX } from '@/components/salary/ui'

/** The cycle-statements picker, shared by the staff and driver pay cycle pages. */
export default function DownloadCentreModal({
  periodLabel, recordCount, busyKey, sharp, onClose, onRegister, onBankTransfer, onStatutory, onSalarySheet,
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
  /** Builds the department-wise Salary Sheet workbook for whichever staff the sheet's
   *  filters currently show. Omitted where a cycle has no such filterable roster. */
  onSalarySheet?: () => void
}) {
  const tiles = [
    { key: 'register', label: 'Salary register', sub: 'Everyone, one PDF', icon: FileText, onClick: onRegister },
    { key: 'bank', label: 'Bank transfer', sub: 'Account-wise PDF', icon: Landmark, onClick: onBankTransfer },
    ...(onSalarySheet ? [{ key: 'sheet', label: 'Salary sheet', sub: 'Excel, by department', icon: FileSpreadsheet, onClick: onSalarySheet }] : []),
    ...(onStatutory ? [{ key: 'statutory', label: 'EPF and ESI', sub: 'Monthly returns', icon: ShieldCheck, onClick: onStatutory }] : []),
  ]
  return (
    <ModalShell
      onClose={onClose}
      size="md"
      sharp={sharp ?? true}
      glass
      title="Downloads"
      subtitle={`${periodLabel} · ${recordCount} record${recordCount === 1 ? '' : 's'}`}
      icon={<FileText size={16} />}
      iconClassName={SALARY_ICON}
    >
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(t => {
          const Icon = t.icon
          const busy = busyKey === t.key
          return (
            <button key={t.key} type="button" disabled={busy} onClick={t.onClick} className={SX.tile}>
              {busy ? <Loader2 size={20} className="animate-spin text-[#8B6F47]" /> : <Icon size={20} className="text-[#8B6F47]" />}
              <span className="text-[13px] font-semibold text-slate-900 leading-snug">{busy ? 'Building…' : t.label}</span>
              <span className="text-[11.5px] text-slate-500 leading-snug">{t.sub}</span>
            </button>
          )
        })}
      </div>
    </ModalShell>
  )
}
