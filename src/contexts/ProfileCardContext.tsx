'use client'

import React, { createContext, useContext, useMemo, useState, useCallback } from 'react'
import type { UserProfile } from '@/lib/supabase'

/**
 * What a caller already knows about the person whose card is being opened.
 *
 * Lists that render someone's name and face have their profile in hand
 * already. Handing it over lets the card open at its real size straight away
 * instead of opening as a spinner and resizing once the fetch lands.
 */
export type ProfileCardSeed = Partial<UserProfile> & { id: string }

interface ProfileCardContextType {
  openProfileCard: (userId: string, seed?: ProfileCardSeed | null) => void
  closeProfileCard: () => void
  activeUserId: string | null
  activeSeed: ProfileCardSeed | null
}

const ProfileCardContext = createContext<ProfileCardContextType | undefined>(undefined)

export function ProfileCardProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<{ id: string; seed: ProfileCardSeed | null } | null>(null)

  const openProfileCard = useCallback((userId: string, seed: ProfileCardSeed | null = null) => {
    // A seed for somebody else would render the wrong person for a frame, so
    // one that doesn't match the requested id is dropped rather than trusted.
    setActive({ id: userId, seed: seed && seed.id === userId ? seed : null })
  }, [])

  const closeProfileCard = useCallback(() => {
    setActive(null)
  }, [])

  // Memoised: this provider wraps the whole app, so a fresh object here made
  // every consumer re-render on each open *and* close — including heavy ones
  // like the class marks matrix, whose re-render was visible as a stutter
  // behind the card. Only `active` actually changes.
  const value = useMemo(
    () => ({
      openProfileCard,
      closeProfileCard,
      activeUserId: active?.id ?? null,
      activeSeed: active?.seed ?? null,
    }),
    [openProfileCard, closeProfileCard, active],
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
