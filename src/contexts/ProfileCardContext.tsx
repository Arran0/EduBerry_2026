'use client'

import React, { createContext, useContext, useMemo, useState, useCallback } from 'react'

interface ProfileCardContextType {
  openProfileCard: (userId: string) => void
  closeProfileCard: () => void
  activeUserId: string | null
}

const ProfileCardContext = createContext<ProfileCardContextType | undefined>(undefined)

export function ProfileCardProvider({ children }: { children: React.ReactNode }) {
  const [activeUserId, setActiveUserId] = useState<string | null>(null)

  const openProfileCard = useCallback((userId: string) => {
    setActiveUserId(userId)
  }, [])

  const closeProfileCard = useCallback(() => {
    setActiveUserId(null)
  }, [])

  // Memoised: this provider wraps the whole app, so a fresh object here made
  // every consumer re-render on each open *and* close — including heavy ones
  // like the class marks matrix, whose re-render was visible as a stutter
  // behind the card. Only `activeUserId` actually changes.
  const value = useMemo(
    () => ({ openProfileCard, closeProfileCard, activeUserId }),
    [openProfileCard, closeProfileCard, activeUserId],
  )

  return (
    <ProfileCardContext.Provider value={value}>
      {children}
    </ProfileCardContext.Provider>
  )
}

export function useProfileCard() {
  const ctx = useContext(ProfileCardContext)
  if (!ctx) throw new Error('useProfileCard must be used within ProfileCardProvider')
  return ctx
}
