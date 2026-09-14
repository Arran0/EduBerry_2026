'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { Award, ChevronRight, Clock, Search, UserRound } from 'lucide-react'
import {
  StudentReportCardEntry,
  fetchAvailableAcademicYearsForStudent,
  fetchReportCardsForStudent,
  fetchProfilesByIds,
} from '@/lib/classrooms'
import { UserProfile } from '@/lib/supabase'
import { getRecentReportCardStudentIds } from '@/lib/reportCardVisits'
import { gradeLetter } from '@/lib/reportCardGrading'
import { gradeLabel } from '@/lib/grades'
import Avatar from '@/components/Avatar'

interface ReportCardsDigestProps {
  userId: string
  isStudent: boolean
  /** Matches the classroom grid beside it, so the two columns end level. */
  height: number
  /** Applied to the height, so the panel grows in step with the grid's
   *  row-by-row reveal instead of snapping to full height on its own. */
  heightTransition?: string
}

/** One released report card of the signed-in student's most recent year. */
interface StudentCardRow {
  title: string
  subjects: number
  /** Null when nothing in the card is marked yet. */
  pct: number | null
  latestDate: number
}

/** A student whose report cards this staff account opened recently. */
interface RecentStudentRow {
  profile: UserProfile
}

/**
 * The compact report-card panel that sits beside the classroom grid on wide
 * screens. It is a digest, not the working surface: a student sees their own
 * latest cards, staff see the students they opened most recently, and both
 * lead into the full Report Cards section (or the student's academic record)
 * further down the page.
 */
export default function ReportCardsDigest({
  userId, isStudent, height, heightTransition,
}: ReportCardsDigestProps) {
  const [studentCards, setStudentCards] = useState<StudentCardRow[]>([])
  const [recent, setRecent] = useState<RecentStudentRow[]>([])
  const [year, setYear] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Student: their own latest-year report cards ──
  useEffect(() => {
    if (!isStudent) return
    let cancelled = false
    setLoading(true)
    fetchAvailableAcademicYearsForStudent(userId)
      .then(years => {
        if (cancelled) return undefined
        const latest = years[0] ?? null
        setYear(latest)
        return fetchReportCardsForStudent(userId, latest)
      })
      .then(map => {
        if (cancelled || !map) return
        const rows: StudentCardRow[] = Array.from(map.entries()).map(([title, entries]) => {
          let obtained = 0
          let max = 0
          for (const e of entries as StudentReportCardEntry[]) {
            if (e.mark && e.mark.marks != null) {
              obtained += Number(e.mark.marks)
              max += Number(e.mark.max_marks)
            }
          }
          return {
            title,
            subjects: new Set((entries as StudentReportCardEntry[]).map(e => e.classroom_id)).size,
            pct: max > 0 ? (obtained / max) * 100 : null,
            latestDate: Math.max(0, ...(entries as StudentReportCardEntry[]).map(
              e => e.assessment.date ? new Date(e.assessment.date).getTime() : 0,
            )),
          }
        }).sort((a, b) => b.latestDate - a.latestDate)
        setStudentCards(rows)
      })
      .catch(err => {
        console.error('Failed to load report card digest:', err)
        if (!cancelled) setStudentCards([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, isStudent])

  // ── Staff: the students whose cards they opened most recently ──
  useEffect(() => {
    if (isStudent) return
    let cancelled = false
    setLoading(true)
    const ids = getRecentReportCardStudentIds(userId)
    if (ids.length === 0) {
      setRecent([])
      setLoading(false)
      return
    }
    // One lookup for the whole list, and only the columns a row renders.
    fetchProfilesByIds(ids, 'id, full_name, email, avatar_url, grade, section, role')
      .then(byId => {
        if (cancelled) return
        // Keep the stored recency order, and drop ids that no longer resolve
        // (student removed, or no longer visible to this account).
        setRecent(ids.filter(id => byId[id]).map(id => ({ profile: byId[id] })))
      })
      .catch(err => {
        console.error('Failed to load recent report cards:', err)
        if (!cancelled) setRecent([])
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId, isStudent])

  const empty = isStudent ? studentCards.length === 0 : recent.length === 0

  return (
    <div
      className="glass-card rounded-[1.5rem] overflow-hidden flex flex-col"
      style={{ height, transition: heightTransition }}
    >
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="spinner" />
        </div>
      ) : empty ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center mb-3">
            {isStudent
              ? <Award size={22} className="text-slate-300" />
              : <Search size={22} className="text-slate-300" />}
          </div>
          <p className="text-sm font-medium text-slate-400">
            {isStudent ? 'No report cards yet' : 'No report cards opened yet'}
          </p>
          <p className="text-xs text-slate-400/80 mt-1">
            {isStudent
              ? (year ? `Nothing released for ${year}.` : 'Assessments tagged with a report card title appear here.')
              : 'Students you look up below show up here.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-hide divide-y divide-white/25">
          {isStudent
            ? studentCards.map(card => {
                const band = card.pct != null ? gradeLetter(card.pct) : null
                return (
                  <Link
                    key={card.title}
                    href="/academics?section=reportcards"
                    className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70 focus-visible:ring-inset"
                  >
                    <div className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/45 transition-colors group cursor-pointer">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-rose-500" />
                      <div className="flex-1 min-w-0">
                        <h4
                          title={card.title}
                          className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors"
                        >
                          {card.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 truncate tabular-nums">
                          {card.subjects} subject{card.subjects === 1 ? '' : 's'}
                          {card.pct != null && ` · ${card.pct.toFixed(1)}%`}
                        </p>
                      </div>
                      {band && (
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold tabular-nums flex-shrink-0 ${band.bg} ${band.fg}`}>
                          {band.letter}
                        </span>
                      )}
                      <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                )
              })
            : recent.map(({ profile }) => (
                <Link
                  key={profile.id}
                  href={`/academic-record/${profile.id}`}
                  className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/70 focus-visible:ring-inset"
                >
                  <div className="flex items-center gap-3 px-5 py-2.5 hover:bg-white/45 transition-colors group cursor-pointer">
                    <Avatar avatarUrl={profile.avatar_url} name={profile.full_name} size={30} userId={profile.id} />
                    <div className="flex-1 min-w-0">
                      <h4
                        title={profile.full_name}
                        className="font-semibold text-slate-800 text-sm truncate group-hover:text-slate-900 transition-colors"
                      >
                        {profile.full_name}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate">
                        {profile.grade != null || profile.section
                          // gradeLabel, not `Grade ${n}`: pre-primary grades are
                          // stored negative (-1 is UKG, not "Grade -1").
                          ? [profile.grade != null ? gradeLabel(profile.grade) : null, profile.section]
                              .filter(Boolean).join(' · ')
                          : profile.email}
                      </p>
                    </div>
                    <ChevronRight size={14} className="flex-shrink-0 text-slate-300 transition-all duration-200 group-hover:text-slate-500 group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
        </div>
      )}

      {/* Footer rail — names what the list is, and points at the full section. */}
      {!loading && !empty && (
        <div className="flex items-center gap-1.5 px-5 py-2 border-t border-white/30 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          {isStudent ? <Award size={11} /> : <Clock size={11} />}
          {isStudent ? (year ?? 'Latest') : 'Recently opened'}
          <span className="flex-1" />
          {!isStudent && <UserRound size={11} />}
        </div>
      )}
    </div>
  )
}
