import {
  clearStateCookie,
  createInstallState,
  createSessionCookie,
  GitHubConfigurationError,
  getSafeConfig,
  GitHubApiError,
  GitHubInstallationRejectedError,
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

type PostStage =
  | 'configuration'
  | 'origin_validation'
  | 'request_size_validation'
  | 'request_body_read'
  | 'request_body_parse'
  | 'payload_validation'
  | 'state_validation'
  | 'installation_verification'
  | 'session_cookie_signing'
  | 'response_construction'

function safeErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'NonErrorThrow'
  const knownTypes = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'OperationError',
    'NotSupportedError',
    'InvalidAccessError',
    'DataError',
    'AbortError',
  ])
  return knownTypes.has(error.name) ? error.name : 'Error'
}

function logUnexpectedPostFailure(stage: PostStage, error: unknown): void {
  try {
    console.error(JSON.stringify({
      event: 'github_connect_existing_post_unexpected_failure',
      stage,
      errorType: safeErrorType(error),
    }))
  } catch {
    // Logging must not prevent the generic error response.
  }
}

function logGitHubApiFailure(error: GitHubApiError): void {
  try {
    console.error(JSON.stringify({
      event: 'github_installation_verification_failed',
      ...error.diagnostic,
    }))
  } catch {
    // Logging must not prevent the generic error response.
  }
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
  let stage: PostStage = 'configuration'
  try {
    let origin: string
    try {
      origin = getSafeConfig(env).origin
    } catch (error) {
      if (error instanceof GitHubConfigurationError) {
        return jsonResponse({ error: 'connection_unavailable' }, 503)
      }
      throw error
    }

    stage = 'origin_validation'
    if (!requestIsOnAppOrigin(request, env) || !isSameOriginJsonPost(request, origin)) {
      return jsonResponse({ error: 'request_rejected' }, 403)
    }

    stage = 'request_size_validation'
    const contentLength = Number(request.headers.get('Content-Length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > 2048) {
      return jsonResponse({ error: 'invalid_request' }, 400)
    }

    stage = 'request_body_read'
    const body = await request.text()
    if (body.length > 2048) return jsonResponse({ error: 'invalid_request' }, 400)

    stage = 'request_body_parse'
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch (error) {
      if (error instanceof SyntaxError) {
        return jsonResponse({ error: 'invalid_request' }, 400)
      }
      throw error
    }

    stage = 'payload_validation'
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
      || !('state' in payload) || typeof payload.state !== 'string'
      || !('installationId' in payload) || typeof payload.installationId !== 'string') {
      return jsonResponse({ error: 'invalid_request' }, 400)
    }

    if (!/^\d{1,20}$/.test(payload.installationId)) {
      return jsonResponse({ error: 'invalid_installation' }, 400)
    }
    stage = 'state_validation'
    if (!await isValidInstallState(payload.state, request, env)) {
      return jsonResponse({ error: 'invalid_state' }, 403)
    }

    stage = 'installation_verification'
    let installation
    try {
      installation = await verifyInstallation(env, payload.installationId)
    } catch (error) {
      if (error instanceof GitHubApiError) {
        logGitHubApiFailure(error)
        return jsonResponse({ error: 'verification_unavailable' }, 502)
      }
      if (error instanceof GitHubInstallationRejectedError) {
        return jsonResponse({ error: 'installation_not_verified' }, 403)
      }
      throw error
    }

    stage = 'session_cookie_signing'
    const sessionCookie = await createSessionCookie(env, installation)

    stage = 'response_construction'
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
    headers.append('Set-Cookie', sessionCookie)
    headers.append('Set-Cookie', clearStateCookie())
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch (error) {
    logUnexpectedPostFailure(stage, error)
    try {
      return jsonResponse({ error: 'connection_unavailable' }, 500)
    } catch {
      throw error
    }
  }
}
