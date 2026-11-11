import {
  createSessionCookie,
  getSession,
  isConfigured,
  jsonResponse,
  requestIsOnAppOrigin,
  verifyInstallation,
  type PagesContext,
} from '../../_shared/github'

export async function onRequestGet({ request, env }: PagesContext): Promise<Response> {
  if (!requestIsOnAppOrigin(request, env)) {
    return jsonResponse({ error: 'connection_unavailable' }, 503)
  }
  if (!isConfigured(env)) {
    return jsonResponse({ configured: false, connected: false })
  }

  let session
  try {
    session = await getSession(request, env)
  } catch {
    return jsonResponse({ configured: true, connected: false, error: 'verification_unavailable' }, 503)
  }
  if (!session) return jsonResponse({ configured: true, connected: false })

  try {
    const installation = await verifyInstallation(env, session.installationId)
    return jsonResponse({
      configured: true,
      connected: true,
      verified: true,
      account: installation.account,
      repository: installation.repository,
      visibility: 'private',
      verifiedAt: new Date().toISOString(),
    }, 200, { 'Set-Cookie': await createSessionCookie(env, installation) })
  } catch {
    return jsonResponse({ configured: true, connected: false, error: 'verification_unavailable' }, 503)
  }
}
