'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The timetable workspace.
//
// Laid out like the transport, fee and salary admins: the banner, then the
// workspace deck — which timetable, the steps that build and publish it, and
// the four editors as tiles — and a capsule switch for the three ways of
// looking at the week right above the grid it switches. The grid is never replaced by a settings
// page: the editors open over it, on the shared glass sheet.
//
// The view lives in the URL so a link or a refresh lands on the same one.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import {
  Settings, BookOpen, CalendarRange, Users, GraduationCap, LayoutGrid, Rows3, UserCog,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fetchConfigs, fetchPublishedConfigIds } from '@/lib/timetable'
import type { TimetableConfig } from '@/lib/timetable'
import ModalShell from '@/components/ui/ModalShell'
import { GlassSegments } from '@/components/transport/glass'
import { SALARY_ICON } from '@/components/salary/ui'
import GenerateTab from './admin/GenerateTab'
import type { DeckProps, View } from './admin/GenerateTab'
import { TimetableDraftProvider } from './draft/TimetableDraftContext'
import { SmartSelect, BTN_PRIMARY, ConfirmHost, Loading, FOCUS } from './ui'
import type { SmartOption } from './ui'

// The editors are opened on demand, and between them they are most of the
// timetable's code — so they load when first opened, not with the page.
const editorLoading = () => <Loading />
const SetupTab = dynamic(() => import('./admin/SetupTab'), { loading: editorLoading })
const HomeroomModal = dynamic(() => import('./admin/homeroom/HomeroomModal'), { loading: editorLoading })
const TeacherModal = dynamic(() => import('./admin/teacher/TeacherModal'), { loading: editorLoading })
const SubjectModal = dynamic(() => import('./admin/subject/SubjectModal'), { loading: editorLoading })

type Editor = 'config' | 'homeroom' | 'teacher' | 'subjects'

const EDITORS: { key: Editor; label: string; shortLabel: string; subtitle: string; icon: LucideIcon }[] = [
  { key: 'config', label: 'Configuration', shortLabel: 'Setup', subtitle: 'Working days, periods and period groups', icon: Settings },
  { key: 'homeroom', label: 'Classes', shortLabel: 'Classes', subtitle: 'Class teacher, groups, lessons and time off', icon: Users },
  { key: 'teacher', label: 'Teachers', shortLabel: 'Teachers', subtitle: 'Time off, load limits and periods in a row', icon: GraduationCap },
  { key: 'subjects', label: 'Subjects', shortLabel: 'Subjects', subtitle: 'Limits, time off and rooms', icon: BookOpen },
]

const VIEWS: { key: View; label: string; icon: LucideIcon }[] = [
  { key: 'master', label: 'Whole school', icon: LayoutGrid },
  { key: 'class', label: 'By class', icon: Rows3 },
  { key: 'teacher', label: 'By teacher', icon: UserCog },
]

