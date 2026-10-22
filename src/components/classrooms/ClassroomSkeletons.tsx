'use client'

import React, { useState } from 'react'
import {
  ClipboardList, Folder, MessageSquare, ChevronRight, Plus, Send,
} from 'lucide-react'

/**
 * Loading placeholders for the classroom module, drawn at the exact size of
 * what they stand in for — same card radius, paddings and row heights — so
 * nothing jumps when the data lands.
 *
 * Kept in their own small file, apart from the tabs they mirror, so the
 * classroom page can show a tab's skeleton while that tab's code is still
 * downloading (and while the classroom itself loads) without pulling the tab
 * in first.
 */

// ── Primitives ────────────────────────────────────────────────────────────────

/** One shimmering block. Always the cool variant: every surface in the
 *  classroom module that shows one is a white card or the pale page canvas,
 *  where the warm base reads as a smudge. `delay` staggers the sweep (ms). */
export function Sk({ className = '', delay = 0, style }: {
  className?: string
  delay?: number
  style?: React.CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={`block skeleton skeleton-cool ${className}`}
      style={{ ...style, '--sk-delay': `${delay}ms` } as React.CSSProperties}
    />
  )
}

/** A line of text: a bar centred in a box one line-height tall, so a column of
 *  them is exactly as tall as the text that replaces it. */
export function SkText({ line = 'h-4', bar = 'h-2.5', className = '', delay = 0 }: {
  /** Height of the text line it stands in for, e.g. `h-5` for text-sm. */
  line?: string
  /** Height of the bar itself. */
  bar?: string
  /** Width (and any extra) classes for the bar. */
  className?: string
  delay?: number
}) {
  return (
    <span aria-hidden className={`flex items-center ${line}`}>
      <Sk className={`${bar} !rounded-full ${className}`} delay={delay} />
    </span>
  )
}

/** A round avatar placeholder, the size Avatar is given. */
export function SkAvatar({ size, delay = 0, className = '' }: { size: number; delay?: number; className?: string }) {
  return (
    <Sk
      className={`keep-round rounded-full flex-shrink-0 ${className}`}
      delay={delay}
      style={{ width: size, height: size, minWidth: size }}
    />
  )
}

/** The container every skeleton sits in: marked busy, and labelled for screen
 *  readers, which otherwise hear nothing at all while it shimmers. */
