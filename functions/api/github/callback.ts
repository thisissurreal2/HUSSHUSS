import {
  clearStateCookie,
  createSessionCookie,
  getSafeConfig,
  isValidInstallState,
  requestIsOnAppOrigin,
  verifyInstallation,
  type PagesContext,
} from '../../_shared/github'

function redirect(origin: string, result: 'complete' | 'failed', cookie?: string): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Location: `${origin}/?github_connection=${result}`,
    'Referrer-Policy': 'no-referrer',
  })
  headers.append('Set-Cookie', clearStateCookie())
  if (cookie) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  let origin: string
  try {
    origin = getSafeConfig(env).origin
  } catch {
    return new Response('Connection service is not configured.', { status: 503 })
  }
  if (!requestIsOnAppOrigin(request, env)) {
    return new Response('Connection callback rejected.', { status: 400 })
  }

  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const installationId = url.searchParams.get('installation_id')
  const setupAction = url.searchParams.get('setup_action')
  if ((setupAction !== 'install' && setupAction !== 'update') || !state || !installationId) {
    return redirect(origin, 'failed')
  }

  try {
    if (!await isValidInstallState(state, request, env)) return redirect(origin, 'failed')
    const installation = await verifyInstallation(env, installationId)
    return redirect(origin, 'complete', await createSessionCookie(env, installation))
  } catch {
    return redirect(origin, 'failed')
  }
}
