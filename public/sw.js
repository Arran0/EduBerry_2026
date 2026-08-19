/*
 * EduBerry service worker — Web Push receiver.
 *
 * Deliberately minimal: no offline caching, no fetch handler. Its only job is
 * to show announcement notifications and route a tap back into the app.
 */

self.addEventListener('install', () => {
  // Take over without waiting for existing tabs to close
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', event => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'EduBerry', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'New announcement'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/apple-touch-icon.png',
    badge: '/favicon-32.png',
    // Same tag = a re-sent notification replaces rather than stacks
    tag: payload.tag || 'eduberry-announcement',
    data: { url: payload.url || '/announcements' },
    timestamp: Date.now(),
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/announcements'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus an already-open tab and take it to the announcement
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
    })
  )
})
