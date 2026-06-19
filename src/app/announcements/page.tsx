'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Megaphone, Pencil, Check, X, Image as ImageIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import AnnouncementsList from '@/components/announcements/AnnouncementsList'
import { fetchTeamsForUser, fetchAllTeams } from '@/lib/announcements'
import {
  AnnouncementBannerConfig,
  BANNER_DEFAULT,
  BANNER_PRESETS,
  fetchBannerConfig,
  saveBannerConfig,
  uploadSiteAsset,
} from '@/lib/pageConfig'
import { hexToLuminance, sampleImageLuminance } from '@/lib/luminance'

// ── Team → grade mapping ──────────────────────────────────────────────────────

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

// ── Page component ────────────────────────────────────────────────────────────

export default function AnnouncementsPage() {
  const { user, profile } = useAuth()

  const [userTeams,   setUserTeams]   = useState<{ id: string; name: string }[]>([])
  const [allTeams,    setAllTeams]    = useState<{ id: string; name: string }[]>([])
  const [showNewForm, setShowNewForm] = useState(false)

  // Banner config state
  const [bannerCfg,     setBannerCfg]     = useState<AnnouncementBannerConfig>(BANNER_DEFAULT)
  const [pendingCfg,    setPendingCfg]    = useState<AnnouncementBannerConfig>(BANNER_DEFAULT)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner,  setSavingBanner]  = useState(false)
  const [uploadingImg,  setUploadingImg]  = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [bannerLum, setBannerLum] = useState(0)
  const [bannerLoaded, setBannerLoaded] = useState(false)

  const canCreate = profile ? ['coordinator', 'principal', 'admin'].includes(profile.role) : false
  const isAdmin   = profile?.role === 'admin'

  // ── Load teams ──

  useEffect(() => {
    if (!user || !profile) return
    if (profile.role === 'coordinator') fetchTeamsForUser(user.id).then(setUserTeams)
    if (profile.role === 'principal' || profile.role === 'admin') fetchAllTeams().then(setAllTeams)
  }, [user, profile])

  // ── Load banner config ──

  useEffect(() => {
    fetchBannerConfig().then(cfg => {
      setBannerCfg(cfg)
      setPendingCfg(cfg)
      if (cfg.imageUrl) {
        const img = new window.Image()
        img.onload = () => { window.scrollTo(0, 0); setBannerLoaded(true) }
        img.onerror = () => { window.scrollTo(0, 0); setBannerLoaded(true) }
        img.src = cfg.imageUrl
      } else {
        window.scrollTo(0, 0)
        setBannerLoaded(true)
      }
    })
  }, [])

  // ── Team grade ranges ──

  const teamGradeRanges = useMemo(() => {
    const teams  = [...userTeams, ...allTeams]
    const unique = Array.from(new Map(teams.map(t => [t.id, t])).values())
    return unique
      .map(team => ({ teamId: team.id, grades: gradesForTeamName(team.name) }))
      .filter(r => r.grades.length > 0)
  }, [userTeams, allTeams])

  // ── Banner editor handlers ──

  const openEditor = () => {
    setPendingCfg({ ...bannerCfg })
    setEditingBanner(true)
  }

  const cancelEdit = () => {
    setPendingCfg({ ...bannerCfg })
    setEditingBanner(false)
  }

  const saveEdit = async () => {
    setSavingBanner(true)
    await saveBannerConfig(pendingCfg)
    setBannerCfg({ ...pendingCfg })
    setSavingBanner(false)
    setEditingBanner(false)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImg(true)
    const url = await uploadSiteAsset(file, 'announcement_banner')
    if (url) setPendingCfg(prev => ({ ...prev, imageUrl: url }))
    setUploadingImg(false)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  // ── Derive banner styles ──

  const activeCfg = editingBanner ? pendingCfg : bannerCfg

  // Luminance detection — reacts whenever the active image/gradient changes
  const _imgUrl   = activeCfg.imageUrl  ?? ''
  const _gradFrom = activeCfg.gradFrom
  const _gradTo   = activeCfg.gradTo
  useEffect(() => {
    if (_imgUrl) {
      sampleImageLuminance(_imgUrl, 0.6).then(setBannerLum)
    } else {
      setBannerLum((hexToLuminance(_gradFrom) + hexToLuminance(_gradTo)) / 2)
    }
  }, [_imgUrl, _gradFrom, _gradTo])
  const bannerOnDark = bannerLum < 0.4

  const bannerBg: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)` }

  if (!user || !profile) return null

  return (
    <ProtectedLayout>
      <div data-page-theme="announcements">

        {/* ── Immersive full-bleed banner ── */}
        <AnimatePresence>
          {bannerLoaded && (
            <motion.div
              key="banner"
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              transition={{ type: 'spring', stiffness: 45, damping: 14 }}
              className="overflow-hidden"
            >
              <div className="relative overflow-hidden" style={bannerBg}>
          {/* Radial sheen */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />

          {/* Decorative background megaphone */}
          <div className="absolute -bottom-6 -right-6 opacity-[0.06] pointer-events-none select-none">
            <Megaphone size={180} className={bannerOnDark ? 'text-white' : 'text-slate-900'} />
          </div>

          {/* Bottom blur merge */}
          <div
            className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.07))',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 100%)',
            }}
          />

          {/* Admin edit pencil – bottom-right of banner */}
          {isAdmin && !editingBanner && (
            <button
              onClick={openEditor}
              className="absolute bottom-3 right-3 p-1.5 bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-lg border border-white/20 text-white transition-colors z-10"
              title="Customise banner"
            >
              <Pencil size={12} />
            </button>
          )}

          {/* Main header row */}
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`p-3 backdrop-blur-sm rounded-2xl flex-shrink-0 border transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 border-white/20' : 'bg-white/70 border-white/50'}`}>
                  <Megaphone size={24} className={`transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-700'}`} />
                </div>
                <div>
                  <h1 className={`font-display text-2xl sm:text-3xl font-bold leading-tight transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}>
                    Announcements
                  </h1>
                  <p className={`hidden sm:block text-sm mt-0.5 transition-colors duration-300 ${bannerOnDark ? 'text-white/70' : 'text-slate-600'}`}>Stay updated with the latest news</p>
                </div>
              </div>

              {canCreate && (
                <button
                  onClick={() => setShowNewForm(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 font-semibold rounded-xl text-sm hover:bg-slate-50 transition-colors shadow-lg flex-shrink-0 sm:flex hidden"
                >
                  <Plus size={16} />
                  New Announcement
                </button>
              )}
              {canCreate && (
                <button
                  onClick={() => setShowNewForm(true)}
                  className="sm:hidden flex items-center justify-center w-9 h-9 bg-white text-slate-700 rounded-full shadow-lg hover:bg-slate-50 transition-colors flex-shrink-0"
                  title="New Announcement"
                >
                  <Plus size={18} />
                </button>
              )}
            </div>
          </div>

          {/* ── Inline banner editor (admin only) ── */}
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
                    {/* Gradient presets */}
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

                    {/* Divider */}
                    <div className="w-px h-6 bg-white/25 mx-1" />

                    {/* Image upload */}
                    <label
                      className={`flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold rounded-full border border-white/25 cursor-pointer transition-colors flex-shrink-0 ${uploadingImg ? 'opacity-60 pointer-events-none' : ''}`}
                      title="Upload banner image"
                    >
                      <ImageIcon size={13} />
                      {uploadingImg ? 'Uploading…' : 'Image'}
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={handleImageUpload}
                      />
                    </label>

                    {/* Remove image */}
                    {pendingCfg.imageUrl && (
                      <button
                        onClick={() => setPendingCfg(prev => ({ ...prev, imageUrl: '' }))}
                        className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium rounded-full border border-white/15 transition-colors flex-shrink-0"
                      >
                        <X size={11} /> Remove image
                      </button>
                    )}

                    <div className="flex-1" />

                    {/* Save / Cancel */}
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1.5 text-white/70 hover:text-white text-xs font-semibold rounded-full border border-white/20 hover:bg-white/10 transition-colors flex-shrink-0"
                    >
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Announcements list ── */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 pb-10">
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
        </div>

      </div>
    </ProtectedLayout>
  )
}
