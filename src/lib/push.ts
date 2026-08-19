'use client'

/**
 * Web Push enrolment — the browser half.
 *
 * Free by construction: the app signs its own payloads with a VAPID key pair
 * and hands them to whichever push service the browser nominates (FCM for
 * Chrome, Mozilla autopush for Firefox, Apple for Safari). No paid messaging
 * product, no per-message cost.
 *
 * Server half: src/app/api/push/subscribe (enrol) and
 * src/app/api/announcements/notify (send).
 */

import { supabase } from './supabase'

const SW_PATH = '/sw.js'

export type PushStatus =
  | 'unsupported'   // no service worker / PushManager (e.g. iOS Safari in a normal tab)
  | 'denied'        // the user blocked notifications in browser settings
  | 'enabled'       // subscribed on this device
  | 'disabled'      // supported and permitted, just not subscribed here

/** VAPID public key, exposed to the browser at build time. */
export function vapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    vapidPublicKey() !== ''
  )
}

/** The VAPID key travels as base64url; PushManager wants raw bytes. */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buffer
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH)
  if (existing) return existing
  return navigator.serviceWorker.register(SW_PATH)
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH)
    const subscription = await registration?.pushManager.getSubscription()
    return subscription ? 'enabled' : 'disabled'
  } catch {
    return 'disabled'
  }
}

/** Bearer token for our own API routes — they verify the caller themselves. */
async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

/**
 * Ask permission, subscribe this device, and store the subscription.
 * Returns the resulting status so the caller can explain a refusal.
 */
export async function enablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'disabled'

  const registration = await registerServiceWorker()
  await navigator.serviceWorker.ready

  // Reuse the existing subscription if this device already has one
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(vapidPublicKey()),
    }))

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
    }),
  })

  if (!res.ok) {
    // Don't leave a subscription the server doesn't know about
    await subscription.unsubscribe().catch(() => {})
    throw new Error('Could not save the push subscription')
  }

  return 'enabled'
}

/** Unsubscribe this device and forget it server-side. */
export async function disablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'

  const registration = await navigator.serviceWorker.getRegistration(SW_PATH)
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return 'disabled'

  const endpoint = subscription.endpoint
  await subscription.unsubscribe().catch(() => {})

  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {
    // The device is already unsubscribed locally; a stale row is pruned on
    // the next send when the push service rejects the endpoint.
  })

  return 'disabled'
}

/**
 * Fire the notification for a freshly created announcement. Best-effort:
 * a push failure must never make a successfully posted announcement look
 * like it failed.
 */
export async function notifyAnnouncement(announcementId: string): Promise<void> {
  try {
    await fetch('/api/announcements/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ announcementId }),
    })
  } catch (err) {
    console.warn('Announcement push notification failed:', err)
  }
}
