/* HUSHHUSS service worker: receives Web Push while the app is backgrounded. */
self.addEventListener('push', (event) => {
  let payload = {}

  try {
    const parsed = event.data ? event.data.json() : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed
    }
  } catch {
    payload = { body: event.data ? event.data.text() : 'Your rest is complete.' }
  }

  const title = typeof payload.title === 'string' ? payload.title : 'HUSHHUSS'
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'Rest complete. Time for your next set.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // The foreground timer uses the same tag. Reusing it replaces rather than
    // intentionally re-alerting when foreground and server delivery race.
    tag: 'husshuss-rest-timer',
    renotify: false,
    data: { url: '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL('/', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    for (const client of windows) {
      if ('focus' in client) {
        await client.focus()
        if ('navigate' in client && client.url !== target) {
          await client.navigate(target)
        }
        return
      }
    }

    await self.clients.openWindow(target)
  })())
})