export default function AdminTimetableBuilder() {
  const router = useRouter()
  const params = useSearchParams()
  const viewParam = params.get('view')
  const view: View = VIEWS.some((v) => v.key === viewParam) ? (viewParam as View) : 'master'
  const setView = useCallback((next: View) => {
    router.replace(next === 'master' ? '/more/timetable' : `/more/timetable?view=${next}`, { scroll: false })
  }, [router])

  const [configs, setConfigs] = useState<TimetableConfig[]>([])
  // Configs students and staff can see: switched on, with a published week.
  const [published, setPublished] = useState<Set<string>>(new Set())
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)

  const loadConfigs = useCallback(async () => {
    const [list, publishedIds] = await Promise.all([fetchConfigs(), fetchPublishedConfigIds()])
    const live = new Set(list.filter((c) => c.is_active && publishedIds.has(c.id)).map((c) => c.id))
    setConfigs(list)
    setPublished(live)
    // Default selection: a published config, else the most recent.
    setSelectedConfigId((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev
      return list.find((c) => live.has(c.id))?.id ?? list[0]?.id ?? null
    })
    setLoading(false)
  }, [])

  useEffect(() => { loadConfigs() }, [loadConfigs])

  const selectedConfig = configs.find((c) => c.id === selectedConfigId) ?? null

  const configOptions: SmartOption[] = useMemo(
    () => configs.map((c) => ({
      value: c.id,
      label: c.name,
      sublabel: c.academic_year || undefined,
      badge: published.has(c.id) ? 'Published' : undefined,
    })),
    [configs, published],
  )

  const picker = (
    <SmartSelect
      options={configOptions}
      value={selectedConfigId ?? ''}
      onChange={(v) => setSelectedConfigId(v || null)}
      placeholder={configs.length === 0 ? 'No timetable yet' : 'Choose a timetable'}
      searchPlaceholder="Search timetables…"
      leadingIcon={<CalendarRange size={14} className="text-slate-400 flex-shrink-0" />}
    />
  )

  const deck = (p: DeckProps) => (
    <WorkspaceDeck {...p} picker={picker} active={editor} onOpen={setEditor} />
  )

  // Whole school · By class · By teacher — sits right above the grid it switches.
  const viewSwitch = (
    <GlassSegments
      layoutId="tt-view"
      items={VIEWS}
      value={view}
      onChange={setView}
      stretch
      className="!bg-white ring-1 ring-black/[.06] shadow-[0_8px_20px_-14px_rgba(15,23,42,.45)]"
    />
  )

  const meta = EDITORS.find((e) => e.key === editor) ?? null

  // The editors are the same four with or without a draft; outside one only
  // Configuration has anything to show.
  const editorModal = (
    <AnimatePresence>
      {meta && (
        <ModalShell
          key={meta.key}
          onClose={() => setEditor(null)}
          size={meta.key === 'config' ? '2xl' : 'wide'}
          fullHeight={meta.key !== 'config'}
          fill={meta.key !== 'config'}
          sharp
          glass
          title={meta.label}
          subtitle={meta.subtitle}
          icon={<meta.icon size={17} />}
          iconClassName={SALARY_ICON}
          minHClass={meta.key === 'config' ? 'sm:min-h-[30rem]' : ''}
        >
          {meta.key === 'config' && (
            <SetupTab
              configs={configs}
              published={published}
              selectedConfig={selectedConfig}
              onSelectConfig={setSelectedConfigId}
              onChanged={loadConfigs}
            />
          )}
          {meta.key === 'homeroom' && <HomeroomModal config={selectedConfig} />}
          {meta.key === 'teacher' && <TeacherModal config={selectedConfig} />}
          {meta.key === 'subjects' && <SubjectModal config={selectedConfig} />}
        </ModalShell>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <ConfirmHost />

      {loading ? (
        <div className="pt-5 sm:pt-6"><Loading /></div>
      ) : selectedConfig ? (
        <TimetableDraftProvider config={selectedConfig} key={selectedConfig.id}>
          <div className="pt-5 sm:pt-6">
            <GenerateTab
              view={view}
              onViewChange={setView}
              renderDeck={deck}
              viewSwitch={viewSwitch}
              onPublishedChange={loadConfigs}
            />
          </div>
          {editorModal}
        </TimetableDraftProvider>
      ) : (
        <div className="space-y-4 pt-5 sm:pt-6">
          {deck({})}
          <div className="fx-card fx-bleed px-4 py-12 text-center">
            <LayoutGrid size={28} className="mx-auto text-slate-300" />
            <p className="mt-3 text-[14px] font-semibold text-slate-800">No timetable yet</p>
            <p className="mt-1 text-[12.5px] text-slate-500">Create one in Configuration, then add its periods.</p>
            <button onClick={() => setEditor('config')} className={`${BTN_PRIMARY} mt-4`}>
              <Settings size={14} className="text-[#E9DDBB]" />
              Open configuration
            </button>
          </div>
          {editorModal}
        </div>
      )}
    </>
  )
}

/**
 * The workspace deck: which timetable, its status, the build steps, and the
 * four editors. Square glass, edge to edge on a phone.
 */
function WorkspaceDeck({ picker, status, actions, counts, active, onOpen }: DeckProps & {
  picker: React.ReactNode
  active: Editor | null
  onOpen: (e: Editor) => void
}) {
  return (
    // The picker's menu opens down over the editor tiles and whatever follows
    // the deck, so the deck sits above the page and the picker row above the
    // tiles. `!` because `.fx-deck > *` gives every row z-index 3, and the
    // tiles come later in the page, so they would win the tie.
    <section className="fx-deck fx-bleed min-w-0 z-20">
      <div className="!z-20 flex flex-wrap items-center gap-x-3 gap-y-2.5 px-3 sm:px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1 basis-[280px]">
          <div className="min-w-0 flex-1 lg:max-w-[24rem]">{picker}</div>
          {status}
        </div>
        {actions && <div className="flex w-full sm:w-auto items-center gap-1.5">{actions}</div>}
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2 px-2.5 sm:px-3 pb-2.5 sm:pb-3">
        {EDITORS.map((e) => (
          <EditorTile
            key={e.key}
            icon={e.icon}
            label={e.label}
            shortLabel={e.shortLabel}
            detail={counts?.[e.key]}
            pressed={active === e.key}
            onClick={() => onOpen(e.key)}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * A launcher tile, square. On a phone it stands upright — chip over a short
 * name — so four fit across; from sm up it lies flat with what it holds.
 */
function EditorTile({ icon: Icon, label, shortLabel, detail, pressed, onClick }: {
  icon: LucideIcon
  label: string
  shortLabel: string
  detail?: string
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={pressed}
      title={detail ? `${label} · ${detail}` : label}
      className={`fx-tile min-w-0 flex flex-col sm:flex-row items-center gap-1.5 sm:gap-3 px-1 py-2.5 sm:p-3 text-center sm:text-left transition hover:-translate-y-px hover:border-[#B8983C]/60 active:translate-y-0 ${FOCUS}`}
    >
      <span className="icon-chip w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3D3B40, #8B6F47)' }}>
        <Icon size={15} className="relative z-10 text-white" />
      </span>
      <span className="min-w-0 w-full sm:flex-1">
        <span className="block text-[12px] sm:text-[13px] font-semibold leading-tight text-slate-900">
          <span className="sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
        {detail && <span className="hidden sm:block mt-0.5 text-[11.5px] leading-snug text-slate-500 break-words">{detail}</span>}
      </span>
    </button>
  )
}
