import {
  createInstallState,
  getSafeConfig,
  jsonResponse,
  requestIsOnAppOrigin,
  type PagesContext,
} from '../../_shared/github'

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  if (!requestIsOnAppOrigin(request, env)) {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }

  try {
    const config = getSafeConfig(env)
    const { state, cookie } = await createInstallState(env)
    const url = new URL(`https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new`)
    url.searchParams.set('state', state)
    return new Response(null, {
      status: 302,
      headers: {
        'Cache-Control': 'no-store',
        Location: url.toString(),
        'Referrer-Policy': 'no-referrer',
        'Set-Cookie': cookie,
      },
    })
  } catch {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }
}
