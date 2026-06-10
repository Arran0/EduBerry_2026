'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ClipboardList, Home, CheckCircle2, XCircle, Clock3, BookOpen, TrendingUp } from 'lucide-react'
import { ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import HomeroomPicker from '@/components/attendance/HomeroomPicker'
import AttendanceMarkSheet from '@/components/attendance/AttendanceMarkSheet'
import AttendanceCalendar from '@/components/attendance/AttendanceCalendar'
import AttendanceSummaryCard from '@/components/attendance/AttendanceSummary'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
import { fetchAttendanceSummary, AttendanceSummary } from '@/lib/attendance'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthLabel(year: number, month: number) {
  return new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function academicYearLabel() {
  const now = new Date()
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `AY ${y}–${String(y + 1).slice(-2)}`
}

// ─── Student View ─────────────────────────────────────────────────────────────

function StudentAttendanceView({ studentId }: { studentId: string }) {
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [loadingHomerooms, setLoadingHomerooms] = useState(true)
  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [monthlySummary, setMonthlySummary] = useState<AttendanceSummary | null>(null)
  const [yearlySummary, setYearlySummary] = useState<AttendanceSummary | null>(null)

  useEffect(() => {
    fetchHomeromsForStudent(studentId).then(data => {
      setHomerooms(data)
      if (data.length > 0) setSelectedHomeroomId(data[0].id)
      setLoadingHomerooms(false)
    })
  }, [studentId])

  // Month-specific summary — reloads whenever month or homeroom changes
  const loadMonthlySummary = useCallback(async () => {
    if (!selectedHomeroomId) return
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const s = await fetchAttendanceSummary(studentId, selectedHomeroomId, startDate, endDate)
    setMonthlySummary(s)
  }, [studentId, selectedHomeroomId, year, month])

  // Academic-year summary — reloads only when homeroom changes
  const loadYearlySummary = useCallback(async () => {
    if (!selectedHomeroomId) return
    const s = await fetchAttendanceSummary(studentId, selectedHomeroomId)
    setYearlySummary(s)
  }, [studentId, selectedHomeroomId])

  useEffect(() => { loadMonthlySummary() }, [loadMonthlySummary])
  useEffect(() => { loadYearlySummary() }, [loadYearlySummary])

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
  }, [])

  const handleHomeroomSelect = (id: string) => {
    setSelectedHomeroomId(id)
    setMonthlySummary(null)
    setYearlySummary(null)
  }

  if (loadingHomerooms) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
        <div className="spinner" />
        Loading…
      </div>
    )
  }

  if (homerooms.length === 0) {
    return (
      <div className="py-16 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <ClipboardList size={28} className="text-slate-300" />
        </div>
        <p className="text-sm font-semibold text-slate-600 mb-1">No homeroom assigned</p>
        <p className="text-xs text-slate-400">Contact your administrator to be added to a homeroom.</p>
      </div>
    )
  }

  const selectedHomeroom = homerooms.find(h => h.id === selectedHomeroomId)

  return (
    <div className="space-y-4">

      {/* ── Homeroom selector (multiple) ── */}
      {homerooms.length > 1 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 px-0.5">
            Your Homerooms
          </p>
          <div className="grid grid-cols-1 gap-2.5">
            {homerooms.map((hr: Homeroom) => {
              const active = selectedHomeroomId === hr.id
              return (
                <button
                  key={hr.id}
                  onClick={() => handleHomeroomSelect(hr.id)}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all duration-200 text-left ${
                    active
                      ? 'bg-gradient-to-r from-violet-600 to-purple-500 text-white border-transparent shadow-lg shadow-violet-200/60'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 hover:shadow-sm'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? 'bg-white/20' : 'bg-violet-100'}`}>
                    <Home size={18} className={active ? 'text-white' : 'text-violet-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`block font-bold text-sm ${active ? 'text-white' : 'text-slate-800'}`}>{hr.name}</span>
                    {(hr.grade || hr.section || hr.academic_year) && (
                      <span className={`block text-xs mt-0.5 font-medium ${active ? 'text-violet-200' : 'text-slate-400'}`}>
                        {hr.grade && hr.section ? `Grade ${hr.grade} · Section ${hr.section}` : hr.grade ? `Grade ${hr.grade}` : hr.section ?? ''}
                        {hr.academic_year ? (hr.grade || hr.section ? ` · AY ${hr.academic_year}` : `AY ${hr.academic_year}`) : ''}
                      </span>
                    )}
                  </div>
                  {active && (
                    <CheckCircle2 size={18} className="text-white/80 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : selectedHomeroom && (
        /* Single homeroom — context card */
        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-100 rounded-2xl">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Home size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-violet-800 text-sm">{selectedHomeroom.name}</p>
            {selectedHomeroom.grade && selectedHomeroom.section && (
              <p className="text-[10px] text-violet-500 font-medium">Grade {selectedHomeroom.grade} · Section {selectedHomeroom.section}</p>
            )}
          </div>
          {selectedHomeroom.academic_year && (
            <span className="text-[10px] px-2 py-1 rounded-lg bg-violet-100 text-violet-600 font-semibold flex-shrink-0">
              AY {selectedHomeroom.academic_year}
            </span>
          )}
        </div>
      )}

      {/* ── Yearly quick-stats bar ── */}
      {yearlySummary && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
            <TrendingUp size={13} className="text-violet-500" />
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Academic Year Overview</p>
          </div>
          <div className="grid grid-cols-4 divide-x divide-slate-100">
            {[
              { icon: CheckCircle2, label: 'Present', val: yearlySummary.present,  color: '#10b981', bg: '#ecfdf5' },
              { icon: XCircle,      label: 'Absent',  val: yearlySummary.absent,   color: '#f43f5e', bg: '#fff1f2' },
              { icon: Clock3,       label: 'Late',    val: yearlySummary.late,     color: '#f59e0b', bg: '#fffbeb' },
              { icon: BookOpen,     label: 'Leave',   val: yearlySummary.on_leave, color: '#0ea5e9', bg: '#f0f9ff' },
            ].map(({ icon: Icon, label, val, color, bg }) => (
              <div key={label} className="flex flex-col items-center gap-1 py-3 px-2">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-0.5" style={{ background: bg }}>
                  <Icon size={15} style={{ color }} />
                </div>
                <span className="text-xl font-extrabold text-slate-800 leading-none">{val}</span>
                <span className="text-[10px] font-medium text-slate-400">{label}</span>
              </div>
            ))}
          </div>
          {/* Percentage bar */}
          <div className="px-4 pb-3 pt-1 border-t border-slate-100">
            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1.5">
              <span className="font-medium">Attendance rate</span>
              <span className="font-bold text-violet-600">{yearlySummary.present_pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${yearlySummary.present_pct}%`,
                  background: yearlySummary.present_pct >= 85 ? '#10b981' : yearlySummary.present_pct >= 75 ? '#f59e0b' : '#f43f5e',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly calendar ── */}
      {selectedHomeroomId && (
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-0.5">Monthly Calendar</p>
          <AttendanceCalendar
            studentId={studentId}
            homeroomId={selectedHomeroomId}
            year={year}
            month={month}
            onMonthChange={handleMonthChange}
          />
        </div>
      )}

      {/* ── Summary cards — month + academic year side by side ── */}
      {(monthlySummary || yearlySummary) && (
        <div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-0.5">Detailed Breakdown</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {monthlySummary && (
              <AttendanceSummaryCard
                summary={monthlySummary}
                sublabel="This month"
                label={monthLabel(year, month)}
              />
            )}
            {yearlySummary && (
              <AttendanceSummaryCard
                summary={yearlySummary}
                sublabel="Academic year"
                label={academicYearLabel()}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Staff View ───────────────────────────────────────────────────────────────

function StaffAttendanceView({ staffId }: { staffId: string }) {
  const [activeHomeroom, setActiveHomeroom] = useState<Homeroom | null>(null)

  return (
    <div className="space-y-4">
      <HomeroomPicker
        currentStaffId={staffId}
        onSelect={hr => setActiveHomeroom(hr)}
      />

      <AnimatePresence>
        {activeHomeroom && (
          <motion.div
            key={activeHomeroom.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <AttendanceMarkSheet
              homeroomId={activeHomeroom.id}
              homeroomName={activeHomeroom.name}
              markedBy={staffId}
              onClose={() => setActiveHomeroom(null)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isStaff = profile ? isStaffRole(profile.role) : false

  return (
    <ProtectedLayout>
      <div data-page-theme="student-attendance">
        <PageBanner
          settingKey="attendance_banner"
          defaultBanner={ATTENDANCE_BANNER_DEFAULT}
          icon={<ClipboardList size={24} className="text-white" />}
          backgroundIcon={<ClipboardList size={180} className="text-white" />}
          title="Attendance"
          subtitle={isStaff ? 'Mark homeroom attendance sheets' : 'View your monthly attendance calendar'}
          isAdmin={isAdmin}
        />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          {isStaff && user ? (
            <StaffAttendanceView staffId={user.id} />
          ) : user ? (
            <StudentAttendanceView studentId={user.id} />
          ) : null}
        </div>
      </div>
    </ProtectedLayout>
  )
}
