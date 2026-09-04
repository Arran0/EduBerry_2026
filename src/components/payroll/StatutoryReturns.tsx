'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Download, AlertTriangle, Building2, FileText } from 'lucide-react'
import { PUI, inr } from './ui'
import { fetchStatutoryConfig, DEFAULT_STATUTORY_CONFIG, type StatutoryConfig } from '@/lib/statutory'
import {
  ecrTextContent, ecrCsvContent, downloadTextFile, downloadEpfWageSheet,
  downloadEsiContributionSheet, statutoryPeriodSlug, filableEcrRows, filableEsiRows,
} from '@/components/salary/statements/statutoryFiles'
import { buildReturnsByLocation, type LocationReturn, type MemberIdentity } from '@/lib/payroll/returns'
import { fetchLocations, stateName } from '@/lib/payroll/locations'
import { supabase } from '@/lib/supabase'
import type { RunLineRow, RunRow } from '@/lib/payroll/rows'
import type { WorkLocation } from '@/lib/payroll/engine/types'

// The monthly EPFO and ESIC returns, one set per establishment.
//
// Two campuses with two EPFO codes file two returns. This screen makes that
// visible rather than producing one merged file that the portal would reject,
// and every figure in it is read from the run rather than recomputed — so what
// is filed and what was paid cannot drift apart.

export default function StatutoryReturns({ run, lines }: { run: RunRow; lines: RunLineRow[] }) {
  const [config, setConfig] = useState<StatutoryConfig>(DEFAULT_STATUTORY_CONFIG)
  const [locations, setLocations] = useState<WorkLocation[]>([])
  const [identities, setIdentities] = useState<Record<string, MemberIdentity>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cfg, locs, statutory] = await Promise.all([
        fetchStatutoryConfig(),
        fetchLocations(true),
        supabase.from('payroll_employee_statutory')
          .select('employee_id, uan, esi_ip_number')
          .in('employee_id', lines.map(l => l.employee_id)),
      ])
      if (cancelled) return
      setConfig(cfg)
      setLocations(locs)
      setIdentities(Object.fromEntries(
        ((statutory.data ?? []) as { employee_id: string; uan: string | null; esi_ip_number: string | null }[])
          .map(r => [r.employee_id, { uan: r.uan, esiIpNumber: r.esi_ip_number }]),
      ))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [lines])

  const returns = useMemo(
    () => loading ? [] : buildReturnsByLocation({ lines, locations, baseConfig: config, identities }),
    [loading, lines, locations, config, identities],
  )

  if (loading) return <div className={`${PUI.card} h-40 animate-pulse`} />

  const slug = statutoryPeriodSlug(run.period_month, run.period_year)

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
        Every figure below is read from this run — the wage bases the engine used and the contributions it
        deducted — not recalculated. {returns.length > 1
          ? `${returns.length} establishments file separately.`
          : 'One establishment, one set of files.'}
      </p>

      {run.status !== 'locked' && run.status !== 'paid' && run.status !== 'reconciled' && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-900 leading-relaxed">
            This run is not locked yet, so these figures can still move. Generating a return now is fine for
            checking; file it only once the run is locked.
          </p>
        </div>
      )}

      {returns.map((r, i) => (
        <EstablishmentCard key={r.location?.id ?? `unlocated-${i}`} ret={r} slug={slug} />
      ))}
    </div>
  )
}

function EstablishmentCard({ ret, slug }: { ret: LocationReturn; slug: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const ecrFilable = filableEcrRows(ret.ecr)
  const esiFilable = filableEsiRows(ret.esi)
  const ecrIssues = ret.ecr.length - ecrFilable.length
  const esiIssues = ret.esi.length - esiFilable.length
  const name = ret.location?.name ?? 'No work location'
  const fileBase = `${name.replace(/[^A-Za-z0-9]+/g, '-')}-${slug}`

  const run = async (key: string, fn: () => Promise<void> | void) => {
    setBusy(key)
    try { await fn() } finally { setBusy(null) }
  }

  return (
    <div className={`${PUI.card} p-3.5`}>
      <div className="flex items-start gap-2.5">
        <Building2 size={16} className="text-[#A1A1AA] mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[#27272A]">{name}</p>
            {ret.location && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F4F4F5] text-[#52525B] border border-[#E4E4E7]">
                {stateName(ret.location.stateCode)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-[#A1A1AA] mt-0.5">
            EPF {ret.config.epf_establishment_id || '—'} · ESI {ret.config.esi_employer_code || '—'}
          </p>
        </div>
      </div>

      {ret.blockers.length > 0 && (
        <div className="mt-2.5 flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200">
          <AlertTriangle size={13} className="text-rose-600 mt-0.5 flex-shrink-0" />
          <div className="text-[11px] text-rose-900 leading-relaxed">
            {ret.blockers.map((b, i) => <p key={i}>{b}</p>)}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        {/* ── EPF ── */}
        <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E4E4E7]">
          <p className={PUI.label}>EPFO — ECR</p>
          <p className="text-[11px] text-[#71717A] mt-1">
            {ecrFilable.length} member{ecrFilable.length === 1 ? '' : 's'}
            {ecrIssues > 0 && <span className="text-amber-700"> · {ecrIssues} held back</span>}
          </p>
          <p className="text-xs text-[#27272A] mt-1.5">
            Remittance <strong>{inr(ret.epf.grandTotal)}</strong>
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <button
              disabled={ecrFilable.length === 0 || busy !== null}
              onClick={() => run('ecr-txt', () => downloadTextFile(`ECR-${fileBase}.txt`, ecrTextContent(ret.ecr)))}
              className={PUI.ghostBtn}>
              <Download size={12} /> ECR .txt
            </button>
            <button
              disabled={ecrFilable.length === 0 || busy !== null}
              onClick={() => run('ecr-csv', () => downloadTextFile(`ECR-${fileBase}.csv`, ecrCsvContent(ret.ecr), 'text/csv;charset=utf-8'))}
              className={PUI.ghostBtn}>
              <Download size={12} /> CSV
            </button>
            <button
              disabled={ecrFilable.length === 0 || busy !== null}
              onClick={() => run('ecr-xlsx', () => downloadEpfWageSheet(`EPF-wages-${fileBase}.xlsx`, ret.ecr, ret.config, name))}
              className={PUI.ghostBtn}>
              <FileText size={12} /> Wage sheet
            </button>
          </div>
        </div>

        {/* ── ESI ── */}
        <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E4E4E7]">
          <p className={PUI.label}>ESIC — Monthly Contribution</p>
          <p className="text-[11px] text-[#71717A] mt-1">
            {esiFilable.length} insured person{esiFilable.length === 1 ? '' : 's'}
            {esiIssues > 0 && <span className="text-amber-700"> · {esiIssues} held back</span>}
          </p>
          <p className="text-xs text-[#27272A] mt-1.5">
            Contribution <strong>{inr(ret.esiTotals.grandTotal)}</strong>
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <button
              disabled={esiFilable.length === 0 || busy !== null}
              onClick={() => run('esi-xls', () => downloadEsiContributionSheet(`ESIC-MC-${fileBase}.xls`, ret.esi))}
              className={PUI.ghostBtn}>
              <FileText size={12} /> MC template
            </button>
          </div>
        </div>
      </div>

      {(ecrIssues > 0 || esiIssues > 0) && (
        <p className="text-[11px] text-amber-700 mt-2.5 leading-relaxed">
          Rows held back are previewed but left out of the file: a missing UAN or IP number would be rejected on
          upload, and filing the rest is better than filing nothing.
        </p>
      )}
    </div>
  )
}
