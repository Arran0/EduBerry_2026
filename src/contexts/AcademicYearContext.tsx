'use client'

// ─────────────────────────────────────────────────────────────────────────────
// One year scope for the whole fee module.
//
// The app had five independent `useState` year pickers — on the fee page, the
// bus fees section, two certificate screens and the report cards tab — each
// with its own idea of the current year and no memory between navigations.
// Switching the session to take last year's payment then meant switching it
// again on every screen you visited.
//
// This holds the choice once. The selection is remembered per browser so a
// clerk working through last year's arrears does not have to re-pick it after
// every page load, but it always starts from the year the school marked active.
// ─────────────────────────────────────────────────────────────────────────────

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  type AcademicYearRow, deriveYearCode, listAcademicYears, yearByCode,
} from '@/lib/academicYear'

const STORAGE_KEY = 'eduberry.academicYearId'

interface AcademicYearContextValue {
  /** Every stored session, newest first. */
  years: AcademicYearRow[]
  /** The session the user is looking at. Null only while loading, or if none exist. */
  year: AcademicYearRow | null
  /** The session the school marked active, regardless of what is being viewed. */
  activeYear: AcademicYearRow | null
  /** True when the user is deliberately looking at a session that is not the active one. */
  isViewingPastYear: boolean
  loading: boolean
  setYearId: (id: string) => void
  /** Return to the school's active session. */
  resetToActive: () => void
  refresh: () => Promise<void>
}

const AcademicYearContext = createContext<AcademicYearContextValue | null>(null)

export function AcademicYearProvider({ children }: { children: React.ReactNode }) {
  const [years, setYears] = useState<AcademicYearRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const rows = await listAcademicYears()
      setYears(rows)

      setSelectedId(prev => {
        // Keep a choice the user already made, as long as it still exists.
        if (prev && rows.some(r => r.id === prev)) return prev

        let stored: string | null = null
        try { stored = window.localStorage.getItem(STORAGE_KEY) } catch { /* private mode */ }
        if (stored && rows.some(r => r.id === stored)) return stored

        const active = rows.find(r => r.is_active)
        if (active) return active.id

        // No active row: fall back to the session today falls in, then to the
        // newest one, so the module is never left with nothing selected.
        const derived = yearByCode(rows, deriveYearCode())
        return derived?.id ?? rows[0]?.id ?? null
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const setYearId = useCallback((id: string) => {
    setSelectedId(id)
    try { window.localStorage.setItem(STORAGE_KEY, id) } catch { /* private mode */ }
  }, [])

  const activeYear = useMemo(() => years.find(y => y.is_active) ?? null, [years])

  const resetToActive = useCallback(() => {
    if (activeYear) setYearId(activeYear.id)
  }, [activeYear, setYearId])

  const year = useMemo(
    () => years.find(y => y.id === selectedId) ?? null,
    [years, selectedId])

  const value = useMemo<AcademicYearContextValue>(() => ({
    years,
    year,
    activeYear,
    isViewingPastYear: !!year && !!activeYear && year.id !== activeYear.id,
    loading,
    setYearId,
    resetToActive,
    refresh: load,
  }), [years, year, activeYear, loading, setYearId, resetToActive, load])

  return (
    <AcademicYearContext.Provider value={value}>{children}</AcademicYearContext.Provider>
  )
}

/** The year scope when a provider is above, else null — for components also used outside one. */
export function useMaybeAcademicYear(): AcademicYearContextValue | null {
  return useContext(AcademicYearContext)
}

export function useAcademicYear(): AcademicYearContextValue {
  const ctx = useContext(AcademicYearContext)
  if (!ctx) {
    throw new Error('useAcademicYear must be used inside an <AcademicYearProvider>')
  }
  return ctx
}
