'use client'

import React from 'react'
import { Check, Lock } from 'lucide-react'
import { RUN_STATUSES, RUN_STATUS_LABEL, RUN_STATUS_HELP, type RunStatus } from '@/lib/payroll/engine/workflow'
import type { RunEventRow } from '@/lib/payroll/rows'

/**
 * The nine states across the top of a run, showing which are done, who did each
 * one and when.
 *
 * A payroll status is not a label — it is a record of who took responsibility
 * for what. Showing the actor and the timestamp on the rail itself is most of
 * what makes an approval mean something afterwards.
 */
export default function WorkflowRail({ status, events }: { status: RunStatus; events: RunEventRow[] }) {
  const currentIndex = RUN_STATUSES.indexOf(status)
  // The last time each state was entered, and by whom.
  const reached = new Map<string, RunEventRow>()
  for (const e of events) reached.set(e.to_status, e)

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex items-stretch gap-0 min-w-max">
        {RUN_STATUSES.map((s, i) => {
          const done = i < currentIndex
          const current = i === currentIndex
          const event = reached.get(s)
          return (
            <div key={s} className="flex items-stretch">
              {i > 0 && (
                <div className={`w-6 self-center h-px ${i <= currentIndex ? 'bg-[#27272A]' : 'bg-[#E4E4E7]'}`} />
              )}
              <div
                className={`px-3 py-2 rounded-lg border min-w-[7.5rem] ${
                  current ? 'bg-[#27272A] border-[#27272A] text-white'
                  : done ? 'bg-white border-[#E4E4E7]'
                  : 'bg-[#FAFAFA] border-[#F4F4F5]'
                }`}
                title={RUN_STATUS_HELP[s]}
              >
                <div className="flex items-center gap-1.5">
                  {done && <Check size={11} className="text-emerald-600 flex-shrink-0" />}
                  {current && s === 'locked' && <Lock size={11} className="flex-shrink-0" />}
                  <span className={`text-[11px] font-semibold ${current ? 'text-white' : done ? 'text-[#27272A]' : 'text-[#A1A1AA]'}`}>
                    {RUN_STATUS_LABEL[s]}
                  </span>
                </div>
                {event && (
                  <div className={`text-[9px] mt-0.5 leading-tight ${current ? 'text-white/60' : 'text-[#A1A1AA]'}`}>
                    {event.actor?.full_name ? `${event.actor.full_name.split(' ')[0]} · ` : ''}
                    {new Date(event.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
