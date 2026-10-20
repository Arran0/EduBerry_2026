'use client'

import React, { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, Loader2, Search, X } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Btn, SALARY_ICON, SX } from '@/components/salary/ui'
import SmartTypeahead from '@/components/SmartTypeahead'
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
  const [teamQuery, setTeamQuery] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const period = formatPeriod(cycle.period_month, cycle.period_year)

  const categoryCounts = useMemo(() => {
    const counts: Record<SalarySheetCategory, number> = { teaching: 0, non_teaching: 0, support: 0, driver: 0 }
    for (const r of rows) counts[r.category] += 1
    return counts
  }, [rows])

  /** Teams not already picked, narrowed to the typed-ahead query — teams can run
   *  into the dozens across a school, so this replaces listing every one at once. */
  const teamSuggestions = useMemo(() => {
    const q = teamQuery.trim().toLowerCase()
    return teams
      .filter(t => !teamIds.includes(t.id) && (!q || t.name.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [teams, teamIds, teamQuery])

  const selectedTeams = useMemo(
    () => teamIds.map(id => teams.find(t => t.id === id)).filter((t): t is TeamMembership => !!t),
    [teamIds, teams],
  )

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

  const chip = SX.choice

  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      sharp
      title="Salary sheet"
      subtitle={`${period} · ${filtered.length} of ${rows.length} record${rows.length === 1 ? '' : 's'}`}
      icon={<FileSpreadsheet size={16} />}
      iconClassName={SALARY_ICON}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-slate-500 tabular-nums">
            {filtered.length} record{filtered.length === 1 ? '' : 's'} · {formatINR(totalNet)} net
          </p>
          <Btn tone="dark" onClick={handleDownload} disabled={busy || filtered.length === 0}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy ? 'Building…' : 'Download Excel'}
          </Btn>
        </div>
      }
    >
      <p className={`${SX.heading} mb-1.5`}>Who to include</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CATEGORY_ORDER.filter(cat => categoryCounts[cat] > 0).map(cat => (
          <button key={cat} onClick={() => toggleCategory(cat)} className={chip(categories.has(cat))}>
            {CATEGORY_LABEL[cat]} ({categoryCounts[cat]})
          </button>
        ))}
      </div>

      {teams.length > 0 && (
        <>
          <p className={`${SX.heading} mb-1.5`}>Department or team</p>
          {selectedTeams.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {selectedTeams.map(t => (
                <button key={t.id} onClick={() => toggleTeam(t.id)} className={`${chip(true)} flex items-center gap-1`}>
                  {t.name} <X size={11} />
                </button>
              ))}
            </div>
          )}
          <div className="mb-3">
            <SmartTypeahead<TeamMembership>
              query={teamQuery}
              onQueryChange={setTeamQuery}
              suggestions={teamSuggestions}
              onSelect={t => { toggleTeam(t.id); setTeamQuery('') }}
              getKey={t => t.id}
              placeholder="Search a department or team…"
              className="flex items-center gap-2 h-9 rounded-[10px] border border-[#DDD8CC] bg-white px-3 focus-within:border-[#B8983C] focus-within:ring-2 focus-within:ring-[#B8983C]/20 transition"
              renderSuggestion={(t, active) => (
                <div className={`px-3 py-2 text-[13.5px] ${active ? 'bg-[#FAF7F0]' : 'bg-white'}`}>{t.name}</div>
              )}
            />
          </div>
        </>
      )}

      <div className="relative mb-3">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name"
          className={`${SX.field} pl-8`}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-[13px] text-slate-500 text-center py-10">Nobody matches these choices.</p>
      ) : (
        <div className="fx-card overflow-x-auto">
          <table className="w-full text-[12px] tabular-nums">
            <thead>
              <tr className="bg-[#F7F5F0] border-b border-[#EEEAE1] text-slate-500">
                <th className="text-left text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">Name</th>
                <th className="text-left text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">Designation</th>
                <th className="text-left text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">Category</th>
                <th className="text-right text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">Salary</th>
                <th className="text-right text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">PF</th>
                <th className="text-right text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">ESI</th>
                <th className="text-right text-[11.5px] font-medium px-2.5 py-2 whitespace-nowrap">Net</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-[#F0ECE3] last:border-0">
                  <td className="px-2.5 py-1.5 text-slate-900 font-semibold whitespace-nowrap">{r.name}</td>
                  <td className="px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{r.designation}</td>
                  <td className="px-2.5 py-1.5 text-slate-600 whitespace-nowrap">{CATEGORY_LABEL[r.category]}</td>
                  <td className="px-2.5 py-1.5 text-right text-slate-600 whitespace-nowrap">{formatINR(r.baseAmount)}</td>
                  <td className="px-2.5 py-1.5 text-right text-slate-600 whitespace-nowrap">{r.pf ? formatINR(r.pf) : '—'}</td>
                  <td className="px-2.5 py-1.5 text-right text-slate-600 whitespace-nowrap">{r.esi ? formatINR(r.esi) : '—'}</td>
                  <td className="px-2.5 py-1.5 text-right text-slate-900 font-semibold whitespace-nowrap">{formatINR(r.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {message && <p className="text-[12.5px] text-slate-600 mt-3 leading-relaxed">{message}</p>}
    </ModalShell>
  )
}
