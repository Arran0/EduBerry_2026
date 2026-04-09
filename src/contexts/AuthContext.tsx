'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase, UserProfile, UserRole } from '@/lib/supabase'

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  session: Session | null
  loading: boolean
  sessionExpired: boolean
  /**
   * Increments whenever the tab returns from a background period longer than
   * STALE_THRESHOLD_MS.  Use as a `key` prop (or useEffect dependency) on any
   * component that needs to re-fetch its Supabase data after the user has been
   * away from the tab.  ProtectedLayout already uses this to remount page
   * content automatically, so individual pages don't need to do anything extra.
   */
  dataRefreshKey: number
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Tabs hidden for longer than this are considered stale on return; page content
// is remounted via dataRefreshKey so all useEffect data-fetches re-run.
const STALE_THRESHOLD_MS = 2 * 60 * 1000 // 2 minutes

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  // Bumped whenever the tab returns from a "long" background period so that
  // components can use it as a remount key / useEffect dependency to re-fetch
  // stale Supabase data without requiring a hard refresh.
  const [dataRefreshKey, setDataRefreshKey] = useState(0)

  // Tracks whether the user was actively logged in.
  // Using a ref (not state) avoids stale-closure problems in async callbacks.
  const wasLoggedInRef = useRef(false)
  // Tracks the current user's ID so we can skip redundant profile fetches on
  // TOKEN_REFRESHED events (the user hasn't changed, only the JWT has).
  const userIdRef = useRef<string | null>(null)
  // Set to true immediately before calling supabase.auth.signOut() so that
  // the resulting SIGNED_OUT event in onAuthStateChange is recognised as
  // deliberate and does not trigger the "Session Expired" overlay.
  // This is purely intra-tab: each tab uses sessionStorage for its own
  // isolated session, so other tabs are never affected by a sign-out here.
  const isSigningOutRef = useRef(false)
  // Records when the tab was last hidden so we can measure background duration.
  const hiddenAtRef = useRef<number | null>(null)

  const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
    const MAX_RETRIES = 3
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single()

        if (error) {
          if (attempt < MAX_RETRIES - 1) {
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
            continue
          }
          console.error('Error fetching profile:', error)
          return null
        }

        return data as UserProfile
      } catch (error) {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)))
          continue
        }
        console.error('Error fetching profile:', error)
        return null
      }
    }
    return null
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user) {
      const profileData = await fetchProfile(user.id)
      setProfile(profileData)
    }
  }, [user, fetchProfile])

  useEffect(() => {
    // Safety net: if getSession() or fetchProfile() hangs indefinitely (e.g. a
    // stale token causes a silent network hang that never rejects), force-clear
    // the loading flag so the app isn't stuck on the spinner forever.
    // onAuthStateChange normally clears loading first; this is only a fallback.
    const safetyTimeout = setTimeout(() => {
      setLoading(false)
    }, 5000)

    // Hydrate session/user state immediately from the local cache so the UI
    // can start rendering (e.g. avatar skeleton) without waiting for a network
    // round-trip.  We do NOT fetch the profile here — that is done exclusively
    // inside onAuthStateChange so there is only one place that clears `loading`.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      wasLoggedInRef.current = !!session?.user
      userIdRef.current = session?.user?.id ?? null
    }).catch((err) => {
      console.error('Error getting session:', err)
    })

    // onAuthStateChange is the single source of truth for profile loading and
    // the `loading` flag.  It fires INITIAL_SESSION on startup (covering the
    // same ground as getSession above), then SIGNED_IN / TOKEN_REFRESHED /
    // SIGNED_OUT for all future events.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        // If the session disappeared while the user was actively logged in,
        // distinguish a deliberate sign-out (user clicked "Sign Out") from a
        // real token expiry.  Because each tab now has its own isolated session
        // in sessionStorage, a sign-out in this tab never affects other tabs —
        // so a simple in-tab ref is sufficient; no cross-tab localStorage flag
        // is needed.
        if (!session && wasLoggedInRef.current) {
          if (!isSigningOutRef.current) {
            sessionStorage.setItem('session_expired', '1')
            setSessionExpired(true)
          }
        }
        // Clear expired state when a fresh session is established (sign-in / token refresh).
        if (session?.user) {
          setSessionExpired(false)
        }
        wasLoggedInRef.current = !!session?.user

        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          // Skip the profile DB call only for TOKEN_REFRESHED — the JWT rotated
          // but the profile row is unchanged.  For INITIAL_SESSION and SIGNED_IN
          // we always fetch so the profile is guaranteed to be loaded before
          // `loading` is cleared, eliminating the race that caused "USER" to
          // appear and the Task Manager button to be hidden.
          if (event === 'TOKEN_REFRESHED' && session.user.id === userIdRef.current) {
            // No-op: profile already in state, token just rotated.
          } else {
            userIdRef.current = session.user.id
            const profileData = await fetchProfile(session.user.id)
            setProfile(profileData)
          }
        } else {
          userIdRef.current = null
          setProfile(null)
        }
      } catch (err) {
        console.error('Error in auth state change:', err)
      } finally {
        clearTimeout(safetyTimeout)
        setLoading(false)
      }
    })

    return () => {
      subscription.unsubscribe()
      clearTimeout(safetyTimeout)
    }
  }, [fetchProfile])

  // When the user returns to this tab (after switching tabs or bfcache
  // restoration):
  //   1. Conditionally refresh the access token if it is near expiry.
  //   2. If the tab was hidden for longer than STALE_THRESHOLD_MS, bump
  //      dataRefreshKey so that ProtectedLayout remounts page content and
  //      every page's useEffect data-fetches re-run automatically.
  //
  // Calling refreshSession() unconditionally would rotate the refresh token
  // on every tab switch; the expiry guard prevents unnecessary rotations.
  // The tab-scoped Web Lock in supabase.ts serialises concurrent refreshes
  // within a duplicated-tab pair.
  useEffect(() => {
    const handleTabReturn = (backgroundMs: number) => {
      // Auth token: refresh only when near expiry.
      if (wasLoggedInRef.current) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) return
          const expiresAt = session.expires_at ?? 0  // Unix seconds
          const nowSec    = Math.floor(Date.now() / 1000)
          if (expiresAt - nowSec < 60) {
            supabase.auth.refreshSession().catch(() => {})
          }
        }).catch(() => {})
      }

      // Stale data: remount page content if the tab was away long enough.
      if (backgroundMs >= STALE_THRESHOLD_MS) {
        setDataRefreshKey(k => k + 1)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
      } else {
        const backgroundMs = hiddenAtRef.current !== null
          ? Date.now() - hiddenAtRef.current
          : 0
        hiddenAtRef.current = null
        handleTabReturn(backgroundMs)
      }
    }

    // pageshow with persisted=true fires when Chrome restores a tab from
    // bfcache — JS was frozen, so Supabase's auto-refresh timer never ran
    // and an unknown amount of time has passed.  Treat as potentially stale.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) handleTabReturn(STALE_THRESHOLD_MS)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  // Periodic keepalive: refresh the session every 10 minutes while the tab is
  // visible. This prevents the access token from silently expiring when the
  // user leaves the app open without switching tabs (e.g. reading a long page).
  useEffect(() => {
    const KEEPALIVE_MS = 10 * 60 * 1000 // 10 minutes
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        supabase.auth.refreshSession().catch(() => {})
      }
    }, KEEPALIVE_MS)
    return () => clearInterval(id)
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      return { error }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signUp = async (email: string, password: string, fullName: string, role: UserRole) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: role,
          },
        },
      })

      if (error) return { error }

      // Create profile entry
      if (data.user) {
        const { error: profileError } = await supabase.from('profiles').insert({
          id: data.user.id,
          email: email,
          full_name: fullName,
          role: role,
        })

        if (profileError) {
          console.error('Error creating profile:', profileError)
          return { error: profileError as unknown as Error }
        }
      }

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  }

  const signOut = async () => {
    // Mark as deliberate BEFORE calling signOut() so the SIGNED_OUT event
    // fired by onAuthStateChange is not mistaken for a token expiry.
    isSigningOutRef.current = true
    wasLoggedInRef.current = false
    // Clear local state immediately for instant UI feedback.
    setUser(null)
    setProfile(null)
    setSession(null)
    // Revoke the server session (default scope: 'global').  Other users in
    // other tabs have completely separate refresh tokens in their own
    // sessionStorage, so they are unaffected.  A second tab opened by the
    // same user will eventually get a SIGNED_OUT event when its (now-revoked)
    // refresh token is next used — the correct behaviour: the user signed out.
    supabase.auth.signOut().catch(() => {})
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        session,
        loading,
        sessionExpired,
        dataRefreshKey,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
