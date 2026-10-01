'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import Avatar from '@/components/Avatar'
import { DateToggler } from '@/components/workspace/ui'
import {
  MESSAGE_KIND_LABELS, MESSAGE_KIND_PILL, deliveryState, fetchMessageLog,
  type MessageLogRow,
} from '@/lib/attendanceWhatsApp'

/**
 * What was sent, and whether it arrived.
 *
 * Worth a screen of its own because "we messaged the parents" and "the parents
 * received it" are different claims, and only the second one means the school
 * has actually told anybody. Delivery and read receipts come back through the
 * webhook, so a row stuck on Queued or Sent is a real signal — that family
 * should be phoned rather than assumed informed.
 *
 * The log keeps the number a message actually went to — it is the audit record,
 * and "we sent it to the wrong number" is the one question it has to be able to
 * answer. It is rendered as a four-digit tail: enough to tell two guardians
 * apart, which is all the office needs, and not a roll of parents' mobile
 * numbers on a screen anyone can photograph.
 */
export default function HistorySheet({
  date: initialDate, todayStr, onClose,
}: {
  date: string
  todayStr: string
  onClose: () => void
}) {
  const [date, setDate] = useState(initialDate)
  const [rows, setRows] = useState<MessageLogRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setRows(await fetchMessageLog({ date }))
    setLoading(false)
  }, [date])

  useEffect(() => { void load() }, [load])

  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      zClass="z-[210]"
      title="Message history"
      subtitle="Sent, delivered and read — per attendance date"
      icon={<History size={16} />}
      iconClassName="bg-slate-100 text-slate-600"
      minHClass="sm:min-h-[24rem]"
      headerActions={
        <DateToggler value={date} onChange={setDate} max={todayStr} todayStr={todayStr} size="sm" />
      }
    >
      {loading ? (
        <div className="py-14 flex justify-center"><Loader2 className="animate-spin text-[#A1A1AA]" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[#71717A] border border-[#E4E4E7] bg-[#FAFAF9] px-3 py-3 rounded-lg">
          Nothing was sent about this date.
        </p>
      ) : (
        <div className="border border-[#E4E4E7] divide-y divide-[#F0F0EF] rounded-lg overflow-hidden">
          {rows.map(row => {
            const state = deliveryState(row)
            return (
              <div key={row.id} className="flex items-center gap-2.5 px-2.5 sm:px-3 py-2 bg-white">
                <Avatar
                  avatarUrl={row.student?.avatar_url ?? null}
                  name={row.student?.full_name ?? null}
                  size={24}
                  userId={row.student_id}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#18181B] truncate">
                    {row.student?.full_name ?? 'Student'}
                  </p>
                  <p className="text-[11px] text-[#A1A1AA] truncate">
                    {row.msisdn ? `••••••${row.msisdn.slice(-4)}` : 'no number'}
                    {row.schedule_id ? ' · automatic' : ' · sent by hand'}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 hidden sm:inline ${
                  MESSAGE_KIND_PILL[row.kind] ?? 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  {MESSAGE_KIND_LABELS[row.kind] ?? row.kind}
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${state.className}`}>
                  {state.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </ModalShell>
  )
}
