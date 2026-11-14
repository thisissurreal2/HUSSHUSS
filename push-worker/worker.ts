import { buildPushPayload } from '@block65/webcrypto-web-push'

type WebPushSubscription = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}
type VapidKeys = { subject: string; publicKey: string; privateKey: string }
type Env = {
  PUSH_DEVICES: DurableObjectNamespaceLike
  APP_ORIGIN: string
  VAPID_SUBJECT: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
}
type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
}
type DurableObjectStateLike = {
  storage: {
    get<T>(key: string): Promise<T | undefined>
    put<T>(key: string, value: T): Promise<void>
    delete(key: string): Promise<boolean>
    setAlarm(timestamp: number | Date): Promise<void>
    deleteAlarm(): Promise<void>
    deleteAll(): Promise<void>
  }
}
type StoredDevice = { tokenHash: string; subscription: WebPushSubscription }
type TimerPayload = { deadline: number; title: string; body: string; url: string; attempts?: number }
type JsonRead =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 }

const encoder = new TextEncoder()
const MAX_REQUEST_BYTES = 12 * 1024
const REGISTRATION_LIMIT = 5
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

async function readJson(request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<JsonRead> {
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (declaredLength > maxBytes) return { ok: false, status: 413 }
  if (!request.body) return { ok: false, status: 400 }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, status: 413 }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, status: 400 }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: false, status: 400 }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function randomToken(bytes = 32): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function isDeviceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isTrustedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com'
      || host === 'web.push.apple.com'
      || host.endsWith('.push.apple.com')
      || host === 'updates.push.services.mozilla.com'
      || host.endsWith('.notify.windows.com')
  } catch {
    return false
  }
}

function isSubscription(value: unknown): value is WebPushSubscription {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || value.endpoint.length > 4096) return false
  if (!isTrustedPushEndpoint(value.endpoint) || !isRecord(value.keys)) return false
  const p256dh = value.keys.p256dh
  const auth = value.keys.auth
  if (
    typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(p256dh) ||
    typeof auth !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(auth)
  ) return false
  if (
    value.expirationTime !== undefined &&
    value.expirationTime !== null &&
    (typeof value.expirationTime !== 'number' || !Number.isFinite(value.expirationTime))
  ) return false
  return true
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

function cors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-HUSHHUSS-Device')
  headers.set('Vary', 'Origin')
  return new Response(response.body, { status: response.status, headers })
}

function getBearerToken(request: Request): string {
  return request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
}

export class PushDevice {
  private readonly state: DurableObjectStateLike
  private readonly env: Env

