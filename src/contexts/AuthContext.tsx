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

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        console.error('Error fetching profile:', error)
        return null
      }

      return data as UserProfile
    } catch (error) {
      console.error('Error fetching profile:', error)
      return null
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (user) {
      const profileData = await fetchProfile(user.id)
      setProfile(profileData)
    }
  }, [user, fetchProfile])

  useEffect(() => {
    // Load the initial session.  We await the profile fetch before clearing
    // the loading flag so ProtectedLayout's spinner covers the full bootstrap
    // period — preventing the brief blank screen where user≠null but profile==null.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      wasLoggedInRef.current = !!session?.user
      userIdRef.current = session?.user?.id ?? null
      if (session?.user) {
        const profileData = await fetchProfile(session.user.id)
        setProfile(profileData)
      }
      setLoading(false)
    }).catch((err) => {
      console.error('Error getting session:', err)
      setLoading(false)
    })

    // onAuthStateChange handles all future auth events (SIGNED_IN, SIGNED_OUT,
    // TOKEN_REFRESHED, etc.).  The logic here is kept close to the original
    // working version; the only addition is the wasLoggedInRef tracking so we
    // can display an "your session expired" banner on the login page.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      try {
        // If the session disappeared while the user was logged in, flag it so
        // the app shows a "session expired" overlay and the login page can show
        // an "your session has expired" message.
        if (!session && wasLoggedInRef.current) {
          sessionStorage.setItem('session_expired', '1')
          setSessionExpired(true)
        }
        // Clear expired state when a fresh session is established (sign-in / token refresh).
        if (session?.user) {
          setSessionExpired(false)
        }
        wasLoggedInRef.current = !!session?.user

        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          // Only fetch the profile when the user actually changes (e.g. sign-in,
          // user switch). Skip redundant DB calls on TOKEN_REFRESHED events — the
          // JWT changed but the profile data is the same.
          if (session.user.id !== userIdRef.current) {
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
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
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
    // Reset the ref before signing out so onAuthStateChange(SIGNED_OUT) doesn't
    // mistakenly set the "session expired" flag for a voluntary sign-out.
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
