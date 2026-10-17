'use client'

/**
 * The two Manage destinations that are a composition rather than a component.
 */

import React, { useState } from 'react'
import { ScanLine, ChevronDown, ChevronRight, Globe } from 'lucide-react'
import { ADMIN } from './glassAdmin'
import { CardsPanel, GtfsPanel } from './sections/IntegrationsSection'
import HistorySection from './sections/HistorySection'

/**
 * Scan — folded shut until a school says it wants it.
 *
 * Most schools mark boarding by tapping a name, and for them card issuing,
 * fob registration and QR printing are three screens of machinery for a
 * decision they have not made. So the panel states the choice first and stays
 * collapsed: a school that scans opens it once and it stays open for them,
 * and a school that doesn't never has to scroll past it.
 *
 * The preference is per-browser on purpose — it changes nothing about how
 * boarding works, so it does not deserve a column in the database. A scanner
 * that was issued cards still works whether or not this panel is expanded.
 */
export function ScanPanel() {
  const [open, setOpen] = useState<boolean>(() => {
    // Remembered per browser; absent, blocked or throwing storage just means
    // the panel starts closed, which is the right default anyway.
    try { return localStorage.getItem('transport.scan.enabled') === '1' } catch { return false }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem('transport.scan.enabled', next ? '1' : '0') } catch { /* fine */ }
  }

  return (
    <div className="space-y-4">
      <div className={`${ADMIN.card} p-4`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#F4F4F5] text-[#52525B]">
            <ScanLine size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#27272A]">
              Do you want to scan children onto the bus?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#71717A]">
              Optional. Boarding already works by tapping a name on the attendant&apos;s
              phone, and a scan is only a faster tap — it can do nothing the attendant
              could not, and the attendant still sees the name and photo that comes
              back, which is what catches a child carrying a friend&apos;s card.
              Turn this on only if you are issuing RFID cards, NFC fobs or printed QR.
            </p>
            <button onClick={toggle} className={`${ADMIN.ghostBtn} mt-2.5`}>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {open ? 'Hide card and QR setup' : 'Yes, set up scanning'}
            </button>
          </div>
        </div>
      </div>

      {open && <CardsPanel />}
    </div>
  )
}

/**
 * Replay — a finished trip, and the open-data feed of the same history.
 *
 * Both answer "what actually happened"; one for one trip, one for every trip
 * in a format somebody else's software can read. They were two tabs apart and
 * had no reason to be.
 */
export function ReplayPanel() {
  const [showExport, setShowExport] = useState(false)

  return (
    <div className="space-y-4">
      <HistorySection />

      <div className={`${ADMIN.card} p-4`}>
        <button
          onClick={() => setShowExport(v => !v)}
          className="flex w-full items-start gap-3 text-left"
        >
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#F4F4F5] text-[#52525B]">
            <Globe size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[#27272A]">
              Open data export
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-[#71717A]">
              GTFS and GTFS-Realtime — the formats a transport authority or a
              third-party map app reads. The difference between data the school
              owns and data that happens to live in EdZee.
            </span>
          </span>
          {showExport
            ? <ChevronDown size={16} className="mt-1 flex-shrink-0 text-[#A1A1AA]" />
            : <ChevronRight size={16} className="mt-1 flex-shrink-0 text-[#A1A1AA]" />}
        </button>

        {showExport && <div className="mt-4 border-t border-[#F4F4F5] pt-4"><GtfsPanel /></div>}
      </div>
    </div>
  )
}
