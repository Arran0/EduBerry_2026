'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Megaphone } from 'lucide-react'
import AnnouncementsList from '@/components/announcements/AnnouncementsList'
import { fetchTeamsForUser, fetchAllTeams } from '@/lib/announcements'

// Team-name → grade range mapping (must match how teams are seeded in the DB)
const TEAM_GRADE_MAP: Record<string, number[]> = {
  'a': [1, 2, 3, 4, 5],
  'b': [6, 7, 8],
  'c': [9, 10, 11, 12],
}

function gradesForTeamName(name: string): number[] {
  const lower = name.toLowerCase()
  for (const [key, grades] of Object.entries(TEAM_GRADE_MAP)) {
    if (lower.includes(`team ${key}`) || lower === key) return grades
  }
  return []
}

export default function AnnouncementsPage() {
  const { user, profile } = useAuth()

  const [userTeams, setUserTeams] = useState<{ id: string; name: string }[]>([])
  const [allTeams,  setAllTeams]  = useState<{ id: string; name: string }[]>([])
  const [teamsLoaded, setTeamsLoaded] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)

  const canCreate = profile ? ['coordinator', 'principal', 'admin'].includes(profile.role) : false

  const loadTeams = useCallback(async () => {
    if (!user || !profile) return

    const tasks: Promise<void>[] = []

    // Coordinator: load their own teams (for audience picker + grade limit)
    if (profile.role === 'coordinator') {
      tasks.push(fetchTeamsForUser(user.id).then(setUserTeams))
    }

    // Principal / Admin: load all teams (full audience picker)
    if (profile.role === 'principal' || profile.role === 'admin') {
      tasks.push(fetchAllTeams().then(setAllTeams))
    }

    await Promise.all(tasks)
    setTeamsLoaded(true)
  }, [user, profile])

  useEffect(() => { loadTeams() }, [loadTeams])

  // Compute grade ranges per team for the coordinator's grade picker
  const teamGradeRanges = useMemo(() => {
    const teams = [...userTeams, ...allTeams]
    const unique = Array.from(new Map(teams.map(t => [t.id, t])).values())
    return unique
      .map(team => ({ teamId: team.id, grades: gradesForTeamName(team.name) }))
      .filter(r => r.grades.length > 0)
  }, [userTeams, allTeams])

  if (!user || !profile) return null

  // Students and teachers don't need teams to load — show immediately
  const waitForTeams = ['coordinator', 'principal', 'admin'].includes(profile.role)

  return (
    <ProtectedLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-page-theme="announcements">
        {/* Immersive header banner */}
        <div className="relative mb-8 rounded-2xl overflow-hidden">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600" />
          {/* Radial light highlight */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.18),transparent_60%)]" />
          {/* Decorative large icon */}
          <div className="absolute -bottom-4 -right-4 opacity-[0.07] pointer-events-none">
            <Megaphone size={160} className="text-white" />
          </div>

          <div className="relative flex items-center justify-between gap-4 px-6 py-6 sm:px-8 sm:py-7">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 backdrop-blur-sm rounded-2xl border border-white/20 flex-shrink-0">
                <Megaphone size={24} className="text-white" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
                  Announcements
                </h1>
                <p className="text-violet-200 text-sm mt-0.5">Stay updated with the latest news</p>
              </div>
            </div>
            {canCreate && (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-white text-violet-700 font-semibold rounded-xl text-sm hover:bg-violet-50 transition-colors shadow-lg flex-shrink-0"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">New Announcement</span>
                <span className="sm:hidden">New</span>
              </button>
            )}
          </div>
        </div>

        {waitForTeams && !teamsLoaded ? (
          <div className="text-center py-12">
            <div className="spinner mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading...</p>
          </div>
        ) : (
          <AnnouncementsList
            userId={user.id}
            userRole={profile.role}
            userGrade={profile.grade}
            userSection={profile.section}
            userTeams={userTeams}
            allTeams={allTeams}
            teamGradeRanges={teamGradeRanges}
            showNewForm={showNewForm}
            onNewFormChange={setShowNewForm}
          />
        )}
      </div>
    </ProtectedLayout>
  )
}
