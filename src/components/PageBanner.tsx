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
import { sampleImageLuminance } from '@/lib/luminance'
import { BANNER_TEXTURE_URI, swatchBackground, gradientLuminance, isDarkLum } from '@/lib/bannerStyle'

interface PageBannerProps {
  /** site_settings key, e.g. "leave_banner" */
  settingKey: string
  defaultBanner: AnnouncementBannerConfig
  /** Icon element rendered inside the frosted box */
  icon: React.ReactNode
  title: string
  /** Shrinks the icon/gap/title just enough on mobile to guarantee the title
   *  stays on one line — pairs with an actions button, which drops to its own
   *  row below instead of getting clipped when it no longer fits alongside. */
  compactMobileTitle?: boolean
  /** Small uppercase kicker rendered above the title (elevated look). */
  eyebrow?: string
  /** Hidden on mobile */
  subtitle?: string
  /** Opt into the premium treatment: sheen sweep, icon-chip, larger display
   *  headline, entrance motion and text shadows (matches the Task Manager hero). */
  elevated?: boolean
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
  compactMobileTitle = false,
  eyebrow,
  subtitle,
  elevated = false,
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
  // Relative luminance of the active banner background → drives white/black text.
  const [bannerLum, setBannerLum] = useState(0.1)
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
  const _imgUrl = activeCfg.imageUrl ?? ''
  const _gradFrom = activeCfg.gradFrom
  const _gradTo = activeCfg.gradTo

  // Recompute luminance whenever the active background changes. Images are
  // sampled (bottom portion, where the text sits); gradients are averaged.
  useEffect(() => {
    if (_imgUrl) {
      sampleImageLuminance(_imgUrl, 0.6).then(setBannerLum)
    } else {
      setBannerLum(gradientLuminance(_gradFrom, _gradTo))
    }
  }, [_imgUrl, _gradFrom, _gradTo])

  const onDark = isDarkLum(bannerLum)
  const titleColor = onDark ? 'text-white' : 'text-slate-900'
  const subtitleColor = onDark ? 'text-white/60' : 'text-slate-600'
  const backColor = onDark ? 'text-white/70 hover:text-white' : 'text-slate-600 hover:text-slate-900'
  const iconBoxClass = onDark ? 'bg-white/20 border-white/20' : 'bg-white/60 border-white/50'

  const bannerStyle: React.CSSProperties = activeCfg.imageUrl
    ? { backgroundImage: `url(${activeCfg.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `${BANNER_TEXTURE_URI}, linear-gradient(140deg, ${activeCfg.gradFrom} 0%, ${activeCfg.gradTo} 100%)`, backgroundSize: '180px, auto', backgroundBlendMode: 'soft-light' }

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
            className={`relative overflow-hidden${elevated ? ' sheen sheen-animate' : ''}`}
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

      {/* Bottom merge — a soft light wash, no backdrop-filter (a blurred
          strip under a popup is what Chrome draws black as it opens; see
          globals.css, "No backdrop-filter in the glass materials"). */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.10))' }}
      />

      {/* Admin edit pencil – top-right of banner. The same chip as the home
          page's welcome banner: a dark glass circle with a white pencil —
          44 px from sm up, a 28 px version tucked in the corner on phones,
          where every pixel of banner height is screen the content loses. */}
      {isAdmin && !editingBanner && (
        <button
          onClick={openEditor}
          aria-label="Customise banner"
          className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 z-20 w-7 h-7 sm:w-11 sm:h-11 rounded-full bg-black/30 hover:bg-black/45 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/90 focus-visible:bg-black/45"
          title="Customise banner"
        >
          <Pencil className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" aria-hidden="true" />
        </button>
      )}

      {/* Main header content */}
      {/* Phones have no side margin to hold the actions clear of the admin
          pencil, so the row starts just below the small corner pencil; wider
          screens keep the height and step the actions in (see the actions
          wrapper below). */}
      <div className={`relative ${maxWidth} mx-auto px-4 sm:px-6 lg:px-8 ${
        isAdmin && actions && !editingBanner ? `pt-10 sm:pt-7 ${elevated ? 'pb-8 sm:pb-9' : 'pb-10'}` : elevated ? 'pt-6 pb-8 sm:pt-7 sm:pb-9' : 'pt-7 pb-10'
      }`}>
        {onBack && (
          <button
            onClick={onBack}
            className={`flex items-center gap-1.5 text-sm mb-5 transition-colors ${backColor}`}
          >
            <ChevronLeft size={16} />
            Back
          </button>
        )}

        <motion.div
          initial={elevated ? { opacity: 0, y: 14 } : false}
          animate={elevated ? { opacity: 1, y: 0 } : undefined}
          transition={elevated ? { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 } : undefined}
          className="flex flex-nowrap items-center gap-x-4 gap-y-3"
        >
          <div className={`flex items-center ${compactMobileTitle ? 'gap-3 sm:gap-5' : 'gap-4 sm:gap-5'}`}>
            {/* Frosted icon box — icon colour follows banner luminance. The
                elevated variant uses the premium icon-chip material. */}
            {elevated ? (
              <div className={`icon-chip ${compactMobileTitle ? 'w-11 h-11 sm:w-16 sm:h-16' : 'w-14 h-14 sm:w-16 sm:h-16'} flex-shrink-0 transition-colors duration-300 ${onDark ? 'bg-white/20 border border-white/25' : 'bg-white/75 border border-white/60'} ${onDark ? '[&_svg]:drop-shadow-sm' : '[&_svg]:!text-slate-700'}`}>
                {icon}
              </div>
            ) : (
              <div className={`p-3 rounded-2xl border flex-shrink-0 transition-colors duration-300 ${iconBoxClass} ${onDark ? '' : '[&_svg]:!text-slate-800'}`}>
                {icon}
              </div>
            )}

            <div>
              {eyebrow && (
                <p
                  className={`eyebrow mb-2 ${onDark ? 'text-white/75' : 'text-slate-500'}`}
                  style={onDark ? { textShadow: '0 1px 3px rgba(0,0,0,0.45)' } : undefined}
                >
                  {eyebrow}
                </p>
              )}
              <h1
                className={`font-display font-bold transition-colors duration-300 ${titleColor} ${elevated ? (compactMobileTitle ? 'text-[1.45rem] sm:text-[2.6rem] leading-[1.05] headline' : 'text-[1.9rem] sm:text-[2.6rem] leading-[1.05] headline') : 'text-2xl sm:text-3xl leading-tight'} ${compactMobileTitle ? 'whitespace-nowrap' : ''}`}
                style={onDark && elevated ? { textShadow: '0 2px 10px rgba(0,0,0,0.45)' } : undefined}
              >
                {title}
              </h1>
              {subtitle && (
                <p
                  className={`hidden sm:block text-sm mt-1 transition-colors duration-300 ${subtitleColor}`}
                  style={onDark && elevated ? { textShadow: '0 1px 3px rgba(0,0,0,0.4)' } : undefined}
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* With the admin pencil in the corner, hold the actions clear of it
              until the page is wide enough that the container's margin does. */}
          {actions && <div className={`flex-shrink-0 ml-auto ${isAdmin && !editingBanner ? 'sm:mr-10 2xl:mr-0' : ''}`}>{actions}</div>}
        </motion.div>
      </div>

      {/* Inline banner editor (admin only) */}
      <AnimatePresence>
        {editingBanner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-white/20 bg-black/45"
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
                      style={{ backgroundImage: swatchBackground(p.from, p.to), backgroundSize: '60px, auto', backgroundBlendMode: 'soft-light' }}
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
