import {
  clearStateCookie,
  clearSessionCookie,
  isConfigured,
  jsonResponse,
  type PagesContext,
} from '../../_shared/github'

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  if (!isConfigured(env)) {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }
  const origin = request.headers.get('Origin')
  const expectedOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : ''
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json'
    || !origin || origin !== expectedOrigin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return jsonResponse({ error: 'request_rejected' }, 403)
  }
  const response = jsonResponse({ disconnected: true })
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', clearSessionCookie())
  headers.append('Set-Cookie', clearStateCookie())
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
