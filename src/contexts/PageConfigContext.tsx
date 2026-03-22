'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { PageIconMap, PAGE_DEFAULTS, fetchPageIconConfig } from '@/lib/pageConfig'

interface PageConfigContextValue {
  config: PageIconMap
  reload: () => Promise<void>
}

const PageConfigContext = createContext<PageConfigContextValue>({
  config: PAGE_DEFAULTS,
  reload: async () => {},
})

export function PageConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<PageIconMap>(PAGE_DEFAULTS)

  const load = async () => {
    const c = await fetchPageIconConfig()
    setConfig(c)
  }

  useEffect(() => { load() }, [])

  return (
    <PageConfigContext.Provider value={{ config, reload: load }}>
      {children}
    </PageConfigContext.Provider>
  )
}

export function usePageConfig() {
  return useContext(PageConfigContext)
}