export function SkeletonRegion({ label, className = '', style, children }: {
  label: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <div aria-busy="true" className={className} style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** How many placeholder rows to draw for a class list: the real roster size
 *  when it is known, kept within reason so a big class doesn't paint a wall. */
export function skeletonRowCount(known: number | undefined, fallback = 8, max = 16): number {
  if (!known || known <= 0) return fallback
  return Math.min(known, max)
}

// ── Tab header ────────────────────────────────────────────────────────────────

/** The row at the top of the Content / Assessments / Discussion tabs. The icon
 *  and title never change, so they are drawn for real; only the count under
 *  the title, and the staff action button, are placeholders. */
function TabHeaderSkeleton({ icon, chipClass, title, actionWidth }: {
  icon: React.ReactNode
  chipClass: string
  title: string
  /** Width class of the staff action pill; omitted when there is none. */
  actionWidth?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className={`p-2 rounded-xl ${chipClass}`}>{icon}</div>
        <div>
          <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
          <SkText className="w-14" />
        </div>
      </div>
      {actionWidth && <Sk className={`keep-round h-8 ${actionWidth} rounded-full flex-shrink-0`} delay={120} />}
    </div>
  )
}

const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(15,23,42,.05),0_10px_24px_-18px_rgba(15,23,42,.4)]'

// ── Content tab (FolderFileView) ──────────────────────────────────────────────

const FOLDER_TITLE_WIDTHS = ['w-40', 'w-28', 'w-48', 'w-32']

/** The Content tab's folder list: header, then folder cards collapsed. */
export function FolderListSkeleton({ canManage = false, count = 4 }: { canManage?: boolean; count?: number }) {
  return (
    <SkeletonRegion label="Loading content…" className="space-y-4">
      <TabHeaderSkeleton
        icon={<Folder size={16} className="text-slate-600" />}
        chipClass="bg-slate-100"
        title="Content"
        actionWidth={canManage ? 'w-[108px]' : undefined}
      />
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={`border rounded-2xl overflow-hidden border-slate-200 bg-white ${CARD_SHADOW}`}>
            <div className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
              <div className="p-2 rounded-xl flex-shrink-0 bg-slate-100">
                <Folder size={16} className="text-slate-300" />
              </div>
              <div className="flex-1 min-w-0">
                <SkText line="h-5" bar="h-3" className={FOLDER_TITLE_WIDTHS[i % FOLDER_TITLE_WIDTHS.length]} delay={i * 80} />
                {i % 2 === 0 && <SkText className="w-3/5 mt-0.5" delay={i * 80 + 40} />}
              </div>
              <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
              {canManage && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {[0, 1, 2].map(b => (
                    <Sk key={b} className="w-[25px] h-[25px] rounded-lg" delay={i * 80 + 120 + b * 40} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/** The classwork rows inside a folder that has just been opened. */
export function ClassworkRowsSkeleton({ isStudent, count = 3 }: { isStudent: boolean; count?: number }) {
  return (
    <SkeletonRegion label="Loading classwork…" className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-l-4 border-slate-300 border-l-slate-200 shadow-sm">
          <div className="flex items-start gap-3 px-3 py-2.5">
            {isStudent
              ? <SkAvatar size={18} className="mt-0.5" delay={i * 80} />
              : <Sk className="flex-shrink-0 mt-0.5 w-[25px] h-[25px] rounded-lg" delay={i * 80} />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <SkText line="h-5" bar="h-3" className={i % 2 ? 'w-28' : 'w-44'} delay={i * 80 + 40} />
                <Sk className="h-[18px] w-12 !rounded-full" delay={i * 80 + 80} />
              </div>
              <SkText className={i % 2 ? 'w-1/2 mt-0.5' : 'w-3/4 mt-0.5'} delay={i * 80 + 120} />
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0 self-start">
              <SkText line="h-[15px]" bar="h-2" className="w-9" delay={i * 80 + 160} />
              {!isStudent && <Sk className="w-[25px] h-[25px] rounded-lg" delay={i * 80 + 200} />}
            </div>
          </div>
        </div>
      ))}
    </SkeletonRegion>
  )
}

// ── Assessments tab ───────────────────────────────────────────────────────────

const ASSESSMENT_TITLE_WIDTHS = ['w-36', 'w-48', 'w-28', 'w-40']

/** The Assessments tab: header, then assessment cards. Students see a score
 *  block on each card; staff see the edit/delete pair on the right. */
export function AssessmentListSkeleton({ isStaff = false, isStudent = false, count = 4 }: {
  isStaff?: boolean
  isStudent?: boolean
  count?: number
}) {
  return (
    <SkeletonRegion label="Loading assessments…" className="space-y-4">
      <TabHeaderSkeleton
        icon={<ClipboardList size={16} className="text-amber-600" />}
        chipClass="bg-amber-100"
        title="Assessments"
        actionWidth={isStaff ? 'w-[132px]' : undefined}
      />
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={`bg-white border rounded-2xl border-slate-200 ${CARD_SHADOW}`}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl flex-shrink-0 bg-slate-100">
                  <ClipboardList size={16} className="text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <SkText line="h-5" bar="h-3" className={ASSESSMENT_TITLE_WIDTHS[i % ASSESSMENT_TITLE_WIDTHS.length]} delay={i * 80} />
                    <Sk className="h-[18px] w-14 !rounded-full" delay={i * 80 + 40} />
                  </div>
                  <SkText className="w-24 mt-1" delay={i * 80 + 80} />
                  {isStudent && <ScoreBlockSkeleton delay={i * 80 + 120} />}
                </div>
                {isStaff && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Sk className="w-[25px] h-[25px] rounded-lg" delay={i * 80 + 120} />
                    <Sk className="w-[25px] h-[25px] rounded-lg" delay={i * 80 + 160} />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/** A student's score block on an assessment card, before their marks arrive. */
export function ScoreBlockSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div className="mt-2 flex items-center gap-2" aria-hidden>
      <Sk className="h-[42px] w-28 rounded-xl" delay={delay} />
      <Sk className="h-7 w-12 rounded-xl" delay={delay + 60} />
    </div>
  )
}

// ── Discussion tab ────────────────────────────────────────────────────────────

/** Message groups for the placeholder chat: how many lines each group holds,
 *  and how wide each line runs, so the stream reads as a conversation rather
 *  than a stack of identical bars. */
const CHAT_GROUPS: string[][] = [
  ['w-3/5'],
  ['w-4/5', 'w-2/5'],
  ['w-1/2'],
  ['w-11/12', 'w-3/4', 'w-1/3'],
  ['w-2/3'],
]
const CHAT_NAME_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-24']

/**
 * The Discussion tab: header, the chat card with a day divider and author
 * groups (avatar, name + time, one to three message lines), and — when the
 * tab itself is loading — the fixed composer, drawn as the empty input it is
 * about to become.
 */
export function DiscussionSkeleton({ withComposer = false }: { withComposer?: boolean }) {
  return (
    <SkeletonRegion label="Loading discussion…" className="relative pb-24">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-2 bg-teal-100 rounded-xl">
          <MessageSquare size={16} className="text-teal-600" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-800 text-sm leading-tight">Discussion</h2>
          <SkText line="h-[15px]" className="w-16" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-2.5 sm:px-3 py-3">
          {/* Day divider */}
          <div className="flex items-center gap-3 px-2 my-3">
            <div className="flex-1 h-px bg-slate-100" />
            <Sk className="h-2.5 w-16 !rounded-full" />
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          {CHAT_GROUPS.map((lines, g) => (
            <div key={g} className="flex items-start gap-3 px-2 pt-2.5 pb-1">
              <SkAvatar size={38} className="mt-0.5" delay={g * 90} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 h-[17.5px]">
                  <Sk className={`h-3 ${CHAT_NAME_WIDTHS[g]} !rounded-full`} delay={g * 90 + 30} />
                  <Sk className="h-2.5 w-16 !rounded-full" delay={g * 90 + 60} />
                </div>
                <div className="mt-0.5 space-y-0.5 pr-7">
                  {lines.map((w, l) => (
                    <SkText key={l} line="h-[21px]" bar="h-3" className={w} delay={g * 90 + 90 + l * 40} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {withComposer && (
        <div className="fixed inset-x-0 bottom-0 z-30 pointer-events-none">
          <div
            className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-2"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
          >
            <div
              className="rounded-3xl"
              style={{
                background: '#ffffff',
                boxShadow: '0 2px 16px -4px rgba(0,0,0,0.12), 0 0 0 1px rgba(148,163,184,0.16)',
              }}
            >
              <div className="px-3 pt-3 pb-3.5 flex items-end gap-2">
                <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center !rounded-full bg-slate-100 text-slate-300">
                  <Plus size={18} />
                </span>
                <div className="flex-1 min-w-0 bg-slate-50/90 border border-slate-200/70 !rounded-[22px] px-4 py-2">
                  <div className="h-[26px] flex items-center text-[15px] text-slate-400">Message…</div>
                </div>
                <span className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gradient-to-br from-teal-400 to-teal-600 text-white !rounded-full opacity-30">
                  <Send size={15} className="-translate-x-px" />
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </SkeletonRegion>
  )
}

// ── Popups ────────────────────────────────────────────────────────────────────

const NAME_WIDTHS = ['w-28', 'w-36', 'w-24', 'w-32', 'w-20', 'w-40']

/**
 * The student-progress popups' list (Content and Calendar tabs): avatar, name
 * and a trailing status pill per student, two columns from `sm` up — the same
 * grid and row height as the loaded list.
 */
export function StudentStatusRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Loading student progress…" className="grid sm:grid-cols-2 sm:gap-x-3">
      {Array.from({ length: rows }).map((_, i) => {
        // Top to bottom down each column, so the shimmer runs the way the
        // eye reads the list.
        const delay = Math.floor(i / 2) * 60 + (i % 2) * 30
        return (
          <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 border-b border-slate-50">
            <SkAvatar size={22} delay={delay} />
            <div className="flex-1 min-w-0">
              <SkText className={NAME_WIDTHS[i % NAME_WIDTHS.length]} delay={delay + 20} />
            </div>
            <Sk className="h-[19px] w-14 rounded flex-shrink-0" delay={delay + 40} />
          </div>
        )
      })}
    </SkeletonRegion>
  )
}

/** A document page — what the embedded document viewers show until the page
 *  inside them has loaded. */
function DocumentPageSkeleton({ className = '' }: { className?: string }) {
  const lines = ['w-2/5', 'w-full', 'w-11/12', 'w-full', 'w-3/4', 'w-full', 'w-5/6', 'w-2/3']
  return (
    <div className={`bg-white overflow-hidden ${className}`}>
      <SkeletonRegion label="Loading document…" className="max-w-2xl mx-auto px-6 py-8 space-y-3">
        {lines.map((w, i) => (
          <Sk key={i} className={`${i === 0 ? 'h-4 mb-4' : 'h-2.5'} ${w} !rounded-full`} delay={i * 70} />
        ))}
      </SkeletonRegion>
    </div>
  )
}

/**
 * An <iframe> that shows a document-page skeleton until its page has loaded.
 * The Google Docs viewer can take seconds to paint, and a blank white box for
 * that long reads as broken. Key it by `src` so a new document starts over.
 */
export function LoadingFrame({ className = '', frameClassName = '', ...frame }: React.IframeHTMLAttributes<HTMLIFrameElement> & {
  /** Classes for the wrapper, which sets the size and radius. */
  className?: string
  /** Extra classes for the iframe itself. */
  frameClassName?: string
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <iframe {...frame} onLoad={() => setLoaded(true)} className={`w-full h-full ${frameClassName}`} />
      {!loaded && <DocumentPageSkeleton className="absolute inset-0 pointer-events-none" />}
    </div>
  )
}

// ── Analysis tab ──────────────────────────────────────────────────────────────

/** The Analysis tab's panel surface, shared with the tab so the skeleton and
 *  the loaded panels are the same box. */
export const ANALYSIS_CARD = 'min-w-0 bg-white border border-slate-200/80 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.18)]'

function skDelay(i: number): React.CSSProperties {
  return { ['--sk-delay' as string]: `${i * 90}ms` }
}

export function AnalysisLeaderboardSkeleton({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="divide-y divide-slate-100">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2.5">
          <span className="skeleton skeleton-cool keep-round w-7 h-7 rounded-full flex-shrink-0" style={skDelay(i)} />
          <span className="skeleton skeleton-cool keep-round w-8 h-8 rounded-full flex-shrink-0" style={skDelay(i)} />
          <span className="flex-1 min-w-0 space-y-1.5">
            <span className="skeleton skeleton-cool block h-3 rounded-full" style={{ ...skDelay(i), width: `${60 - (i % 3) * 12}%` }} />
            <span className="skeleton skeleton-cool block h-1.5 rounded-full w-4/5" style={skDelay(i)} />
          </span>
          <span className="flex-shrink-0 space-y-1.5 flex flex-col items-end">
            <span className="skeleton skeleton-cool block h-3.5 w-10 rounded-full" style={skDelay(i)} />
            <span className="skeleton skeleton-cool block h-2.5 w-7 rounded-full" style={skDelay(i)} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function ChartSkeleton({ height, i }: { height: number; i: number }) {
  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-0 flex flex-col justify-between py-2">
        {Array.from({ length: 5 }, (_, k) => <span key={k} className="block h-px bg-slate-100" />)}
      </div>
      {/* .skeleton pins position: relative, so the wash sits in its own box */}
      <div className="absolute left-0 right-0 bottom-0 top-[30%]">
        <div className="skeleton skeleton-cool h-full w-full opacity-80" style={{ ...skDelay(i), clipPath: 'polygon(0 70%, 18% 45%, 36% 58%, 54% 25%, 72% 38%, 100% 8%, 100% 100%, 0 100%)' }} />
      </div>
    </div>
  )
}

function PanelHeaderSkeleton({ i }: { i: number }) {
  return (
    <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-slate-100">
      <span className="skeleton skeleton-cool keep-round w-8 h-8 rounded-full" style={skDelay(i)} />
      <span className="space-y-1.5 flex-1">
        <span className="skeleton skeleton-cool block h-3 w-32 rounded-full" style={skDelay(i)} />
        <span className="skeleton skeleton-cool block h-2.5 w-52 max-w-full rounded-full" style={skDelay(i)} />
      </span>
    </div>
  )
}

/** Mirrors the loaded tab: the focus pill, the two chart panels and the
 *  standings panel, so nothing moves when the data lands. */
export function AnalysisSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">Loading analysis…</span>
      <div className="skeleton skeleton-cool keep-round h-[42px] w-full sm:w-72 rounded-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={ANALYSIS_CARD}>
          <PanelHeaderSkeleton i={0} />
          <div className="p-3 sm:p-4"><ChartSkeleton height={240} i={1} /></div>
        </div>
        <div className={ANALYSIS_CARD}>
          <PanelHeaderSkeleton i={1} />
          <div className="p-3 sm:p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="skeleton skeleton-cool h-[62px] rounded-xl" style={skDelay(2)} />
              <div className="skeleton skeleton-cool h-[62px] rounded-xl" style={skDelay(3)} />
            </div>
            <ChartSkeleton height={170} i={3} />
          </div>
        </div>
      </div>
      <div className={ANALYSIS_CARD}>
        <div className="flex items-center gap-3 flex-wrap px-3 sm:px-4 py-3 border-b border-slate-100">
          <span className="skeleton skeleton-cool keep-round w-8 h-8 rounded-full" />
          <span className="space-y-1.5 flex-1 min-w-[12rem]">
            <span className="skeleton skeleton-cool block h-3 w-36 rounded-full" />
            <span className="skeleton skeleton-cool block h-2.5 w-44 rounded-full" />
          </span>
          <span className="skeleton skeleton-cool keep-round h-9 w-full sm:w-44 rounded-full" />
        </div>
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5 content-start">
            {[0, 1, 2].map(i => <div key={i} className="skeleton skeleton-cool h-[78px] rounded-xl" style={skDelay(i)} />)}
          </div>
          <div className="p-3 sm:p-4 border-t lg:border-t-0 lg:border-l border-slate-100">
            <div className="skeleton skeleton-cool keep-round h-8 w-56 rounded-full mb-2.5" />
            <AnalysisLeaderboardSkeleton rows={5} />
          </div>
        </div>
      </div>
    </div>
  )
}
