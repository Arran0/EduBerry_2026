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
  loginConfig: LoginPageConfig
  pageThemes: PageThemeMap
  reload: () => Promise<void>
  /** @deprecated use pageIcons */
  config: PageIconMap
}

const PageConfigContext = createContext<PageConfigContextValue>({
  pageIcons: PAGE_DEFAULTS,
  branding: BRANDING_DEFAULTS,
  loginConfig: LOGIN_DEFAULTS,
  pageThemes: {},
  reload: async () => {},
  config: PAGE_DEFAULTS,
})

function buildThemeCSS(themes: PageThemeMap): string {
  return Object.entries(themes).map(([pageId, t]) => {
    if (!t) return ''
    return `[data-page-theme="${pageId}"] {
  --page-primary: ${t.primary};
  --page-primary-light: ${t.primaryLight};
  --page-primary-dark: ${t.primaryDark};
  --page-accent: ${t.accent};
  --page-accent-light: ${t.accentLight};
  --page-gradient-from: ${t.gradFrom};
  --page-gradient-to: ${t.gradTo};
}`
  }).join('\n')
}

export function PageConfigProvider({ children }: { children: React.ReactNode }) {
  const [pageIcons, setPageIcons] = useState<PageIconMap>(PAGE_DEFAULTS)
  const [branding, setBranding] = useState<SiteBranding>(BRANDING_DEFAULTS)
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
    setLoginConfig(login)
    setPageThemes(themes)
  }

  useEffect(() => { load() }, [])

  const themeCSS = buildThemeCSS(pageThemes)

  return (
    <PageConfigContext.Provider value={{
      pageIcons, branding, loginConfig, pageThemes,
      reload: load,
      config: pageIcons,
    }}>
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
