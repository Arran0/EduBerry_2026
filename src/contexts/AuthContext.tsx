'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { clearFeeCaches } from '@/lib/fees/cache'
import { supabase, AUTH_STORAGE_KEY, UserProfile, UserRole } from '@/lib/supabase'
import { recordAppOpen } from '@/lib/gamification'

interface AuthContextType {
  user: User | null
  profile: UserProfile | null
  session: Session | null
  loading: boolean
  sessionExpired: boolean
  /**
   * Increments whenever the data on screen must be considered stale:
   *   • the tab returned from a background period longer than STALE_THRESHOLD_MS, or
   *   • the signed-in account changed (in this tab or another one), so the
   *     content on screen belongs to the previous user.
   * Use as a `key` prop (or useEffect dependency) on any component that needs
   * to re-fetch its Supabase data.  ProtectedLayout already uses this to
   * remount page content automatically, so individual pages don't need to do
   * anything extra.
   */
  dataRefreshKey: number
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: Error | null }>
  /**
   * Ends the session.  Defaults to scope 'local' — only this browser is signed
   * out, so the same user stays signed in on their other devices.  Pass
   * { scope: 'global' } when every device must be signed out (e.g. right after
   * a password change).
   */
  signOut: (options?: { scope?: 'local' | 'global' }) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Tabs hidden for longer than this are considered stale on return; page content
// is remounted via dataRefreshKey so all useEffect data-fetches re-run.
// 10 minutes: short enough to refresh genuinely stale data, but long enough
// that typical brief task-switches (reading email, checking Slack) don't
// remount every loading spinner on every page.
const STALE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

