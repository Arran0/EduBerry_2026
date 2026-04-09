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
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  // Tracks whether the user was actively logged in.
  // Using a ref (not state) avoids stale-closure problems in async callbacks.
  const wasLoggedInRef = useRef(false)
  // Tracks the current user's ID so we can skip redundant profile fetches on
  // TOKEN_REFRESHED events (the user hasn't changed, only the JWT has).
  const userIdRef = useRef<string | null>(null)

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
        // If the session disappeared while the user was logged in, decide whether
        // it was a voluntary sign-out (user clicked "Sign Out" in any tab) or a
        // real session expiry.  We use a localStorage key written by signOut() so
        // that every tab can distinguish the two cases — wasLoggedInRef is
        // per-instance and only helps the tab that initiated the sign-out.
        if (!session && wasLoggedInRef.current) {
          const voluntary = localStorage.getItem('auth_voluntary_signout') === '1'
          localStorage.removeItem('auth_voluntary_signout')
          if (!voluntary) {
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
  // restoration), force-refresh the access token via a server round-trip.
  // getSession() only reads from storage and may return a stale token if
  // Supabase's internal refresh timer was frozen while the tab was backgrounded.
  // refreshSession() always contacts the server, so onAuthStateChange fires with
  // TOKEN_REFRESHED (success) or SIGNED_OUT (refresh token expired).
  useEffect(() => {
    const handleTabFocus = () => {
      // Only refresh if the user is actually logged in — calling refreshSession()
      // when there is no session is harmless but wastes a network round-trip.
      if (wasLoggedInRef.current) {
        supabase.auth.refreshSession().catch(() => {})
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleTabFocus()
    }
    // pageshow with persisted=true fires when Chrome restores a tab from
    // bfcache — JS was frozen, so Supabase's auto-refresh timer never ran.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) handleTabFocus()
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
    // Write a cross-tab flag BEFORE revoking the session.  When the SIGNED_OUT
    // event broadcasts to every open tab via localStorage, each tab's
    // onAuthStateChange can read this flag to know the sign-out was deliberate
    // (not a token expiry), and skip the "Session Expired" overlay.
    localStorage.setItem('auth_voluntary_signout', '1')
    // Reset the ref so this tab's own onAuthStateChange also skips the overlay.
    wasLoggedInRef.current = false
    // Clear local state immediately for instant UI feedback
    setUser(null)
    setProfile(null)
    setSession(null)
    // Revoke server session in background (don't await)
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
