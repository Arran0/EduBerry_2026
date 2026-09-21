'use client'

/**
 * The "Manage" popup — everything that is not one of the four daily screens.
 *
 * The transport hub used to carry nine top-level tabs. Nine is not a navigation
 * bar, it is a list with a border: by the time a tab strip has to scroll on a
 * phone, it has stopped telling anyone where they are. The split applied here
 * is by *frequency*, not by subject — an admin opens Live many times a day and
 * opens "GPS devices" roughly once, when a bus is fitted. Those two things do
 * not belong at the same level, and putting them there costs the daily screens
 * the prominence they earn.
 *
 * So the four screens someone actually switches between stay as tabs, and the
 * rest live behind one button that opens this grid. Each entry opens the
 * existing section component in a modal, unchanged — the restructure is
 * navigation only, so nothing about routes, fleet or setup had to be rewritten
 * to move.
 */

import React from 'react'
import {
  Route, Bus, Users, MessageCircle, Radio, ScanLine, History, ShieldAlert, ChevronRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type PanelKey =
  | 'routes' | 'fleet' | 'crew' | 'whatsapp' | 'gps' | 'scan' | 'replay' | 'incidents'

interface Entry {
  key: PanelKey
  label: string
  blurb: string
  icon: LucideIcon
}

/**
 * Grouped, because "set it up once" and "go and look at what happened" are
 * different errands and a flat grid of five makes the reader sort them again.
 */
export const PANEL_GROUPS: { heading: string; entries: Entry[] }[] = [
  {
    heading: 'Set up',
    entries: [
      { key: 'routes', label: 'Routes', blurb: 'Draw a route, place its stops, assign students', icon: Route },
      { key: 'fleet', label: 'Fleet', blurb: 'Buses, capacity and compliance dates', icon: Bus },
      { key: 'crew', label: 'Crew', blurb: 'Drivers and attendants, and who rides which route', icon: Users },
    ],
  },
  {
    heading: 'Connect',
    entries: [
      { key: 'whatsapp', label: 'WhatsApp', blurb: 'Message templates and the sending account', icon: MessageCircle },
      { key: 'gps', label: 'GPS', blurb: 'Hardware already fitted to the buses', icon: Radio },
      { key: 'scan', label: 'Scan', blurb: 'Cards, fobs and QR — only if you want them', icon: ScanLine },
    ],
  },
  {
    heading: 'Look back',
    entries: [
      { key: 'replay', label: 'Replay', blurb: 'Scrub a finished trip, and export the open data feed', icon: History },
      { key: 'incidents', label: 'Incidents', blurb: 'SOS events and their frozen snapshots', icon: ShieldAlert },
    ],
  },
]

export const PANEL_TITLES: Record<PanelKey, { title: string; subtitle: string; icon: LucideIcon }> = {
  routes: { title: 'Routes', subtitle: 'Draw a route, place its stops, assign students', icon: Route },
  fleet: { title: 'Fleet', subtitle: 'Buses, capacity and compliance dates', icon: Bus },
  crew: { title: 'Crew', subtitle: 'Drivers and attendants, and who rides which route', icon: Users },
  whatsapp: { title: 'WhatsApp', subtitle: 'Message templates and the sending account', icon: MessageCircle },
  gps: { title: 'GPS', subtitle: 'Hardware already fitted to the buses', icon: Radio },
  scan: { title: 'Scan', subtitle: 'Cards, fobs and QR — only if you want them', icon: ScanLine },
  replay: { title: 'Replay', subtitle: 'Scrub a finished trip, and export the open data feed', icon: History },
  incidents: { title: 'Incidents', subtitle: 'SOS events and their frozen snapshots', icon: ShieldAlert },
}

export default function ManageLauncher({ onPick }: { onPick: (key: PanelKey) => void }) {
  return (
    <div className="space-y-6">
      {PANEL_GROUPS.map(group => (
        <div key={group.heading}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#A1A1AA] mb-2.5">
            {group.heading}
          </h3>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {group.entries.map(e => {
              const Icon = e.icon
              return (
                <button
                  key={e.key}
                  onClick={() => onPick(e.key)}
                  className="group flex items-start gap-3 rounded-xl border border-[#E4E4E7] bg-white p-3.5 text-left transition-colors hover:border-[#B8983C] hover:bg-[#FEFCF5]"
                >
                  <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#F4F4F5] text-[#52525B] transition-colors group-hover:bg-[#B8983C] group-hover:text-white">
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#27272A]">{e.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-[#71717A]">{e.blurb}</span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="mt-1.5 flex-shrink-0 text-[#D4D4D8] transition-colors group-hover:text-[#B8983C]"
                  />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
