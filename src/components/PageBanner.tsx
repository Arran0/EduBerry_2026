'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pencil, X, Check, ImageIcon, ChevronLeft } from 'lucide-react'
import {
  AnnouncementBannerConfig,
  BANNER_PRESETS,
  fetchPageBanner,
  savePageBanner,
  uploadSiteAsset,
} from '@/lib/pageConfig'

interface PageBannerProps {
  /** site_settings key, e.g. "leave_banner" */
  settingKey: string
  defaultBanner: AnnouncementBannerConfig
  /** Icon element rendered inside the frosted box */
  icon: React.ReactNode
  title: string
  /** Hidden on mobile */
  subtitle?: string
  /** Right-side action buttons (rendered as-is) */
  actions?: React.ReactNode
  /** If provided a Back button is shown */
  onBack?: () => void
  /** Tailwind max-width class, default "max-w-5xl" */
  maxWidth?: string
  /** Show the admin pencil edit button */
  isAdmin?: boolean
  /** Optional large icon rendered faintly in the bottom-right of the banner */
  backgroundIcon?: React.ReactNode
  /** Called whenever the loaded/saved banner config changes */
  onBannerChange?: (cfg: AnnouncementBannerConfig) => void
  /** Called whenever the inline editor opens or closes */
  onEditingChange?: (editing: boolean) => void
}

export default function PageBanner({
  settingKey,
  defaultBanner,
  icon,
  title,
  subtitle,
  actions,
  onBack,
  maxWidth = 'max-w-5xl',
  isAdmin = false,
  backgroundIcon,
  onBannerChange,
  onEditingChange,
}: PageBannerProps) {
  const [bannerCfg, setBannerCfg] = useState<AnnouncementBannerConfig>(defaultBanner)
  const [pendingCfg, setPendingCfg] = useState<AnnouncementBannerConfig>(defaultBanner)
  const [bannerLoaded, setBannerLoaded] = useState(false)
  const [editingBanner, setEditingBanner] = useState(false)
  const [savingBanner, setSavingBanner] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    setBannerLoaded(false)
    fetchPageBanner(settingKey, defaultBanner).then(cfg => {
      setBannerCfg(cfg)
      setPendingCfg(cfg)
      onBannerChange?.(cfg)
      if (cfg.imageUrl) {
        const img = new window.Image()
        img.onload = () => setBannerLoaded(true)
        img.onerror = () => setBannerLoaded(true)
        img.src = cfg.imageUrl
      } else {
        setBannerLoaded(true)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingKey])

  const openEditor = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(true); onEditingChange?.(true) }
  const cancelEdit = () => { setPendingCfg({ ...bannerCfg }); setEditingBanner(false); onEditingChange?.(false) }

  const saveEdit = async () => {
    setSavingBanner(true)
    await savePageBanner(settingKey, pendingCfg)
    setBannerCfg({ ...pendingCfg })
    onBannerChange?.({ ...pendingCfg })
    setSavingBanner(false)
    setEditingBanner(false)
    onEditingChange?.(false)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImg(true)
    const url = await uploadSiteAsset(file, settingKey)
    if (url) setPendingCfg(prev => ({ ...prev, imageUrl: url }))
    setUploadingImg(false)
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const activeCfg = editingBanner ? pendingCfg : bannerCfg
  const bannerStyle: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: `linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)` }

  return (
    <AnimatePresence>
      {bannerLoaded && (
        <motion.div
          key={settingKey}
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          transition={{ type: 'spring', stiffness: 45, damping: 14 }}
          className={`overflow-hidden${editingBanner ? ' relative z-30' : ''}`}
        >
          <div
            className="relative overflow-hidden"
            style={bannerStyle}
          >
      {/* Scrim — stronger for photos */}
      {activeCfg.imageUrl && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/10 to-transparent" />
      )}

      {/* Radial sheen */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />

      {/* Decorative background icon */}
      {backgroundIcon && (
        <div className="absolute -bottom-6 -right-6 opacity-[0.06] pointer-events-none select-none">
          {backgroundIcon}
        </div>
      )}

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

      {/* Admin edit pencil – top-right of banner */}
      {isAdmin && !editingBanner && (
        <button
          onClick={openEditor}
          className="absolute top-3 right-3 p-1.5 bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-lg border border-white/20 text-white transition-colors z-10"
          title="Customise banner"
        >
          <Pencil size={12} />
        </button>
      )}

      {/* Main header content */}
      <div className={`relative ${maxWidth} mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-10`}>
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white mb-5 transition-colors"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Frosted icon box */}
            <div className="p-3 bg-white/20 backdrop-blur-sm rounded-2xl border border-white/20 flex-shrink-0">
              {icon}
            </div>

            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="hidden sm:block text-white/60 text-sm mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {actions && <div className="flex-shrink-0">{actions}</div>}
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
            <div className={`${maxWidth} mx-auto px-4 sm:px-6 lg:px-8 py-4`}>
              <p className="text-white/70 text-[11px] font-semibold uppercase tracking-widest mb-3">
                Banner Style
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                {BANNER_PRESETS.map(p => {
                  const active =
                    !pendingCfg.imageUrl &&
                    pendingCfg.gradFrom === p.from &&
                    pendingCfg.gradTo === p.to
                  return (
                    <button
                      key={p.label}
                      title={p.label}
                      onClick={() => setPendingCfg({ gradFrom: p.from, gradTo: p.to, imageUrl: '' })}
                      className={`w-8 h-8 rounded-full border-2 transition-all duration-150 flex-shrink-0 ${
                        active
                          ? 'border-white scale-110 shadow-lg'
                          : 'border-white/30 hover:border-white/70 hover:scale-105'
                      }`}
                      style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
                    />
                  )
                })}
                <div className="w-px h-6 bg-white/25 mx-1" />
                <label
                  className={`flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold rounded-full border border-white/25 cursor-pointer transition-colors flex-shrink-0 ${
                    uploadingImg ? 'opacity-60 pointer-events-none' : ''
                  }`}
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
                {pendingCfg.imageUrl && (
                  <button
                    onClick={() => setPendingCfg(prev => ({ ...prev, imageUrl: '' }))}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium rounded-full border border-white/15 transition-colors flex-shrink-0"
                  >
                    <X size={11} /> Remove image
                  </button>
                )}
                <div className="flex-1" />
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
  )
}
