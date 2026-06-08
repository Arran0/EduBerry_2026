'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ProtectedLayout from '@/components/ProtectedLayout'
import PageBanner from '@/components/PageBanner'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole } from '@/lib/supabase'
import { ClipboardList } from 'lucide-react'
import { ATTENDANCE_BANNER_DEFAULT } from '@/lib/pageConfig'
import HomeroomPicker from '@/components/attendance/HomeroomPicker'
import AttendanceMarkSheet from '@/components/attendance/AttendanceMarkSheet'
import AttendanceCalendar from '@/components/attendance/AttendanceCalendar'
import AttendanceSummaryCard from '@/components/attendance/AttendanceSummary'
import { Homeroom, fetchHomeromsForStudent } from '@/lib/homerooms'
import { fetchAttendanceSummary, AttendanceSummary } from '@/lib/attendance'

// ─── Student View ─────────────────────────────────────────────────────────────

function StudentAttendanceView({ studentId }: { studentId: string }) {
  const [homerooms, setHomerooms] = useState<Homeroom[]>([])
  const [loadingHomerooms, setLoadingHomerooms] = useState(true)
  const [selectedHomeroomId, setSelectedHomeroomId] = useState<string | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth() + 1)
  const [summary, setSummary] = useState<AttendanceSummary | null>(null)

  useEffect(() => {
    fetchHomeromsForStudent(studentId).then(data => {
      setHomerooms(data)
      if (data.length > 0) setSelectedHomeroomId(data[0].id)
      setLoadingHomerooms(false)
    })
  }, [studentId])

  const loadSummary = useCallback(async () => {
    if (!selectedHomeroomId) return
    const s = await fetchAttendanceSummary(studentId, selectedHomeroomId)
    setSummary(s)
  }, [studentId, selectedHomeroomId])

  useEffect(() => { loadSummary() }, [loadSummary])

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

  return (
    <div className="space-y-4">
      {/* Homeroom toggle — only if multiple */}
      {homerooms.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {homerooms.map((hr: Homeroom) => (
            <button
              key={hr.id}
              onClick={() => setSelectedHomeroomId(hr.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                selectedHomeroomId === hr.id
                  ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
              }`}
            >
              {hr.name}
            </button>
          ))}
        </div>
      )}

      {selectedHomeroomId && (
        <>
          <AttendanceCalendar
            studentId={studentId}
            homeroomId={selectedHomeroomId}
            year={year}
            month={month}
            onMonthChange={(y, m) => { setYear(y); setMonth(m) }}
          />
          {summary && <AttendanceSummaryCard summary={summary} />}
        </>
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
