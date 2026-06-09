'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ClipboardList, Home } from 'lucide-react'
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
        <ClipboardList size={36} className="text-slate-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-500">No homeroom assigned</p>
        <p className="text-xs text-slate-400 mt-1">Contact your administrator to be added to a homeroom.</p>
      </div>
    )
  }

  const selectedHomeroom = homerooms.find(h => h.id === selectedHomeroomId)

  return (
    <div className="space-y-4">

      {/* ── Homeroom selector ── */}
      {homerooms.length > 1 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
            Your Homerooms
          </p>
          <div className="flex flex-wrap gap-2">
            {homerooms.map((hr: Homeroom) => (
              <button
                key={hr.id}
                onClick={() => handleHomeroomSelect(hr.id)}
                className={`flex flex-col items-start px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                  selectedHomeroomId === hr.id
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
                }`}
              >
                <span className="font-semibold">{hr.name}</span>
                {hr.academic_year && (
                  <span className={`text-[10px] mt-0.5 ${selectedHomeroomId === hr.id ? 'text-violet-200' : 'text-slate-400'}`}>
                    AY {hr.academic_year}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : selectedHomeroom && (
        /* Single homeroom — show as non-interactive context chip */
        <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-100 rounded-xl text-sm">
          <Home size={14} className="text-violet-400 flex-shrink-0" />
          <span className="font-semibold text-violet-800">{selectedHomeroom.name}</span>
          {selectedHomeroom.grade && selectedHomeroom.section && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">
              Gr.{selectedHomeroom.grade} {selectedHomeroom.section}
            </span>
          )}
          {selectedHomeroom.academic_year && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-medium ml-auto">
              AY {selectedHomeroom.academic_year}
            </span>
          )}
        </div>
      )}

      {/* ── Monthly calendar ── */}
      {selectedHomeroomId && (
        <AttendanceCalendar
          studentId={studentId}
          homeroomId={selectedHomeroomId}
          year={year}
          month={month}
          onMonthChange={handleMonthChange}
        />
      )}

      {/* ── Summary cards — month + academic year side by side ── */}
      {(monthlySummary || yearlySummary) && (
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
      <PageBanner
        settingKey="attendance_banner"
        defaultBanner={ATTENDANCE_BANNER_DEFAULT}
        icon={<ClipboardList size={24} className="text-white" />}
        backgroundIcon={<ClipboardList size={180} className="text-white" />}
        title="Attendance"
        subtitle={isStaff ? 'Mark homeroom attendance sheets' : 'View your monthly attendance calendar'}
        isAdmin={isAdmin}
      />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {isStaff && user ? (
          <StaffAttendanceView staffId={user.id} />
        ) : user ? (
          <StudentAttendanceView studentId={user.id} />
        ) : null}
      </div>
    </ProtectedLayout>
  )
}
