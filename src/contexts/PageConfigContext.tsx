'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  PageIconMap, PAGE_DEFAULTS, fetchPageIconConfig,
  SiteBranding, BRANDING_DEFAULTS, fetchBranding,
  LoginPageConfig, LOGIN_DEFAULTS, fetchLoginConfig,
  PageThemeMap, fetchPageThemes,
} from '@/lib/pageConfig'

interface PageConfigContextValue {
  pageIcons: PageIconMap
  branding: SiteBranding
  brandingLoaded: boolean
  loginConfig: LoginPageConfig
  pageThemes: PageThemeMap
  reload: () => Promise<void>
  /** @deprecated use pageIcons */
  config: PageIconMap
}

const PageConfigContext = createContext<PageConfigContextValue>({
  pageIcons: PAGE_DEFAULTS,
  branding: BRANDING_DEFAULTS,
  brandingLoaded: false,
  loginConfig: LOGIN_DEFAULTS,
  pageThemes: {},
  reload: async () => {},
  config: PAGE_DEFAULTS,
})

// ── LocalStorage cache helpers ────────────────────────────────────────────────
// Persists branding and loginConfig so that on the next page load the correct
// colours/logo are available immediately, before the Supabase fetch completes.

const CACHE_BRANDING = 'site_branding_v1'
const CACHE_LOGIN    = 'site_login_v1'

function readCache<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch { return fallback }
}

function writeCache(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function hasCached(key: string): boolean {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(key) !== null } catch { return false }
}

// ── Theme CSS builder ─────────────────────────────────────────────────────────

function buildBrandingCSS(branding: SiteBranding): string {
  return `:root {\n  --brand-primary: ${branding.primaryColor};\n  --brand-secondary: ${branding.secondaryColor};\n}`
}

function buildThemeCSS(themes: PageThemeMap): string {
  return Object.entries(themes).map(([pageId, t]) => {
    if (!t) return ''
    const vars = `[data-page-theme="${pageId}"] {
  --page-primary: ${t.primary};
  --page-primary-light: ${t.primaryLight};
  --page-primary-dark: ${t.primaryDark};
  --page-accent: ${t.accent};
  --page-accent-light: ${t.accentLight};
  --page-gradient-from: ${t.gradFrom};
  --page-gradient-to: ${t.gradTo};
}`
    const bgRule = t.bgFrom && t.bgTo
      ? `body:has([data-page-theme="${pageId}"]) { background: linear-gradient(135deg, ${t.bgFrom}, ${t.bgMid || t.bgFrom}, ${t.bgTo}) !important; }`
      : ''
    return [vars, bgRule].filter(Boolean).join('\n')
  }).join('\n')
}

export function PageConfigProvider({ children }: { children: React.ReactNode }) {
  const [pageIcons, setPageIcons] = useState<PageIconMap>(PAGE_DEFAULTS)
  // Start with defaults so the server render and the initial client render
  // produce identical HTML (prevents React hydration error #423).
  // The cache is applied in the first useEffect below, client-side only.
  const [branding, setBranding] = useState<SiteBranding>(BRANDING_DEFAULTS)
  const [brandingLoaded, setBrandingLoaded] = useState(false)
  const [loginConfig, setLoginConfig] = useState<LoginPageConfig>(LOGIN_DEFAULTS)
  const [pageThemes, setPageThemes] = useState<PageThemeMap>({})

  const load = async () => {
    const [icons, brand, login, themes] = await Promise.all([
      fetchPageIconConfig(),
      fetchBranding(),
      fetchLoginConfig(),
      fetchPageThemes(),
    ])
    setPageIcons(icons)
    setBranding(brand)
    writeCache(CACHE_BRANDING, brand)
    setBrandingLoaded(true)
    setLoginConfig(login)
    writeCache(CACHE_LOGIN, login)
    setPageThemes(themes)
  }

  useEffect(() => {
    // Apply any cached values immediately on mount (client-only) so custom
    // colours/logo are visible before the Supabase fetch completes, without
    // causing a hydration mismatch on the first render.
    if (hasCached(CACHE_BRANDING)) {
      setBranding(readCache(CACHE_BRANDING, BRANDING_DEFAULTS))
      setBrandingLoaded(true)
    }
    if (hasCached(CACHE_LOGIN)) {
      setLoginConfig(readCache(CACHE_LOGIN, LOGIN_DEFAULTS))
    }
    load()
  }, [])

  // Update favicon dynamically once branding is loaded
  useEffect(() => {
    if (!brandingLoaded) return
    const url = branding.faviconUrl || branding.logoUrl
    if (!url) return
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = url
  }, [brandingLoaded, branding.faviconUrl, branding.logoUrl])

  const themeCSS = buildThemeCSS(pageThemes)
  const brandingCSS = buildBrandingCSS(branding)

  return (
    <PageConfigContext.Provider value={{
      pageIcons, branding, brandingLoaded, loginConfig, pageThemes,
      reload: load,
      config: pageIcons,
    }}>
      <style dangerouslySetInnerHTML={{ __html: brandingCSS }} />
      {themeCSS && (
        <style dangerouslySetInnerHTML={{ __html: themeCSS }} />
      )}
      {children}
    </PageConfigContext.Provider>
  )
}

export function usePageConfig() {
  return useContext(PageConfigContext)
}