// Last-resort removal of the persisted session (see signOut).  Also drops the
// PKCE code-verifier GoTrue stores alongside it, matching what its own
// _removeSession does.
function clearStoredSession() {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    window.localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`)
  } catch {
    // storage unavailable (private mode) — nothing persisted to clear
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(() => {
    // On a fresh page load after expiry, wasLoggedInRef starts as false so the
    // onAuthStateChange INITIAL_SESSION path cannot detect the expiry.  Seed
    // the state from the sessionStorage flag that was written when the token
    // expired so the Session Expired banner still shows after a page refresh.
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('session_expired') === '1'
    }
    return false
  })
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
  // deliberate and does not trigger the "Session Expired" overlay.  It is
  // cleared once that event has been handled, so a genuine expiry later in the
  // same tab (e.g. after signing in as a different account) is still detected.
  const isSigningOutRef = useRef(false)
  // The user id the app last rendered for.  A change to a *different* id means
  // the account was switched (in this tab or another one), so every page's
  // data — fetched for the previous user — has to be thrown away.
  const prevUserIdRef = useRef<string | null>(null)
  // Records when the tab was last hidden so we can measure background duration.
  const hiddenAtRef = useRef<number | null>(null)
  // Latest session, readable from interval callbacks without re-creating them.
  const sessionRef = useRef<Session | null>(null)

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

    // onAuthStateChange is the single source of truth for session hydration,
    // profile loading and the `loading` flag.  It fires INITIAL_SESSION on
    // startup from the local cache (no network round-trip), then SIGNED_IN /
    // TOKEN_REFRESHED / SIGNED_OUT for all future events.  An explicit
    // getSession() call here would be a second lock acquisition racing with
    // INITIAL_SESSION — pure contention with no benefit.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // ⚠️  STATE UPDATES ONLY — never call supabase.* synchronously in here.
      //
      // GoTrue fires this callback *while holding its auth lock* — most notably
      // from `_onVisibilityChanged`, which acquires the lock when the tab is
      // refocused.  Any supabase.* call made directly inside this callback
      // (e.g. fetchProfile → supabase.from('profiles'), which itself calls
      // getSession to attach a JWT and therefore needs the same lock) deadlocks:
      // the lock is waiting for this callback to return, and the callback is
      // waiting for the lock.  That surfaces as the uncaught
      // `lock-backstop-timeout` after 30 s (or, with Supabase's default lock,
      // as a hang that never ends) — either way every page that
      // needs the session is stuck on its loading spinner until a manual refresh
      // (a fresh document re-runs init on a non-locked path).
      //
      // Per Supabase's own guidance, defer all supabase calls out of this
      // callback with setTimeout(0) so they run AFTER the lock is released.
      if (!session && wasLoggedInRef.current && !isSigningOutRef.current) {
        // Real token expiry (not a deliberate sign-out).  The flag is
        // per-tab (sessionStorage) so the banner survives a reload of this tab
        // without following the user into a freshly opened one.
        sessionStorage.setItem('session_expired', '1')
        setSessionExpired(true)
      }
      // The deliberate sign-out has now been observed; re-arm expiry detection
      // so the next account signed in from this tab is covered by it.
      if (!session) isSigningOutRef.current = false
      // Clear expired state when a fresh session is established (sign-in / token refresh).
      if (session?.user) {
        setSessionExpired(false)
        sessionStorage.removeItem('session_expired')
      }
      wasLoggedInRef.current = !!session?.user

      // Account switch: a different user is now signed in, so any page content
      // still mounted was fetched for the previous account.  Bumping
      // dataRefreshKey remounts it (ProtectedLayout uses it as a key) and
      // clears the previous user's rows before they can be shown to this one.
      const nextUserId = session?.user?.id ?? null
      if (nextUserId && prevUserIdRef.current && nextUserId !== prevUserIdRef.current) {
        setProfile(null)
        setDataRefreshKey(k => k + 1)
      }
      prevUserIdRef.current = nextUserId

      sessionRef.current = session
      setSession(session)
      setUser(session?.user ?? null)

      if (!session?.user) {
        userIdRef.current = null
        setProfile(null)
        clearTimeout(safetyTimeout)
        setLoading(false)
        return
      }

      // Skip the profile DB call for TOKEN_REFRESHED — the JWT rotated but the
      // profile row is unchanged, so there is nothing to fetch.
      if (event === 'TOKEN_REFRESHED' && session.user.id === userIdRef.current) {
        clearTimeout(safetyTimeout)
        setLoading(false)
        return
      }

      // INITIAL_SESSION / SIGNED_IN (or a different user): fetch the profile, but
      // OUTSIDE this callback so the auth lock is free by the time getSession runs.
      userIdRef.current = session.user.id
      const uid = session.user.id
      setTimeout(() => {
        fetchProfile(uid)
          .then((profileData) => setProfile(profileData))
          .catch((err) => console.error('Error fetching profile after auth change:', err))
          .finally(() => {
            clearTimeout(safetyTimeout)
            setLoading(false)
          })
      }, 0)
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
      // Do NOT call getSession() here.  Every call to getSession() acquires
      // the Supabase auth lock, which serialises ALL concurrent data-fetch
      // calls that also need getSession to get their JWT.  Calling it in
      // handleTabReturn means every component's loading spinner stalls until
      // this lock is released — exactly the "keeps loading" bug the user sees.
      //
      // Token refresh is already handled by two other mechanisms:
      //   • Supabase's internal auto-refresh timer (fires before expiry, and
      //     again when the tab becomes visible)
      //   • The near-expiry keepalive setInterval below
      // Neither of those races against page-level data fetches because they
      // run at different times and fetchWithTimeout (supabase.ts) caps any
      // network hang at a few seconds.
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

  // Record an "app open" once per signed-in user (per tab session) to drive the
  // consecutive-day streak. Fire-and-forget; failures are non-fatal and never
  // block the UI. Deferred so it never races the auth lock on sign-in.
  const streakRecordedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!user?.id) return
    if (streakRecordedForRef.current === user.id) return
    streakRecordedForRef.current = user.id
    const t = setTimeout(() => { recordAppOpen().catch(() => {}) }, 0)
    return () => clearTimeout(t)
  }, [user?.id])

  // Cross-tab session sync ────────────────────────────────────────────────────
  // The session lives in localStorage, shared by every tab, but GoTrue only
  // emits onAuthStateChange in the tab that performed the action.  Without this
  // listener a tab left open on account A keeps rendering A after the user
  // signs in as B (or signs out) in another tab, and its next write goes out
  // under B's JWT against A's UI — the classic account-switch mix-up.
  //
  // `storage` fires only in *other* tabs, so this never double-handles the
  // local action.  getSession() reads straight from localStorage, so it reports
  // whatever the other tab just wrote; it is deferred out of the event handler
  // so it never runs while GoTrue holds the auth lock.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== AUTH_STORAGE_KEY) return
      setTimeout(() => {
        supabase.auth
          .getSession()
          .then(({ data: { session: stored } }) => {
            const storedUserId = stored?.user?.id ?? null
            if (storedUserId === prevUserIdRef.current) {
              // Same account, only a rotated token — keep the fresher session
              // object so components reading `session` hold a valid JWT.
              if (stored) {
                sessionRef.current = stored
                setSession(stored)
              }
              return
            }

            // Another tab signed in as someone else, or signed out.
            prevUserIdRef.current = storedUserId
            userIdRef.current = storedUserId
            wasLoggedInRef.current = !!storedUserId
            sessionRef.current = stored
            setSession(stored)
            setUser(stored?.user ?? null)
            setProfile(null)
            setDataRefreshKey(k => k + 1)

            if (!storedUserId) {
              // A sign-out elsewhere is deliberate, not an expiry: follow it
              // without raising the "Session Expired" overlay.
              setSessionExpired(false)
              sessionStorage.removeItem('session_expired')
              return
            }
            setSessionExpired(false)
            sessionStorage.removeItem('session_expired')
            fetchProfile(storedUserId)
              .then(setProfile)
              .catch((err) => console.error('Error fetching profile after cross-tab change:', err))
          })
          .catch(() => {})
      }, 0)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [fetchProfile])

  // Keepalive ─────────────────────────────────────────────────────────────────
  // GoTrue's own auto-refresh timer covers the common cases (it fires shortly
  // before expiry and again when the tab becomes visible).  This is a backstop
  // for the case it can miss: a tab left visible but throttled by the browser,
  // where the timer runs late and the access token is already expired or about
  // to be.  It refreshes ONLY when the token is within EXPIRY_MARGIN of dying —
  // an unconditional refresh on a timer would rotate the refresh token every
  // few minutes, and any tab still holding the previous one would be signed out
  // with "Invalid Refresh Token: Already Used".
  useEffect(() => {
    const CHECK_MS = 60 * 1000        // check once a minute
    const EXPIRY_MARGIN_S = 2 * 60    // refresh when < 2 minutes of life remain
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const expiresAt = sessionRef.current?.expires_at
      if (!expiresAt) return
      if (expiresAt - Math.floor(Date.now() / 1000) > EXPIRY_MARGIN_S) return
      // Failures are non-fatal: a network error leaves the session intact and
      // GoTrue retries on its own schedule.
      supabase.auth.refreshSession().catch(() => {})
    }, CHECK_MS)
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
      // Normalized to lowercase so this always matches how every other
      // account-creation path (admin create/invite, bulk import) stores and
      // looks up emails — a mixed-case profile row makes case-sensitive
      // email lookups (e.g. bulk import's create-vs-update check) miss it.
      const normalizedEmail = email.toLowerCase().trim()
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
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
          email: normalizedEmail,
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

  const signOut = async (options?: { scope?: 'local' | 'global' }) => {
    // Mark as deliberate BEFORE calling signOut() so the SIGNED_OUT event
    // fired by onAuthStateChange is not mistaken for a token expiry.
    isSigningOutRef.current = true
    wasLoggedInRef.current = false
    // Clear local state immediately for instant UI feedback.
    setUser(null)
    setProfile(null)
    sessionRef.current = null
    setSession(null)
    prevUserIdRef.current = null
    userIdRef.current = null
    setSessionExpired(false)
    sessionStorage.removeItem('session_expired')
    // The fee module keeps student names and the price list in memory for the
    // length of a session. Another person signing in on this tab must not
    // inherit them.
    clearFeeCaches()

    // scope: 'local' revokes only THIS browser's refresh token.  GoTrue's
    // default ('global') revokes every refresh token the user has anywhere, so
    // signing out on a phone would silently sign the same person out on their
    // laptop mid-lesson — the "auto sign-out" this app is meant to avoid.
    // Callers that really do mean everywhere (password change) pass
    // scope: 'global'.  Other tabs of this browser share the session either way
    // and follow along via the storage listener.
    //
    // Awaited (not fire-and-forget) so that signing straight back in as a
    // different account cannot be clobbered: a late-resolving signOut() clears
    // the storage key as its final step, which would otherwise wipe the session
    // the next account just wrote.  Failures are ignored — the local session is
    // already gone, which is what the user asked for.
    try {
      const { error } = await supabase.auth.signOut({ scope: options?.scope ?? 'local' })
      // GoTrue bails out *before* clearing storage when the revoke call fails
      // with a network error, which would leave the old session on disk: the
      // UI says signed out, then the next reload signs the previous account
      // straight back in.  Drop the stored session ourselves so the sign-out
      // sticks even offline.
      if (error) clearStoredSession()
    } catch {
      clearStoredSession()
    } finally {
      isSigningOutRef.current = false
    }
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
