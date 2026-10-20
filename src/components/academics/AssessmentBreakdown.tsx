'use client'

import React from 'react'
import { StudentReportCardEntry } from '@/lib/classrooms'
import { markPercent, roundMark } from '@/lib/reportCardGrading'

/**
 * The "Assessments" cell of a report card: one line per assessment with its
 * total, and — when the assessment was marked in components ("Lab" /20,
 * "Examination" /80) — the parts that make that total up, indented under it.
 *
 * Shared by the Report Cards section on Academics and the full-page academic
 * record, which render the identical cell.
 */

/** A mark rendered the way a report card says it: "AB", "15/20 (75%)", or "—"
 *  when nothing was entered. */
function MarkText({
  marks, maxMarks, isAbsent, showPct = true,
}: {
  marks: number | null
  maxMarks: number
  isAbsent: boolean
  showPct?: boolean
}) {
  if (isAbsent) return <span className="text-red-500 font-semibold">AB</span>
  if (marks == null) return <span className="text-slate-400">—</span>
  // Whole marks only: halves are how they are entered, not how a card reads.
  // The percentage is taken from the same two rounded numbers on the page, so
  // dividing what is printed reproduces what is printed.
  const obtained = roundMark(Number(marks))
  const max = roundMark(Number(maxMarks))
  const exact = markPercent(Number(marks), Number(maxMarks))
  const pct = exact != null ? Math.round(exact) : null
  return (
    <>
      {obtained}<span className="text-slate-400">/{max}</span>
      {showPct && pct != null && <span className="text-slate-400"> ({pct}%)</span>}
    </>
  )
}

export function AssessmentBreakdown({ entries }: { entries: StudentReportCardEntry[] }) {
  return (
    <ul className="space-y-1.5">
      {entries.map(entry => {
        const m = entry.mark
        // A component whose mark was never entered still earns a row: a blank
        // "Lab —" says more on a report card than the part silently missing.
        const components = entry.components

        return (
          <li key={entry.assessment.id} className="text-xs">
            <div className="flex items-center gap-1.5 text-slate-600">
              <span className="w-1 h-1 rounded-full bg-slate-300 flex-shrink-0" aria-hidden />
              <span className="min-w-0 break-words flex-1">{entry.assessment.title}</span>
              <span className="font-semibold tabular-nums text-slate-700">
                <MarkText
                  marks={m?.marks ?? null}
                  maxMarks={Number(m?.max_marks ?? entry.assessment.max_marks)}
                  isAbsent={!!m?.is_absent}
                />
              </span>
            </div>

            {components.length > 0 && (
              <ul className="mt-1 ml-3.5 pl-2.5 border-l border-slate-200 space-y-0.5">
                {components.map(c => {
                  const cm = entry.componentMarks[c.id]
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-1.5 text-[11px] text-slate-500"
                    >
                      <span className="min-w-0 break-words flex-1">{c.name}</span>
                      <span className="tabular-nums">
                        <MarkText
                          marks={cm?.marks ?? null}
                          maxMarks={Number(c.max_marks)}
                          isAbsent={!!cm?.is_absent}
                          showPct={false}
                        />
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
