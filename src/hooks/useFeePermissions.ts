'use client'

// The caller's fee permissions, fetched once per session and shared.
//
// Every fee screen asks "can this person do X" many times per render, and the
// answer only changes when an administrator edits the matrix. One RPC on mount,
// cached in a module-level promise so several components mounting together do
// not each fire it.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { fetchMyFeePermissions, type FeePermissionKey } from '@/lib/fees/permissions'

let inflight: Promise<Set<FeePermissionKey>> | null = null
let cachedFor: string | null = null

function load(userId: string): Promise<Set<FeePermissionKey>> {
  if (inflight && cachedFor === userId) return inflight
  cachedFor = userId
  inflight = fetchMyFeePermissions().catch(() => new Set<FeePermissionKey>())
  return inflight
}

/** Drop the cache after the matrix is edited, so the UI reflects it immediately. */
export function invalidateFeePermissions(): void {
  inflight = null
  cachedFor = null
}

export interface FeePermissionState {
  loading: boolean
  keys: Set<FeePermissionKey>
  /** Does the caller hold this permission? */
  can: (key: FeePermissionKey) => boolean
  /** Does the caller hold every one of these? */
  canAll: (...keys: FeePermissionKey[]) => boolean
  /** Does the caller hold at least one of these? */
  canAny: (...keys: FeePermissionKey[]) => boolean
  /**
   * True when amounts must be hidden. Note this only governs what the interface
   * draws — the server already withholds the numbers themselves.
   */
  amountsHidden: boolean
  reload: () => void
}

export function useFeePermissions(): FeePermissionState {
  const { user } = useAuth()
  const [keys, setKeys] = useState<Set<FeePermissionKey>>(new Set())
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!user) { setKeys(new Set()); setLoading(false); return }
    setLoading(true)
    load(user.id).then(result => {
      if (!cancelled) { setKeys(result); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [user, nonce])

  const can = useCallback((key: FeePermissionKey) => keys.has(key), [keys])
  const canAll = useCallback((...ks: FeePermissionKey[]) => ks.every(k => keys.has(k)), [keys])
  const canAny = useCallback((...ks: FeePermissionKey[]) => ks.some(k => keys.has(k)), [keys])

  const reload = useCallback(() => {
    invalidateFeePermissions()
    setNonce(n => n + 1)
  }, [])

  return {
    loading,
    keys,
    can,
    canAll,
    canAny,
    amountsHidden: !loading && !keys.has('fees.view_amounts'),
    reload,
  }
}
