'use client'

/**
 * "Boarded the bus, marked absent in class."
 *
 * The one question a standalone bus tracker structurally cannot ask, and the
 * reason for building transport inside the ERP rather than beside it. Leave is
 * already excluded in SQL, so every row here is a real "where did this child
 * go?" — which makes it the only panel on the operations screen whose right
 * response is to pick up a phone, not to read a number.
 *
 * So it is built as a count you can press rather than a chart you can admire:
 * the tile states the number, and opening it gives the names with a call and a
 * WhatsApp button against each.
 */

import React, { useMemo } from 'react'
import { AlertTriangle, Phone, MessageCircle, CalendarDays } from 'lucide-react'
import { ADMIN, SHEET } from '@/components/bus/adminUI'
import type { MismatchRow } from '@/lib/transport/reports'

/** Digits only, with a default country code when the number has none. */
function toE164Digits(raw: string | null, defaultCc = '91'): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return null
  // 10 digits is a bare Indian mobile; anything longer already carries a code.
  return digits.length === 10 ? `${defaultCc}${digits}` : digits
}

export function MismatchTile({ rows, onOpen }: { rows: MismatchRow[]; onOpen: () => void }) {
  const today = rows.filter(r => r.service_date === new Date().toISOString().slice(0, 10)).length
  const none = rows.length === 0

  return (
    <button
      onClick={onOpen}
      disabled={none}
      className={`${ADMIN.card} p-4 text-left w-full transition-colors ${
        none ? 'cursor-default' : 'hover:border-[#B8983C] hover:bg-[#FEFCF5]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
          none ? 'bg-[#F4F4F5] text-[#A1A1AA]' : 'bg-[#FEF2F2] text-[#DC2626]'
        }`}>
          <AlertTriangle size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={ADMIN.label}>Bus vs class</p>
          <p className="mt-1 text-2xl font-bold leading-none text-[#27272A] tabular-nums">
            {rows.length}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-[#71717A]">
            {none
              ? 'Every child who boarded was marked present in class.'
              : <>boarded the bus, marked absent in class{today > 0 && <> · <span className="font-semibold text-[#DC2626]">{today} today</span></>}</>}
          </p>
          {!none && (
            <p className="mt-2 text-[11px] font-semibold text-[#B8983C]">
              Open the list and call home →
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

export default function MismatchList({ rows }: { rows: MismatchRow[] }) {
  // Newest first is already the server's order; group headings make a week of
  // rows readable without a date column repeating on every line.
  const groups = useMemo(() => {
    const m = new Map<string, MismatchRow[]>()
    for (const r of rows) {
      const k = r.service_date
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(r)
    }
    return [...m.entries()]
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-semibold text-[#52525B]">Nothing to chase</p>
        <p className="mt-1 text-xs text-[#A1A1AA]">
          Every child who boarded a bus was marked present in class.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-[#71717A]">
        Each of these children boarded the bus and was then marked absent in class,
        with no approved leave on file. Most are a register not yet updated; the
        point of the list is that the few that are not get found the same morning.
      </p>

      {groups.map(([date, items]) => (
        <div key={date}>
          <div className="mb-2 flex items-center gap-2">
            <CalendarDays size={13} className="text-[#A1A1AA]" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#71717A]">
              {new Date(date).toLocaleDateString(undefined, {
                weekday: 'short', day: 'numeric', month: 'short',
              })}
            </span>
            <span className="text-[11px] text-[#A1A1AA]">· {items.length}</span>
          </div>

          <div className={SHEET.wrap}>
            {items.map(r => {
              const phone = toE164Digits(r.guardian_phone)
              return (
                <div key={`${r.service_date}-${r.student_id}`} className={SHEET.row}>
                  <div className="w-1 flex-shrink-0 bg-[#DC2626]" />
                  <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#27272A]">
                      {r.student_name}
                    </span>
                    <span className="truncate text-xs text-[#71717A]">{r.route_name ?? '—'}</span>
                    <span className="rounded-full bg-[#F4F4F5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#52525B]">
                      {r.boarding_state}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {phone ? (
                        <>
                          <a
                            href={`tel:+${phone}`}
                            className={ADMIN.ghostBtn}
                            title={`Call ${r.guardian_phone}`}
                          >
                            <Phone size={13} /> Call
                          </a>
                          <a
                            href={`https://wa.me/${phone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1DA851]"
                          >
                            <MessageCircle size={13} /> WhatsApp
                          </a>
                        </>
                      ) : (
                        // Saying the number is missing is more useful than a
                        // dead button that looks like it should work.
                        <span className="text-[11px] italic text-[#A1A1AA]">No number on file</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
