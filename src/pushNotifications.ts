const DEVICE_KEY = 'husshuss.push.device.v1'
let pushRequestQueue: Promise<void> = Promise.resolve()

type DeviceCredentials = { deviceId: string; token: string }
type PushConfig = { vapidPublicKey: string }

function apiBase(): string {
  return (import.meta.env.VITE_PUSH_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function isDeviceCredentials(value: unknown): value is DeviceCredentials {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.deviceId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.deviceId)
    && typeof candidate.token === 'string'
    && /^[0-9a-f]{64}$/i.test(candidate.token)
}

export function hasPushRegistration(): boolean {
  return readCredentials() !== null
}

function readCredentials(): DeviceCredentials | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isDeviceCredentials(parsed)) {
      localStorage.removeItem(DEVICE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function post(
  path: string,
  body: unknown,
  credentials?: DeviceCredentials,
): Promise<Response> {
  const base = apiBase()
  if (!base) {
    throw new Error('Push notifications are not configured yet. The Cloudflare notification worker still needs to be deployed.')
  }
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(credentials
        ? {
            Authorization: `Bearer ${credentials.token}`,
            'X-HUSHHUSS-Device': credentials.deviceId,
          }
        : {}),
    },
    body: JSON.stringify(body),
  })
}

export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

async function registerSubscription(
  subscription: PushSubscription,
  credentials?: DeviceCredentials,
): Promise<DeviceCredentials> {
  const response = await post('/register', { subscription: subscription.toJSON() }, credentials)

  if (!response.ok) {
    if (response.status === 401 && credentials) {
      throw new Error('Your saved notification registration has expired. Please enable background alerts again.')
    }
    if (response.status === 429) {
      throw new Error('Too many notification registrations were requested. Please try again later.')
    }
    throw new Error('Could not register this device for notifications.')
  }

  const result: unknown = await response.json()
  if (!isDeviceCredentials(result)) {
    throw new Error('The notification service returned an invalid device registration.')
  }
  return result
}

export async function enablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('This browser does not support Home Screen push notifications.')
  }

  const isInstalled = window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  if (!isInstalled) {
    throw new Error('Open HUSHHUSS from its Home Screen icon to enable iPhone notifications.')
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const base = apiBase()
  if (!base) throw new Error('The notification service has not been configured yet.')

  const configResponse = await fetch(`${base}/config`)
  if (!configResponse.ok) throw new Error('Could not load notification configuration.')
  const config = await configResponse.json() as PushConfig
  if (!config.vapidPublicKey) throw new Error('The notification service is missing its public key.')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(config.vapidPublicKey) as BufferSource,
    })
  }

  const existingCredentials = readCredentials()
  let credentials: DeviceCredentials

  try {
    credentials = await registerSubscription(subscription, existingCredentials ?? undefined)
  } catch (error) {
    // A 401 means the server-side registration no longer exists. Only then
    // discard the stale local credentials and create a fresh device identity.
    if (
      existingCredentials &&
      error instanceof Error &&
      error.message.startsWith('Your saved notification registration has expired.')
    ) {
      localStorage.removeItem(DEVICE_KEY)
      credentials = await registerSubscription(subscription)
    } else {
      throw error
    }
  }

  localStorage.setItem(DEVICE_KEY, JSON.stringify(credentials))
}

export function scheduleRestPush(deadline: number): Promise<void> {
  const task = pushRequestQueue.then(async () => {
    const credentials = readCredentials()
    if (!credentials) return
    const response = await post(
      '/schedule',
      {
        deadline,
        title: 'REST COMPLETE',
        body: 'Your rest is over. Time for the next set.',
        url: '/',
      },
      credentials,
    )
    if (!response.ok) throw new Error('Could not schedule the background rest notification.')
  })
  pushRequestQueue = task.catch(() => undefined)
  return task
}

export function cancelRestPush(): Promise<void> {
  const task = pushRequestQueue.then(async () => {
    const credentials = readCredentials()
    if (!credentials) return
    const response = await post('/cancel', {}, credentials)
    if (!response.ok) throw new Error('Could not cancel the background rest notification.')
  })
  pushRequestQueue = task.catch(() => undefined)
  return task
}
