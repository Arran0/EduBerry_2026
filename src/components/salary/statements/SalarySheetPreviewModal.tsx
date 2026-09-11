'use client'

import React, { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, Search } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { formatINR } from '@/components/bus/FeeCollectionSummary'
import { SalaryCycle, formatPeriod } from '@/lib/salary'
import { TeamMembership } from '@/lib/teams'
import {
  SalarySheetRow, SalarySheetCategory, CATEGORY_ORDER, CATEGORY_LABEL, downloadSalarySheet,
} from './salarySheetXlsx'

interface Props {
  cycle: SalaryCycle
  /** Every candidate row for this cycle — filtering here is this modal's own, separate
   *  from whatever the cycle sheet's own search/team toolbar currently shows. */
  rows: SalarySheetRow[]
  /** Departments/teams a teaching-staff row can belong to, for the department filter. */
  teams: TeamMembership[]
  onClose: () => void
}

/**
 * Salary Sheet — preview, filter, download.
 *
 * Filtering to one department, or to just the drivers or support staff, is
 * the point of a per-run export like this, so it happens here rather than by
 * asking the admin to first set up the cycle sheet's own toolbar. The table
 * below re-filters instantly (all client-side, no re-fetch) so the effect of
 * a filter is visible before committing to a download.
 */
export default function SalarySheetPreviewModal({ cycle, rows, teams, onClose }: Props) {
  const [categories, setCategories] = useState<Set<SalarySheetCategory>>(new Set(CATEGORY_ORDER))
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const period = formatPeriod(cycle.period_month, cycle.period_year)

  const categoryCounts = useMemo(() => {
    const counts: Record<SalarySheetCategory, number> = { teaching: 0, non_teaching: 0, driver: 0 }
    for (const r of rows) counts[r.category] += 1
    return counts
  }, [rows])

  /** Union of the rosters of every selected department/team; null when none are selected. */
  const teamMemberIds = useMemo(() => {
    if (teamIds.length === 0) return null
    const ids = new Set<string>()
    for (const t of teams) if (teamIds.includes(t.id)) for (const m of t.memberIds) ids.add(m)
    return ids
  }, [teamIds, teams])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (!categories.has(r.category)) return false
      if (teamMemberIds && !teamMemberIds.has(r.personId)) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, categories, teamMemberIds, search])

  const totalNet = useMemo(() => filtered.reduce((s, r) => s + r.net, 0), [filtered])

  const toggleCategory = (c: SalarySheetCategory) => {
    setMessage(null)
    setCategories(prev => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c); else next.add(c)
      return next
    })
  }

  const toggleTeam = (id: string) => {
    setMessage(null)
    setTeamIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const handleDownload = async () => {
    if (filtered.length === 0 || busy) return
    setBusy(true); setMessage(null)
    try {
      const { included, fileName } = await downloadSalarySheet(cycle, filtered)
      setMessage(`Downloaded ${included} record${included === 1 ? '' : 's'} to ${fileName}.`)
    } catch (e) {
      console.error('salary sheet generation failed:', e)
      setMessage('Could not build the Salary Sheet — please try again.')
    }
    setBusy(false)
  }

  const chip = (active: boolean) => `text-[11px] font-semibold px-2.5 py-1.5 border transition-colors ${
    active
      ? 'bg-[#27272A] border-[#27272A] text-white'
      : 'bg-white border-[#E4E4E7] text-[#71717A] hover:border-[#A1A1AA] hover:text-[#27272A]'
  }`

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      sharp
      title="Salary Sheet"
      subtitle={`${period} · ${filtered.length} of ${rows.length} record${rows.length === 1 ? '' : 's'}`}
      icon={<FileSpreadsheet size={16} />}
      iconClassName="bg-[#27272A] text-white"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#71717A]">
            {filtered.length} record{filtered.length === 1 ? '' : 's'} · {formatINR(totalNet)} net
          </p>
          <button onClick={handleDownload} disabled={busy || filtered.length === 0}
            className="flex items-center gap-1.5 bg-[#27272A] hover:bg-[#18181B] text-white text-sm font-semibold px-4 py-2 transition-colors disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {busy ? 'Building…' : 'Download'}
          </button>
        </div>
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-1.5">Categories</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CATEGORY_ORDER.filter(cat => categoryCounts[cat] > 0).map(cat => (
          <button key={cat} onClick={() => toggleCategory(cat)} className={chip(categories.has(cat))}>
            {CATEGORY_LABEL[cat]} ({categoryCounts[cat]})
          </button>
        ))}
      </div>

      {teams.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] mb-1.5">Department / team</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {teams.map(t => (
              <button key={t.id} onClick={() => toggleTeam(t.id)} className={chip(teamIds.includes(t.id))}>
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="relative mb-3">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1AA] pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="w-full bg-white border border-[#E4E4E7] pl-8 pr-3 py-2 text-xs text-[#27272A] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#27272A] transition-colors"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[#A1A1AA] text-center py-10">No staff match these filters.</p>
      ) : (
        <div className="overflow-x-auto border border-[#E4E4E7]">
          <table className="w-full text-[10px] tabular-nums">
            <thead>
              <tr className="bg-[#27272A] text-white">
                <th className="text-left font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">Name</th>
                <th className="text-left font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">Designation</th>
                <th className="text-left font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">Category</th>
                <th className="text-right font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">Salary</th>
                <th className="text-right font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">PF</th>
                <th className="text-right font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">ESI</th>
                <th className="text-right font-bold uppercase tracking-wide px-2 py-2 whitespace-nowrap">Net</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-[#F4F4F5] last:border-0">
                  <td className="px-2 py-1.5 text-[#18181B] font-semibold whitespace-nowrap">{r.name}</td>
                  <td className="px-2 py-1.5 text-[#52525B] whitespace-nowrap">{r.designation}</td>
                  <td className="px-2 py-1.5 text-[#52525B] whitespace-nowrap">{CATEGORY_LABEL[r.category]}</td>
                  <td className="px-2 py-1.5 text-right text-[#52525B] whitespace-nowrap">{formatINR(r.baseAmount)}</td>
                  <td className="px-2 py-1.5 text-right text-[#52525B] whitespace-nowrap">{r.pf ? formatINR(r.pf) : '—'}</td>
                  <td className="px-2 py-1.5 text-right text-[#52525B] whitespace-nowrap">{r.esi ? formatINR(r.esi) : '—'}</td>
                  <td className="px-2 py-1.5 text-right text-[#18181B] font-semibold whitespace-nowrap">{formatINR(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {message && <p className="text-[11px] text-[#71717A] mt-3 leading-relaxed">{message}</p>}
    </ModalShell>
  )
}
