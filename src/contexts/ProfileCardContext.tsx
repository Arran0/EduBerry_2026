'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'

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

  return (
    <ProfileCardContext.Provider value={{ openProfileCard, closeProfileCard, activeUserId }}>
      {children}
    </ProfileCardContext.Provider>
  )
}

export function useProfileCard() {
  const ctx = useContext(ProfileCardContext)
  if (!ctx) throw new Error('useProfileCard must be used within ProfileCardProvider')
  return ctx
}
