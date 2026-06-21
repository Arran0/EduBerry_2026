'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'

interface BottomNavContextValue {
  hidden: boolean
  /** Imperatively hide/show the global mobile BottomNav. */
  setBottomNavHidden: (hidden: boolean) => void
}

const BottomNavContext = createContext<BottomNavContextValue>({
  hidden: false,
  setBottomNavHidden: () => {},
})

export function BottomNavProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false)
  const setBottomNavHidden = useCallback((h: boolean) => setHidden(h), [])
  return (
    <BottomNavContext.Provider value={{ hidden, setBottomNavHidden }}>
      {children}
    </BottomNavContext.Provider>
  )
}

export function useBottomNav() {
  return useContext(BottomNavContext)
}
