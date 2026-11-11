import {
  clearStateCookie,
  createInstallState,
  createSessionCookie,
  getSafeConfig,
  GitHubApiError,
  isValidInstallState,
  jsonResponse,
  requestIsOnAppOrigin,
  verifyInstallation,
  type PagesContext,
} from '../../_shared/github'

function isSameOriginJsonPost(request: Request, origin: string): boolean {
  return request.headers.get('Origin') === origin
    && request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json'
    && request.headers.get('Sec-Fetch-Site') !== 'cross-site'
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  if (!requestIsOnAppOrigin(request, env)) {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }

  try {
    const { state, cookie } = await createInstallState(env)
    return jsonResponse({ configured: true, state }, 200, { 'Set-Cookie': cookie })
  } catch {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  let origin: string
  try {
    origin = getSafeConfig(env).origin
  } catch {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }

  if (!requestIsOnAppOrigin(request, env) || !isSameOriginJsonPost(request, origin)) {
    return jsonResponse({ error: 'request_rejected' }, 403)
  }

  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 2048) {
    return jsonResponse({ error: 'invalid_request' }, 400)
  }

  let payload: unknown
  try {
    const body = await request.text()
    if (body.length > 2048) return jsonResponse({ error: 'invalid_request' }, 400)
    payload = JSON.parse(body)
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400)
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
    || !('state' in payload) || typeof payload.state !== 'string'
    || !('installationId' in payload) || typeof payload.installationId !== 'string') {
    return jsonResponse({ error: 'invalid_request' }, 400)
  }

  if (!/^\d{1,20}$/.test(payload.installationId)) {
    return jsonResponse({ error: 'invalid_installation' }, 400)
  }
  if (!await isValidInstallState(payload.state, request, env)) {
    return jsonResponse({ error: 'invalid_state' }, 403)
  }

  let installation
  try {
    installation = await verifyInstallation(env, payload.installationId)
  } catch (error) {
    return error instanceof GitHubApiError
      ? jsonResponse({ error: 'verification_unavailable' }, 502)
      : jsonResponse({ error: 'installation_not_verified' }, 403)
  }

  try {
    const response = jsonResponse({
      configured: true,
      connected: true,
      verified: true,
      account: installation.account,
      repository: installation.repository,
      visibility: 'private',
      verifiedAt: new Date().toISOString(),
    })
    const headers = new Headers(response.headers)
    headers.append('Set-Cookie', await createSessionCookie(env, installation))
    headers.append('Set-Cookie', clearStateCookie())
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }
}
