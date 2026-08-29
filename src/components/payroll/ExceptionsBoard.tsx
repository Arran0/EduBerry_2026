'use client'

import React, { useState, useMemo } from 'react'
import { AlertTriangle, Check, ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { ExceptionRow } from '@/lib/payroll/rows'
import { SEVERITY_CHIP, SEVERITY_LABEL, PUI } from './ui'

/**
 * Exceptions, grouped by what is wrong rather than by who it happened to.
 *
 * An approver facing 40 rows wants to know there are three problems, not forty:
 * "12 people have no bank account", "2 structures expired". Each group carries
 * the one action that fixes the whole class of it, so the fix path is a click
 * rather than a hunt.
 *
 * Blocking exceptions gate approval — the run cannot move past them, and the
 * database refuses the lock independently even if the UI is bypassed.
 */

/** Where an admin goes to fix each kind of problem. */
const FIX_PATH: Record<string, { label: string; href: string }> = {
  MISSING_BANK:        { label: 'Open Bank Accounts',      href: '/more/salary?section=bank' },
  MISSING_UAN:         { label: 'Open statutory details',  href: '/more/payroll/structures?tab=statutory' },
  MISSING_IP_NUMBER:   { label: 'Open statutory details',  href: '/more/payroll/structures?tab=statutory' },
  MISSING_PAN:         { label: 'Open staff profiles',     href: '/more/profiles/staff' },
  NO_STRUCTURE:        { label: 'Assign a structure',      href: '/more/payroll/structures?tab=assignments' },
  STRUCTURE_INVALID:   { label: 'Open structures',         href: '/more/payroll/structures' },
  ATTENDANCE_INCOMPLETE: { label: 'Open attendance',       href: '/more/staff-attendance' },
  RULE_SET_STALE:      { label: 'Open compliance',         href: '/more/payroll/compliance' },
}

const CODE_TITLE: Record<string, string> = {
  MISSING_BANK: 'No bank account on record',
  MISSING_UAN: 'PF deducted but no UAN',
  MISSING_IP_NUMBER: 'ESI deducted but no IP number',
  MISSING_PAN: 'No PAN on record',
  NO_STRUCTURE: 'No salary structure in force',
  STRUCTURE_INVALID: 'Salary structure cannot be resolved',
  NEGATIVE_NET: 'Deductions exceed earnings',
  ZERO_NET: 'Nets zero this period',
  LOP_EXCEEDS_PERIOD: 'More loss-of-pay days than payable days',
  ATTENDANCE_INCOMPLETE: 'Days with no attendance marked',
  VARIANCE_ABOVE_THRESHOLD: 'Net pay moved sharply against last period',
  NEW_JOINER: 'First payroll for this employee',
  EXIT: 'On last period’s run but not this one',
  CALCULATION_FAILED: 'Calculation failed',
}

interface Group {
  code: string
  severity: 'block' | 'warn' | 'info'
  rows: ExceptionRow[]
}

export default function ExceptionsBoard({ exceptions, onResolve, readOnly }: {
  exceptions: ExceptionRow[]
  onResolve: (id: string, note: string) => Promise<void>
  readOnly: boolean
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>()
    for (const e of exceptions) {
      if (e.resolved_at && !showResolved) continue
      const g = map.get(e.code) ?? { code: e.code, severity: e.severity, rows: [] }
      g.rows.push(e)
      map.set(e.code, g)
    }
    const order = { block: 0, warn: 1, info: 2 }
    return [...map.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.rows.length - a.rows.length)
  }, [exceptions, showResolved])

  const blocking = exceptions.filter(e => e.severity === 'block' && !e.resolved_at).length
  const resolvedCount = exceptions.filter(e => e.resolved_at).length

  const resolveAll = async (g: Group) => {
    setBusy(g.code)
    for (const r of g.rows.filter(r => !r.resolved_at)) {
      await onResolve(r.id, 'Reviewed and accepted in bulk from the exceptions board.')
    }
    setBusy(null)
  }

  if (groups.length === 0) {
    return (
      <div className={`${PUI.card} p-6 text-center`}>
        <Check size={20} className="mx-auto text-emerald-600 mb-2" />
        <p className="text-sm font-semibold text-[#27272A]">Nothing outstanding</p>
        <p className="text-xs text-[#71717A] mt-1">
          {resolvedCount > 0
            ? `${resolvedCount} exception${resolvedCount === 1 ? '' : 's'} resolved.`
            : 'No exceptions were raised on this run.'}
        </p>
        {resolvedCount > 0 && (
          <button onClick={() => setShowResolved(true)} className={`${PUI.ghostBtn} mt-3`}>Show resolved</button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {blocking > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200">
          <AlertTriangle size={15} className="text-rose-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-rose-800 leading-relaxed">
            <strong>{blocking} blocking exception{blocking === 1 ? '' : 's'}.</strong> This run cannot be approved
            until every one is resolved — either fix the underlying record and recalculate, or resolve it here with a
            note explaining the decision.
          </p>
        </div>
      )}

      {groups.map(g => {
        const open = expanded.has(g.code)
        const unresolved = g.rows.filter(r => !r.resolved_at)
        const fix = FIX_PATH[g.code]
        return (
          <div key={g.code} className={PUI.card}>
            <button
              onClick={() => setExpanded(prev => {
                const next = new Set(prev)
                if (next.has(g.code)) next.delete(g.code); else next.add(g.code)
                return next
              })}
              className="w-full flex items-center gap-3 p-3 text-left"
            >
              <ChevronRight size={14} className={`text-[#A1A1AA] transition-transform ${open ? 'rotate-90' : ''}`} />
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md ${SEVERITY_CHIP[g.severity]}`}>
                {SEVERITY_LABEL[g.severity]}
              </span>
              <span className="flex-1 text-sm font-semibold text-[#27272A]">
                {CODE_TITLE[g.code] ?? g.code}
              </span>
              <span className="text-xs text-[#71717A] tabular-nums">
                {unresolved.length}{g.rows.length !== unresolved.length ? ` of ${g.rows.length}` : ''}
              </span>
            </button>

            {open && (
              <div className="border-t border-[#F4F4F5] p-3 space-y-1.5">
                {fix && (
                  <Link href={fix.href} className={`${PUI.ghostBtn} mb-2`}>
                    <ExternalLink size={12} /> {fix.label}
                  </Link>
                )}
                {g.rows.map(r => (
                  <div key={r.id} className="flex items-start gap-2.5 py-1.5">
                    <span className="flex-1 text-xs text-[#52525B] leading-relaxed">
                      {r.employee?.full_name && <strong className="text-[#27272A]">{r.employee.full_name}</strong>}
                      {r.employee?.full_name ? ' — ' : ''}{r.message}
                      {r.resolved_at && (
                        <span className="block text-[10px] text-emerald-600 mt-0.5">
                          Resolved{r.resolution_note ? ` — ${r.resolution_note}` : ''}
                        </span>
                      )}
                    </span>
                    {!r.resolved_at && !readOnly && (
                      <button
                        onClick={() => onResolve(r.id, 'Reviewed and accepted.')}
                        className={PUI.ghostBtn}
                      >
                        <Check size={11} /> Resolve
                      </button>
                    )}
                  </div>
                ))}
                {unresolved.length > 1 && !readOnly && (
                  <button onClick={() => resolveAll(g)} disabled={busy === g.code} className={`${PUI.ghostBtn} mt-2`}>
                    {busy === g.code ? 'Resolving…' : `Resolve all ${unresolved.length}`}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {resolvedCount > 0 && (
        <button onClick={() => setShowResolved(s => !s)} className="text-xs text-[#71717A] hover:text-[#27272A] font-semibold">
          {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
        </button>
      )}
    </div>
  )
}
