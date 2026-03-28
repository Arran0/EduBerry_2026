'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BookOpen, ChevronDown, Users, Check, Loader2, Download,
  Award, GraduationCap, Pencil, Image as ImageIcon, X, CalendarDays,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { usePageConfig } from '@/contexts/PageConfigContext'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { isStaffRole, UserProfile } from '@/lib/supabase'
import {
  ClassroomWithDetails, fetchClassroomsForUser,
  fetchAssessments, ClassroomAssessment,
  fetchAssessmentMarks, AssessmentMark,
  fetchStudentMembers, upsertAssessmentMark,
} from '@/lib/classrooms'
import SchoolWorkManager from '@/components/classrooms/SchoolWorkManager'
import {
  AnnouncementBannerConfig,
  ACADEMICS_BANNER_DEFAULT,
  BANNER_PRESETS,
  fetchAcademicsBannerConfig,
  saveAcademicsBannerConfig,
  uploadSiteAsset,
} from '@/lib/pageConfig'

interface GradeData {
  classroom: ClassroomWithDetails
  assessments: (ClassroomAssessment & { marks: AssessmentMark[] })[]
  students: UserProfile[]
}

export default function AcademicsPage() {
  const { user, profile } = useAuth()
  const { pageIcons: pageConfig } = usePageConfig()
  const [classrooms, setClassrooms] = useState<ClassroomWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  // Scores section
  const [scoresExpanded, setScoresExpanded]   = useState(false)
  const [gradeData, setGradeData]             = useState<GradeData[]>([])
  const [gradesLoading, setGradesLoading]     = useState(false)
  const [gradesLoaded, setGradesLoaded]       = useState(false)
  const [expandedAssessment, setExpandedAssessment] = useState<string | null>(null)

  // Banner config state
  const [bannerCfg,     setBannerCfg]     = useState<AnnouncementBannerConfig>(ACADEMICS_BANNER_DEFAULT)
  const [pendingCfg,    setPendingCfg]    = useState<AnnouncementBannerConfig>(ACADEMICS_BANNER_DEFAULT)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner,  setSavingBanner]  = useState(false)
  const [uploadingImg,  setUploadingImg]  = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const isStudent = profile?.role === 'student'
  const isStaff   = profile ? isStaffRole(profile.role) : false
  const isAdmin   = profile?.role === 'admin'

  const loadClassrooms = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    try {
      const enrolled = await fetchClassroomsForUser(user.id, profile.role)
      setClassrooms(enrolled)
    } catch (error) {
      console.error('Failed to load classrooms:', error)
      setClassrooms([])
    } finally {
      setLoading(false)
    }
  }, [user, profile])

  const loadGrades = useCallback(async () => {
    if (!user || !profile || gradesLoaded || gradesLoading) return
    setGradesLoading(true)
    try {
      const rooms = await fetchClassroomsForUser(user.id, profile.role)
      const data: GradeData[] = []
      for (const room of rooms) {
        const assessments = await fetchAssessments(room.id)
        const main = assessments.filter(a => a.tag === 'main')
        const [withMarks, studentMembers] = await Promise.all([
          Promise.all(main.map(async a => ({ ...a, marks: await fetchAssessmentMarks(a.id) }))),
          fetchStudentMembers(room.id),
        ])
        if (withMarks.length > 0) data.push({
          classroom: room,
          assessments: withMarks,
          students: studentMembers.map(m => m.user),
        })
      }
      setGradeData(data)
      setGradesLoaded(true)
    } catch (err) {
      console.error('Failed to load grades:', err)
    }
    setGradesLoading(false)
  }, [user, profile, gradesLoaded, gradesLoading])

  useEffect(() => {
    loadClassrooms()
  }, [loadClassrooms])

  useEffect(() => {
    fetchAcademicsBannerConfig().then(cfg => {
      setBannerCfg(cfg)
      setPendingCfg(cfg)
    })
  }, [])

  // Lazy-load grades when section is first expanded
  useEffect(() => {
    if (scoresExpanded && !gradesLoaded) {
      loadGrades()
    }
  }, [scoresExpanded, gradesLoaded, loadGrades])

  // Banner editor handlers
  const openEditor = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(true) }
  const cancelEdit = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(false) }
  const saveEdit = async () => {
    setSavingBanner(true)
    await saveAcademicsBannerConfig(pendingCfg)
    setBannerCfg({ ...pendingCfg })
    setSavingBanner(false)
    setEditingBanner(false)
  }
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImg(true)
    const url = await uploadSiteAsset(file, 'academics_banner')
    if (url) setPendingCfg(prev => ({ ...prev, imageUrl: url }))
    setUploadingImg(false)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const activeCfg = editingBanner ? pendingCfg : bannerCfg
  const bannerBg: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)` }

  if (!user || !profile) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="academics">

        {/* ── Immersive full-bleed banner ── */}
        <div className="relative overflow-hidden" style={bannerBg}>
          {activeCfg.imageUrl && (
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/20" />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />

          {/* Decorative background icon */}
          <div className="absolute -bottom-6 -right-6 opacity-[0.07] pointer-events-none select-none">
            <GraduationCap size={180} className="text-white" />
          </div>

          {/* Bottom fade */}
          <div
            className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
            style={{ background: 'linear-gradient(to bottom, transparent, rgba(248,250,252,0.5))' }}
          />

          {/* Admin edit pencil */}
          {isAdmin && !editingBanner && (
            <button
              onClick={openEditor}
              className="absolute top-3 right-3 p-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg border border-white/20 text-white transition-colors z-10"
              title="Customise banner"
            >
              <Pencil size={14} />
            </button>
          )}

          {/* Main header */}
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 backdrop-blur-sm rounded-2xl border border-white/20 flex-shrink-0">
                <GraduationCap size={24} className="text-white" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
                  Academics
                </h1>
                <p className="hidden sm:block text-white/60 text-sm mt-0.5">
                  {isStudent
                    ? 'Your classrooms, school work and grades in one place.'
                    : 'Access your classrooms and grade data in one place.'}
                </p>
              </div>
            </div>
          </div>

          {/* Inline banner editor (admin only) */}
          <AnimatePresence>
            {editingBanner && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden border-t border-white/20 bg-black/30 backdrop-blur-md"
              >
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                  <p className="text-white/70 text-[11px] font-semibold uppercase tracking-widest mb-3">
                    Banner Style
                  </p>
                  <div className="flex flex-wrap items-center gap-2.5">
                    {BANNER_PRESETS.map(p => {
                      const active = !pendingCfg.imageUrl &&
                        pendingCfg.gradFrom === p.from &&
                        pendingCfg.gradTo   === p.to
                      return (
                        <button
                          key={p.label}
                          title={p.label}
                          onClick={() => setPendingCfg({ gradFrom: p.from, gradTo: p.to, imageUrl: '' })}
                          className={`w-8 h-8 rounded-full border-2 transition-all duration-150 flex-shrink-0 ${
                            active ? 'border-white scale-110 shadow-lg' : 'border-white/30 hover:border-white/70 hover:scale-105'
                          }`}
                          style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                        />
                      )
                    })}
                    <div className="w-px h-6 bg-white/25 mx-1" />
                    <label
                      className={`flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold rounded-full border border-white/25 cursor-pointer transition-colors flex-shrink-0 ${uploadingImg ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <ImageIcon size={13} />
                      {uploadingImg ? 'Uploading…' : 'Image'}
                      <input ref={imageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleImageUpload} />
                    </label>
                    {pendingCfg.imageUrl && (
                      <button
                        onClick={() => setPendingCfg(prev => ({ ...prev, imageUrl: '' }))}
                        className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium rounded-full border border-white/15 transition-colors flex-shrink-0"
                      >
                        <X size={11} /> Remove image
                      </button>
                    )}
                    <div className="flex-1" />
                    <button onClick={cancelEdit} className="px-3 py-1.5 text-white/70 hover:text-white text-xs font-semibold rounded-full border border-white/20 hover:bg-white/10 transition-colors flex-shrink-0">
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={savingBanner}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-700 text-xs font-bold rounded-full hover:bg-slate-50 transition-colors disabled:opacity-60 flex-shrink-0 shadow-md"
                    >
                      <Check size={12} />
                      {savingBanner ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Page content ── */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">

          {/* Classrooms */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-cyan-600" />
              <h2 className="font-semibold text-slate-700 text-sm">My Classrooms</h2>
            </div>

            {loading ? (
              <p className="text-sm text-slate-500">Loading classrooms…</p>
            ) : classrooms.length === 0 ? (
              <p className="text-sm text-slate-500">You are not enrolled in any classrooms yet.</p>
            ) : (() => {
              const palettes = [
                { grad: 'from-cyan-500 to-teal-600',     shadow: '0 4px 16px rgba(6,182,212,0.4)'   },
                { grad: 'from-violet-500 to-purple-700', shadow: '0 4px 16px rgba(139,92,246,0.4)'  },
                { grad: 'from-rose-500 to-pink-600',     shadow: '0 4px 16px rgba(244,63,94,0.4)'   },
                { grad: 'from-amber-500 to-orange-600',  shadow: '0 4px 16px rgba(245,158,11,0.4)'  },
                { grad: 'from-emerald-500 to-teal-700',  shadow: '0 4px 16px rgba(16,185,129,0.4)'  },
                { grad: 'from-blue-500 to-indigo-700',   shadow: '0 4px 16px rgba(59,130,246,0.4)'  },
              ]
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {classrooms.map((classroom, i) => {
                    const p = palettes[i % palettes.length]
                    return (
                      <Link key={classroom.id} href={`/classrooms/${classroom.id}`}>
                        <div
                          className={`relative h-[56px] rounded-lg overflow-hidden bg-gradient-to-br ${p.grad} opacity-80 hover:opacity-100 group cursor-pointer transition-all duration-200 hover:scale-[1.02]`}
                          style={{ boxShadow: p.shadow }}
                        >
                          {classroom.banner_url ? (
                            <img src={classroom.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          ) : (
                            <svg className="absolute inset-0 w-full h-full opacity-[0.08]" xmlns="http://www.w3.org/2000/svg">
                              <defs>
                                <pattern id={`ag-${i}`} x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                                  <circle cx="1.5" cy="1.5" r="1" fill="white" />
                                </pattern>
                              </defs>
                              <rect width="100%" height="100%" fill={`url(#ag-${i})`} />
                            </svg>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                          <div className="absolute inset-0 px-3 flex items-end pb-2">
                            <p
                              className="font-semibold text-white text-[12px] leading-tight line-clamp-1"
                              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
                            >{classroom.title}</p>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )
            })()}
          </section>

          {/* My School Work Manager — students only */}
          {isStudent && (
            <section className="glass rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-slate-100/80">
                <div className="p-1.5 bg-cyan-100 rounded-lg">
                  <CalendarDays size={14} className="text-cyan-600" />
                </div>
                <h2 className="font-semibold text-slate-700 text-sm">My School Work Manager</h2>
              </div>
              <div className="p-4">
                {loading ? (
                  <p className="text-sm text-slate-500">Loading…</p>
                ) : (
                  <SchoolWorkManager classrooms={classrooms} userId={user.id} />
                )}
              </div>
            </section>
          )}

          {/* My Scores / Scores — expandable */}
          <section className="glass rounded-2xl overflow-hidden">
            <button
              onClick={() => setScoresExpanded(prev => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/60 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-amber-100 rounded-lg">
                  <Award size={14} className="text-amber-600" />
                </div>
                <h2 className="font-semibold text-slate-700 text-sm">
                  {isStudent ? 'My Scores' : 'Scores'}
                </h2>
                <span className="text-xs text-slate-400 font-normal">· Main scoresheet results</span>
              </div>
              <ChevronDown
                size={18}
                className={`text-slate-400 transition-transform ${scoresExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {scoresExpanded && (
              <div className="border-t border-slate-100 px-4 py-3">
                {gradesLoading ? (
                  <div className="text-center py-8">
                    <div className="spinner mx-auto mb-3" />
                    <p className="text-sm text-slate-500">Loading scores…</p>
                  </div>
                ) : gradeData.length === 0 ? (
                  <div className="text-center py-8">
                    <Award size={32} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">No grade data available yet</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {gradeData.map(({ classroom, assessments, students }) => (
                      <div key={classroom.id} className="rounded-xl overflow-hidden border border-slate-100">
                        <div className="p-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center gap-2">
                          <BookOpen size={16} className="text-amber-600" />
                          <span className="font-semibold text-slate-800 text-sm">{classroom.title}</span>
                          {isStaff && (
                            <span className="ml-auto text-xs text-amber-600 flex items-center gap-1">
                              <Users size={12} /> {students.length} students
                            </span>
                          )}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-50">
                                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Scoresheet</th>
                                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Date</th>
                                {isStudent && (
                                  <>
                                    <th className="text-center px-4 py-2.5 font-medium text-slate-600">Marks</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-slate-600">Max</th>
                                    <th className="text-center px-4 py-2.5 font-medium text-slate-600">%</th>
                                  </>
                                )}
                                {isStaff && (
                                  <th className="text-center px-4 py-2.5 font-medium text-slate-600">Graded</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {assessments.map(assessment => {
                                const myMark = assessment.marks.find(m => m.student_id === user.id)
                                const pct    = myMark && myMark.marks != null
                                  ? Math.round((myMark.marks / myMark.max_marks) * 100)
                                  : null
                                const isExpanded = expandedAssessment === assessment.id

                                return (
                                  <React.Fragment key={assessment.id}>
                                    <tr
                                      className={`border-t border-slate-100 hover:bg-slate-50/50 ${isStaff ? 'cursor-pointer' : ''}`}
                                      onClick={() => isStaff && setExpandedAssessment(isExpanded ? null : assessment.id)}
                                    >
                                      <td className="px-4 py-2.5">
                                        <p className="font-medium text-slate-800">{assessment.title}</p>
                                        {assessment.description && (
                                          <p className="text-xs text-slate-500">{assessment.description}</p>
                                        )}
                                      </td>
                                      <td className="px-4 py-2.5 text-slate-600">
                                        {assessment.date
                                          ? new Date(assessment.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                          : '-'}
                                      </td>
                                      {isStudent && (
                                        <>
                                          <td className="px-4 py-2.5 text-center font-semibold text-slate-800">
                                            {myMark?.marks != null ? myMark.marks : '-'}
                                          </td>
                                          <td className="px-4 py-2.5 text-center text-slate-600">
                                            {myMark?.max_marks || '-'}
                                          </td>
                                          <td className="px-4 py-2.5 text-center">
                                            {pct != null ? (
                                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                                pct >= 80 ? 'bg-green-100 text-green-700' :
                                                pct >= 60 ? 'bg-amber-100 text-amber-700' :
                                                'bg-red-100 text-red-700'
                                              }`}>
                                                {pct}%
                                              </span>
                                            ) : '-'}
                                          </td>
                                        </>
                                      )}
                                      {isStaff && (
                                        <td className="px-4 py-2.5 text-center">
                                          <div className="flex items-center justify-center gap-1.5">
                                            <span className="text-slate-600">
                                              {assessment.marks.filter(m => m.marks != null).length} / {students.length}
                                            </span>
                                            <ChevronDown
                                              size={14}
                                              className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                            />
                                          </div>
                                        </td>
                                      )}
                                    </tr>

                                    {/* Inline Marksheet Editor for staff */}
                                    {isStaff && isExpanded && (
                                      <tr>
                                        <td colSpan={3} className="p-0 border-t border-amber-100">
                                          <MarksheetEditor
                                            assessment={assessment}
                                            students={students}
                                          />
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </ProtectedLayout>
  )
}

// ─── Marksheet Editor ─────────────────────────────────────────────────────────

function MarksheetEditor({
  assessment,
  students,
}: {
  assessment: ClassroomAssessment & { marks: AssessmentMark[] }
  students: UserProfile[]
}) {
  const defaultMax = assessment.marks.length > 0 ? (assessment.marks[0].max_marks ?? 100) : 100
  const [maxMarks, setMaxMarks] = useState<number>(defaultMax)
  const [markValues, setMarkValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const m of assessment.marks) {
      if (m.marks != null) init[m.student_id] = String(m.marks)
    }
    return init
  })
  const [saving, setSaving]   = useState<Set<string>>(new Set())
  const [saved, setSaved]     = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const importRef = React.useRef<HTMLInputElement>(null)

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim())
      if (lines.length < 2) { setImporting(false); return }
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase())
      const nameIdx  = headers.findIndex(h => h.includes('student') || h.includes('name'))
      const markIdx  = headers.findIndex(h => h.includes('mark'))
      if (nameIdx === -1 || markIdx === -1) {
        alert('CSV must have "Student" and "Marks" columns.')
        setImporting(false)
        return
      }
      const parsed: Record<string, string> = {}
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim())
        const name  = cols[nameIdx] ?? ''
        const mark  = cols[markIdx] ?? ''
        const student = students.find(s =>
          s.full_name.toLowerCase() === name.toLowerCase()
        )
        if (student && mark !== '') parsed[student.id] = mark
      }
      setMarkValues(prev => ({ ...prev, ...parsed }))
      setImporting(false)
      if (importRef.current) importRef.current.value = ''
    }
    reader.readAsText(file)
  }

  const handleDownload = () => {
    const rows: string[][] = [
      ['Student', 'Marks', `Out of ${maxMarks}`, 'Percentage'],
    ]
    for (const student of students) {
      const val = markValues[student.id] ?? ''
      const num = val !== '' ? Number(val) : null
      const pct = num != null && !isNaN(num) ? `${Math.round((num / maxMarks) * 100)}%` : ''
      rows.push([student.full_name, val, String(maxMarks), pct])
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${assessment.title.replace(/[^a-z0-9]/gi, '_')}_marksheet.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSave = async (studentId: string) => {
    const raw = markValues[studentId]
    const parsed = raw === '' || raw === undefined ? null : Number(raw)
    if (raw !== '' && raw !== undefined && isNaN(parsed!)) return
    setSaving(s => new Set([...s, studentId]))
    await upsertAssessmentMark(assessment.id, studentId, parsed, maxMarks)
    setSaving(s => { const n = new Set(s); n.delete(studentId); return n })
    setSaved(s => new Set([...s, studentId]))
    setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(studentId); return n }), 2000)
  }

  return (
    <div className="bg-amber-50/40 p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-semibold text-amber-700">Marksheet — {assessment.title}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <label
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors cursor-pointer"
            title="Import from CSV"
          >
            {importing ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} className="rotate-180" />} Import
            <input
              ref={importRef}
              type="file"
              accept=".csv,.xls,.xlsx,text/csv"
              className="hidden"
              onChange={handleImport}
            />
          </label>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 text-xs font-medium transition-colors"
            title="Download as Excel (CSV)"
          >
            <Download size={11} /> Export
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Out of</span>
          <input
            type="number"
            value={maxMarks}
            onChange={e => setMaxMarks(Number(e.target.value))}
            className="w-16 border border-amber-200 rounded-lg px-2 py-0.5 text-xs text-center bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
            min={1}
          />
        </div>
      </div>

      {students.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-3">No students enrolled</p>
      ) : (
        <div className="space-y-1.5">
          {students.map(student => {
            const val = markValues[student.id] ?? ''
            const num = val !== '' ? Number(val) : null
            const pct = num != null && !isNaN(num) ? Math.round((num / maxMarks) * 100) : null

            return (
              <div key={student.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 border border-slate-100 shadow-sm">
                <span className="flex-1 text-sm font-medium text-slate-700 truncate">{student.full_name}</span>
                <input
                  type="number"
                  value={val}
                  onChange={e => setMarkValues(prev => ({ ...prev, [student.id]: e.target.value }))}
                  onBlur={() => handleSave(student.id)}
                  onKeyDown={e => e.key === 'Enter' && handleSave(student.id)}
                  placeholder="—"
                  className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400/50 bg-white"
                  min={0}
                  max={maxMarks}
                />
                <span className="text-xs text-slate-400 w-8 text-center">/{maxMarks}</span>
                {pct != null ? (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium w-12 text-center ${
                    pct >= 80 ? 'bg-green-100 text-green-700' :
                    pct >= 60 ? 'bg-amber-100 text-amber-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {pct}%
                  </span>
                ) : <span className="w-12" />}
                <span className="w-5 text-center">
                  {saving.has(student.id) ? (
                    <Loader2 size={12} className="animate-spin text-slate-400" />
                  ) : saved.has(student.id) ? (
                    <Check size={12} className="text-green-500" />
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
