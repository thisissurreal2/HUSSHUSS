import { jsonResponse } from '../../_shared/github'

type MiddlewareContext = {
  request: Request
  env: { PAIRING_SECRET?: string }
  next: () => Promise<Response>
}

const PAIRING_HEADER = 'X-Husshuss-Pairing'
const MIN_SECRET_LENGTH = 32
const textEncoder = new TextEncoder()

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)))
}

async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(provided), digest(expected)])
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

export async function onRequest({ request, env, next }: MiddlewareContext): Promise<Response> {
  const path = new URL(request.url).pathname

  // The browser-redirect install flow cannot send the pairing header, so it is disabled.
  if (path === '/api/github/connect' || path === '/api/github/callback') {
    return jsonResponse({ error: 'not_available' }, 404)
  }

  const expected = env.PAIRING_SECRET
  if (!expected || expected.length < MIN_SECRET_LENGTH) {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }

  const provided = request.headers.get(PAIRING_HEADER) ?? ''
  if (!await secretsMatch(provided, expected)) {
    return jsonResponse({ error: 'pairing_required' }, 401)
  }

  return next()
}