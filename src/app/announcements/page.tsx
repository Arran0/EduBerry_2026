'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import ProtectedLayout from '@/components/ProtectedLayout'
import SmartboardLayout from '@/components/SmartboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { Plus, Megaphone, Pencil, Check, X, Image as ImageIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import AnnouncementsList from '@/components/announcements/AnnouncementsList'
import PushToggle from '@/components/notifications/PushToggle'
import { useAnnouncementNotifications } from '@/hooks/useAnnouncementNotifications'
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
import { BANNER_TEXTURE_URI, swatchBackground, isDarkLum } from '@/lib/bannerStyle'

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

  // Opening the page is what "reading" an announcement means here — clear the
  // navbar badge on arrival.
  const { markAllRead } = useAnnouncementNotifications(user?.id ?? null)
  useEffect(() => { markAllRead() }, [markAllRead])

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
        // The banner is the LCP element — don't let its fetch queue behind the
        // feed's avatars and attachment thumbnails.
        img.fetchPriority = 'high'
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
  const bannerOnDark = isDarkLum(bannerLum)

  const bannerBg: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `${BANNER_TEXTURE_URI}, linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)`, backgroundSize: '180px, auto', backgroundBlendMode: 'soft-light' }

  if (!user || !profile) return null

  const isSmartboard = profile.role === 'smartboard'

  const inner = (
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

          {/* Admin edit pencil – top-right corner of the banner, matching the
              home banner's pencil exactly (circular, w-8 h-8, bg-black/25/45,
              backdrop-blur-sm, size-13 icon, same top-3 right-3 placement).
              The button row below reserves right-side clearance (mr-11) so
              it never sits under this. */}
          {isAdmin && !editingBanner && (
            <button
              onClick={openEditor}
              className="absolute top-3 right-3 z-20 w-8 h-8 rounded-full bg-black/25 hover:bg-black/45 backdrop-blur-sm flex items-center justify-center transition-all"
              title="Customise banner"
            >
              <Pencil size={13} className="text-white" />
            </button>
          )}

          {/* Main header row */}
          {/* Vertical rhythm matches the academics banner (pt-5 pb-6, p-3 icon) */}
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-6">
            <div className="flex items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div className={`p-3 backdrop-blur-sm rounded-2xl flex-shrink-0 border transition-colors duration-300 ${bannerOnDark ? 'bg-white/20 border-white/20' : 'bg-white/75 border-white/55'}`}>
                  <Megaphone size={26} className={`transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-700'}`} />
                </div>
                <div className="min-w-0">
                  <h1 className={`font-display text-[1.45rem] sm:text-[2.6rem] font-black leading-[1.04] tracking-tight truncate transition-colors duration-300 ${bannerOnDark ? 'text-white' : 'text-slate-900'}`}>
                    Announcements
                  </h1>
                  <p className={`text-sm mt-1 truncate transition-colors duration-300 ${bannerOnDark ? 'text-white/70' : 'text-slate-600'}`}>Stay updated</p>
                </div>
              </div>

              <div className={`flex items-center gap-2 flex-shrink-0 ${isAdmin ? 'mr-11' : ''}`}>
                <PushToggle onDark={bannerOnDark} />
                {canCreate && (
                  <button
                    onClick={() => setShowNewForm(true)}
                    className={`sm:flex hidden items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border backdrop-blur-sm transition-all shadow-md flex-shrink-0 ${
                      bannerOnDark
                        ? 'bg-white/20 hover:bg-white/30 border-white/25 text-white'
                        : 'bg-white/75 hover:bg-white/95 border-white/55 text-slate-700'
                    }`}
                  >
                    <Plus size={16} />
                    New Announcement
                  </button>
                )}
                {canCreate && (
                  <button
                    onClick={() => setShowNewForm(true)}
                    className={`sm:hidden flex items-center justify-center w-9 h-9 rounded-full border backdrop-blur-sm transition-all shadow-md flex-shrink-0 ${
                      bannerOnDark
                        ? 'bg-white/20 hover:bg-white/30 border-white/25 text-white'
                        : 'bg-white/75 hover:bg-white/95 border-white/55 text-slate-700'
                    }`}
                    title="New Announcement"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
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
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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
                          style={{ backgroundImage: swatchBackground(p.from, p.to), backgroundSize: '60px, auto', backgroundBlendMode: 'soft-light' }}
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

        {/* ── Announcements list (dims while the banner is being edited) ── */}
        <div className="max-w-4xl mx-auto px-0 sm:px-4 lg:px-6 pb-10" style={{ opacity: editingBanner ? 0.35 : 1, filter: editingBanner ? 'blur(1.5px)' : 'none', pointerEvents: editingBanner ? 'none' : 'auto', userSelect: editingBanner ? 'none' : 'auto', transition: 'opacity 0.25s ease, filter 0.25s ease' }}>
          <AnnouncementsList
            userId={user.id}
            userRole={profile.role}
            userTeams={userTeams}
            allTeams={allTeams}
            teamGradeRanges={teamGradeRanges}
            showNewForm={showNewForm}
            onNewFormChange={setShowNewForm}
          />
        </div>

      </div>
  )

  return isSmartboard
    ? <SmartboardLayout>{inner}</SmartboardLayout>
    : <ProtectedLayout allowSmartboard>{inner}</ProtectedLayout>
}