  constructor(state: DurableObjectStateLike, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

    const parsed = await readJson(request)
    if (!parsed.ok) return json({ error: parsed.status === 413 ? 'payload_too_large' : 'invalid_json' }, parsed.status)
    if (!isRecord(parsed.value)) return json({ error: 'invalid_body' }, 400)
    const body = parsed.value

    if (url.pathname === '/internal/rate-limit') {
      const now = Date.now()
      const previous = await this.state.storage.get<number[]>('registrationAttempts') ?? []
      const recent = previous.filter((timestamp) => Number.isSafeInteger(timestamp) && timestamp > now - REGISTRATION_WINDOW_MS)
      if (recent.length >= REGISTRATION_LIMIT) {
        await this.state.storage.put('registrationAttempts', recent)
        return json({ error: 'registration_rate_limited' }, 429)
      }
      recent.push(now)
      await this.state.storage.put('registrationAttempts', recent)
      return json({ ok: true })
    }

    if (url.pathname === '/internal/register') {
      const subscription = body.subscription
      if (!isSubscription(subscription)) return json({ error: 'invalid_subscription' }, 400)

      const existing = await this.state.storage.get<StoredDevice>('device')
      if (existing) {
        const providedToken = getBearerToken(request)
        if (!providedToken || !sameSecret(await hashToken(providedToken), existing.tokenHash)) {
          return json({ error: 'unauthorized' }, 401)
        }
        await this.state.storage.put('device', { ...existing, subscription })
        return json({ ok: true, reused: true })
      }

      const token = typeof body.token === 'string' ? body.token : ''
      if (getBearerToken(request) || !/^[0-9a-f]{64}$/i.test(token)) {
        return json({ error: 'invalid_registration' }, 400)
      }
      await this.state.storage.put('device', {
        tokenHash: await hashToken(token),
        subscription,
      } satisfies StoredDevice)
      return json({ ok: true, reused: false })
    }

    const stored = await this.state.storage.get<StoredDevice>('device')
    const providedToken = getBearerToken(request)
    if (!stored || !providedToken || !sameSecret(await hashToken(providedToken), stored.tokenHash)) {
      return json({ error: 'unauthorized' }, 401)
    }

    if (url.pathname === '/internal/schedule') {
      const deadline = body.deadline
      if (
        typeof deadline !== 'number' ||
        !Number.isSafeInteger(deadline) ||
        deadline < Date.now() - 5_000 ||
        deadline > Date.now() + 11 * 60_000
      ) {
        return json({ error: 'invalid_deadline' }, 400)
      }
      const payload: TimerPayload = {
        deadline,
        title: typeof body.title === 'string' ? body.title.slice(0, 80) : 'REST COMPLETE',
        body: typeof body.body === 'string' ? body.body.slice(0, 180) : 'Your rest is over. Time for the next set.',
        url: '/',
      }
      await this.state.storage.put('timer', payload)
      await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, deadline))
      return json({ ok: true, scheduledFor: deadline })
    }

    if (url.pathname === '/internal/cancel') {
      await this.state.storage.delete('timer')
      await this.state.storage.deleteAlarm()
      return json({ ok: true })
    }

    return json({ error: 'not_found' }, 404)
  }

  async alarm(): Promise<void> {
    const [device, timer] = await Promise.all([
      this.state.storage.get<StoredDevice>('device'),
      this.state.storage.get<TimerPayload>('timer'),
    ])
    if (!device || !timer) return
    if (timer.deadline > Date.now()) {
      await this.state.storage.setAlarm(timer.deadline)
      return
    }

    const vapid: VapidKeys = {
      subject: this.env.VAPID_SUBJECT,
      publicKey: this.env.VAPID_PUBLIC_KEY,
      privateKey: this.env.VAPID_PRIVATE_KEY,
    }
    const message = {
      data: JSON.stringify({
        title: timer.title,
        body: timer.body,
        url: timer.url,
        tag: 'husshuss-rest-timer',
      }),
      options: { ttl: 600 },
    }

    try {
      const pushSubscription = {
        ...device.subscription,
        expirationTime: device.subscription.expirationTime ?? null,
      }
      const response = await fetch(pushSubscription.endpoint, {
        ...await buildPushPayload(message, pushSubscription, vapid),
        redirect: 'manual',
      })

      if (response.status === 404 || response.status === 410) {
        await this.state.storage.deleteAll()
        return
      }

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await this.retryTimer(timer, `Push service returned ${response.status}`)
          return
        }
        throw new Error(`Push service returned ${response.status}`)
      }

      await this.state.storage.delete('timer')
    } catch (error) {
      await this.retryTimer(
        timer,
        error instanceof Error ? error.message : 'Unknown push delivery error',
      )
    }
  }

  private async retryTimer(timer: TimerPayload, reason: string): Promise<void> {
    const attempts = (timer.attempts ?? 0) + 1
    console.error('HUSHHUSS push delivery failed', reason, `attempt ${attempts}`)

    if (attempts > 3) {
      await this.state.storage.delete('timer')
      return
    }

    await this.state.storage.put('timer', { ...timer, attempts })
    await this.state.storage.setAlarm(Date.now() + 20_000)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    if (!origin || origin !== env.APP_ORIGIN) return json({ error: 'origin_not_allowed' }, 403)
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env.APP_ORIGIN)

    const url = new URL(request.url)
    if (url.pathname === '/config' && request.method === 'GET') {
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
        return cors(json({ error: 'push_not_configured' }, 503), env.APP_ORIGIN)
      }
      return cors(json({ vapidPublicKey: env.VAPID_PUBLIC_KEY }), env.APP_ORIGIN)
    }

    if (url.pathname === '/register' && request.method === 'POST') {
      const parsed = await readJson(request)
      if (!parsed.ok) return cors(json({ error: parsed.status === 413 ? 'payload_too_large' : 'invalid_json' }, parsed.status), env.APP_ORIGIN)
      if (!isRecord(parsed.value) || !isSubscription(parsed.value.subscription)) {
        return cors(json({ error: 'invalid_subscription' }, 400), env.APP_ORIGIN)
      }

      const suppliedDeviceId = request.headers.get('X-HUSHHUSS-Device') ?? ''
      const suppliedToken = getBearerToken(request)
      let deviceId = suppliedDeviceId
      let token = suppliedToken
      let isNewDevice = false

      if (deviceId || token) {
        if (!isDeviceId(deviceId) || !/^[0-9a-f]{64}$/i.test(token)) {
          return cors(json({ error: 'invalid_credentials' }, 401), env.APP_ORIGIN)
        }
      } else {
        const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown'
        const rateStub = env.PUSH_DEVICES.get(env.PUSH_DEVICES.idFromName(`registration-rate:${clientIp}`))
        const rateResponse = await rateStub.fetch('https://device.internal/internal/rate-limit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (rateResponse.status === 429) return cors(json({ error: 'registration_rate_limited' }, 429), env.APP_ORIGIN)
        if (!rateResponse.ok) return cors(json({ error: 'registration_unavailable' }, 503), env.APP_ORIGIN)

        deviceId = crypto.randomUUID()
        token = randomToken()
        isNewDevice = true
      }

      const stub = env.PUSH_DEVICES.get(env.PUSH_DEVICES.idFromName(deviceId))
      const registrationResponse = await stub.fetch('https://device.internal/internal/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isNewDevice ? {} : { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          ...(isNewDevice ? { token } : {}),
          subscription: parsed.value.subscription,
        }),
      })

      if (registrationResponse.status === 401) {
        return cors(json({ error: 'registration_expired' }, 401), env.APP_ORIGIN)
      }
      if (!registrationResponse.ok) return cors(json({ error: 'registration_failed' }, 500), env.APP_ORIGIN)
      return cors(json({ deviceId, token }), env.APP_ORIGIN)
    }

    if (url.pathname === '/schedule' || url.pathname === '/cancel') {
      if (request.method !== 'POST') return cors(json({ error: 'method_not_allowed' }, 405), env.APP_ORIGIN)
      const deviceId = request.headers.get('X-HUSHHUSS-Device') ?? ''
      const token = getBearerToken(request)
      if (!isDeviceId(deviceId) || !/^[0-9a-f]{64}$/i.test(token)) {
        return cors(json({ error: 'unauthorized' }, 401), env.APP_ORIGIN)
      }

      const parsed = await readJson(request)
      if (!parsed.ok) return cors(json({ error: parsed.status === 413 ? 'payload_too_large' : 'invalid_json' }, parsed.status), env.APP_ORIGIN)
      if (!isRecord(parsed.value)) return cors(json({ error: 'invalid_body' }, 400), env.APP_ORIGIN)

      const stub = env.PUSH_DEVICES.get(env.PUSH_DEVICES.idFromName(deviceId))
      const response = await stub.fetch(`https://device.internal/internal/${url.pathname.slice(1)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(parsed.value),
      })
      return cors(new Response(response.body, { status: response.status, headers: response.headers }), env.APP_ORIGIN)
    }

    return cors(json({ error: 'not_found' }, 404), env.APP_ORIGIN)
  },
}
