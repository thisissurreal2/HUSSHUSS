import assert from 'node:assert/strict'
import { generateKeyPairSync, verify as verifySignature } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

const originalFetch = globalThis.fetch
const appOrigin = 'https://husshuss-app.pages.dev'
const appId = '5716182'
const repositoryName = 'thisissurreal2/HUSSHUSS-data'
const installationId = '180968038'
const installToken = 'test-installation-token-with-enough-length'
let vite
let env
let appPublicKey
let createInstallState
let onFirstInstallCallback
let onExistingConnectionGet
let onExistingConnectionPost
let withConnectionTimeout
let fetchCalls

before(async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  appPublicKey = publicKey
  env = {
    APP_ORIGIN: appOrigin,
    ALLOWED_REPOSITORY: repositoryName,
    GITHUB_APP_ID: appId,
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    GITHUB_APP_SLUG: 'husshuss-cloud-sync',
    SESSION_SIGNING_KEY: 'a'.repeat(64),
  }
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const helper = await vite.ssrLoadModule('/functions/_shared/github.ts')
  const callback = await vite.ssrLoadModule('/functions/api/github/callback.ts')
  const existing = await vite.ssrLoadModule('/functions/api/github/connect-existing.ts')
  const connectionRequest = await vite.ssrLoadModule('/src/connectionRequest.ts')
  createInstallState = helper.createInstallState
  onFirstInstallCallback = callback.onRequestGet
  onExistingConnectionGet = existing.onRequestGet
  onExistingConnectionPost = existing.onRequestPost
  withConnectionTimeout = connectionRequest.withConnectionTimeout
})

after(async () => {
  globalThis.fetch = originalFetch
  await vite?.close()
})

function installationResponse(overrides = {}) {
  return {
    id: Number(installationId),
    app_id: Number(appId),
    account: { login: 'thisissurreal2' },
    repository_selection: 'selected',
    target_type: 'User',
    permissions: { metadata: 'read' },
    ...overrides,
  }
}

function mockGitHub({
  installation = installationResponse(),
  repositories,
  failAt,
  failWith,
  failBody,
  networkFailAt,
  invalidJsonAt,
  beforeRepositoryResponse,
} = {}) {
  fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    fetchCalls.push({ url, init })
    assert.equal(init.headers['X-GitHub-Api-Version'], '2026-03-10')
    if (url.pathname.startsWith('/app/')) {
      const authorization = init.headers.Authorization
      assert.match(authorization, /^Bearer /)
      const jwt = authorization.slice('Bearer '.length)
      const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.')
      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
      const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString())
      const now = Math.floor(Date.now() / 1000)
      assert.equal(header.alg, 'RS256')
      assert.equal(claims.iss, appId)
      assert.ok(claims.iat <= now - 59 && claims.iat >= now - 65)
      assert.equal(claims.exp - claims.iat, 9 * 60)
      assert.ok(claims.exp <= now + 8 * 60)
      assert.equal(verifySignature(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        appPublicKey,
        Buffer.from(encodedSignature, 'base64url'),
      ), true)
    }
    if (networkFailAt === url.pathname) throw new TypeError('mock network failure')
    if (failWith && (!failAt || failAt === url.pathname)) {
      const body = typeof failBody === 'function'
        ? failBody(init)
        : failBody ?? { message: 'mock verification failure' }
      return Response.json(body, {
        status: failWith,
        headers: { 'x-github-request-id': 'MOCK-REQUEST-ID' },
      })
    }
    if (invalidJsonAt === url.pathname) return new Response('not-json', { status: 200 })
    if (url.pathname === `/app/installations/${installationId}` && init.method !== 'POST') {
      return Response.json(installation)
    }
    if (url.pathname === `/app/installations/${installationId}/access_tokens` && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { permissions: { metadata: 'read' } })
      return Response.json({ token: installToken })
    }
    if (url.pathname === '/installation/repositories') {
      assert.equal(init.headers.Authorization, `Bearer ${installToken}`)
      const response = Response.json(repositories ?? {
        total_count: 1,
        repositories: [{ full_name: repositoryName, private: true }],
      })
      beforeRepositoryResponse?.()
      return response
    }
    throw new Error(`Unexpected mocked GitHub request: ${url}`)
  }
}

async function beginExistingConnection() {
  const response = await onExistingConnectionGet({
    request: new Request(`${appOrigin}/api/github/connect-existing`),
    env,
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  const stateCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith('__Host-husshuss_github_state='))
  assert.ok(stateCookie)
  return { state: body.state, cookie: stateCookie.split(';')[0] }
}

async function submitExistingConnection({
  state,
  cookie,
  id = installationId,
  modifyRequest,
  requestEnv = env,
}) {
  const request = new Request(`${appOrigin}/api/github/connect-existing`, {
    method: 'POST',
    headers: {
      Origin: appOrigin,
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookie,
    },
    body: JSON.stringify({ state, installationId: id }),
  })
  modifyRequest?.(request)
  return onExistingConnectionPost({
    request,
    env: requestEnv,
  })
}

async function captureUnexpectedFailure(challenge, options = {}) {
  const logged = []
  const originalError = console.error
  console.error = (...values) => logged.push(values.join(' '))
  try {
    const response = await submitExistingConnection({ ...challenge, ...options })
    return { response, logged }
  } finally {
    console.error = originalError
  }
}

test('GitHub connection supports first-time and already-installed flows securely', async (context) => {
  await context.test('first-time installation callback verifies before setting the session', async () => {
    mockGitHub()
    const { state, cookie } = await createInstallState(env)
    const response = await onFirstInstallCallback({
      request: new Request(`${appOrigin}/api/github/callback?setup_action=install&installation_id=${installationId}&state=${encodeURIComponent(state)}`, {
        headers: { Cookie: cookie.split(';')[0] },
      }),
      env,
    })
    assert.equal(response.status, 302)
    assert.equal(new URL(response.headers.get('Location')).searchParams.get('github_connection'), 'complete')
    const cookies = response.headers.getSetCookie()
    assert.ok(cookies.some((value) => value.startsWith('__Host-husshuss_github=') && value.includes('HttpOnly') && value.includes('Secure')))
    assert.ok(cookies.some((value) => value.startsWith('__Host-husshuss_github_state=;') && value.includes('Max-Age=0')))
    assert.equal(fetchCalls.length, 3)
  })

  await context.test('already-installed flow issues a state-bound session only after verification', async () => {
    mockGitHub()
    const challenge = await beginExistingConnection()
    const response = await submitExistingConnection(challenge)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.connected, true)
    assert.equal(result.verified, true)
    assert.equal(result.account, 'thisissurreal2')
    assert.equal(result.repository, repositoryName)
    assert.equal(result.visibility, 'private')
    assert.equal(JSON.stringify(result).includes(installToken), false)
    const cookies = response.headers.getSetCookie()
    assert.ok(cookies.some((value) => value.startsWith('__Host-husshuss_github=') && value.includes('HttpOnly') && value.includes('Secure')))
    assert.ok(cookies.some((value) => value.startsWith('__Host-husshuss_github_state=;') && value.includes('Max-Age=0')))
    assert.equal(fetchCalls.length, 3)
  })

  await context.test('rejects malformed installation IDs before contacting GitHub', async () => {
    mockGitHub()
    const challenge = await beginExistingConnection()
    const response = await submitExistingConnection({ ...challenge, id: '180968038x' })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'invalid_installation')
    assert.equal(fetchCalls.length, 0)
  })

  await context.test('logs safe diagnostics for GitHub API failures at each verification stage', async (subtests) => {
    const cases = [
      {
        name: 'installation lookup',
        path: `/app/installations/${installationId}`,
        stage: 'installation_lookup',
        status: 401,
        body: { message: `Bad credentials for installation ${installationId}`, errors: [{ code: 'invalid' }] },
        expectedMessage: 'Bad credentials for installation [REDACTED_SECRET]',
      },
      {
        name: 'installation token creation',
        path: `/app/installations/${installationId}/access_tokens`,
        stage: 'installation_token_creation',
        status: 422,
        body: { message: 'Validation failed', errors: [{ code: 'unprocessable', message: 'Permission denied' }] },
      },
      {
        name: 'repository listing',
        path: '/installation/repositories',
        stage: 'repository_listing',
        status: 403,
        body: { message: 'Resource not accessible by integration' },
      },
    ]

    for (const item of cases) {
      await subtests.test(item.name, async () => {
        mockGitHub({ failAt: item.path, failWith: item.status, failBody: item.body })
        const challenge = await beginExistingConnection()
        const logged = []
        const originalError = console.error
        console.error = (...values) => logged.push(values.join(' '))
        let response
        try {
          response = await submitExistingConnection(challenge)
        } finally {
          console.error = originalError
        }

        assert.equal(response.status, 502)
        assert.deepEqual(await response.json(), { error: 'verification_unavailable' })
        assert.equal(response.headers.getSetCookie().length, 0)
        assert.equal(logged.length, 1)
        const diagnostic = JSON.parse(logged[0])
        assert.equal(diagnostic.event, 'github_installation_verification_failed')
        assert.equal(diagnostic.stage, item.stage)
        assert.equal(diagnostic.status, item.status)
        assert.equal(diagnostic.message, item.expectedMessage ?? item.body.message)
        assert.equal(diagnostic.requestId, 'MOCK-REQUEST-ID')
        assert.equal(logged[0].includes(installationId), false)
        if (item.body.errors) assert.equal(diagnostic.code, item.body.errors[0].code)
        assert.equal(logged[0].includes(env.GITHUB_APP_PRIVATE_KEY), false)
        assert.equal(logged[0].includes(installToken), false)
        assert.equal(logged[0].includes(challenge.cookie), false)
      })
    }
  })

  await context.test('logs safe network and malformed-response diagnostics without changing the public error', async (subtests) => {
    const cases = [
      {
        name: 'network failure',
        options: { networkFailAt: `/app/installations/${installationId}` },
        stage: 'installation_lookup',
        status: null,
        code: 'NETWORK_ERROR',
      },
      {
        name: 'invalid JSON response',
        options: { invalidJsonAt: `/app/installations/${installationId}` },
        stage: 'installation_lookup',
        status: 200,
        code: 'INVALID_JSON_RESPONSE',
      },
    ]

    for (const item of cases) {
      await subtests.test(item.name, async () => {
        mockGitHub(item.options)
        const challenge = await beginExistingConnection()
        const logged = []
        const originalError = console.error
        console.error = (...values) => logged.push(values.join(' '))
        let response
        try {
          response = await submitExistingConnection(challenge)
        } finally {
          console.error = originalError
        }

        assert.equal(response.status, 502)
        assert.deepEqual(await response.json(), { error: 'verification_unavailable' })
        const diagnostic = JSON.parse(logged[0])
        assert.equal(diagnostic.stage, item.stage)
        assert.equal(diagnostic.status, item.status)
        assert.equal(diagnostic.code, item.code)
      })
    }
  })

  await context.test('redacts token and JWT-shaped strings from GitHub error messages', async () => {
    const fakeToken = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'
    const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue123'
    mockGitHub({
      failAt: `/app/installations/${installationId}`,
      failWith: 401,
      failBody: { message: `Rejected ${fakeToken} ${fakeJwt}` },
    })
    const challenge = await beginExistingConnection()
    const logged = []
    const originalError = console.error
    console.error = (...values) => logged.push(values.join(' '))
    try {
      const response = await submitExistingConnection(challenge)
      assert.equal(response.status, 502)
      assert.deepEqual(await response.json(), { error: 'verification_unavailable' })
    } finally {
      console.error = originalError
    }
    assert.equal(logged.length, 1)
    assert.equal(logged[0].includes(fakeToken), false)
    assert.equal(logged[0].includes(fakeJwt), false)
    assert.match(JSON.parse(logged[0]).message, /\[REDACTED_TOKEN\].*\[REDACTED_JWT\]/)
  })

  await context.test('redacts the exact bearer credential if GitHub echoes it in an error', async () => {
    mockGitHub({
      failAt: '/installation/repositories',
      failWith: 401,
      failBody: (init) => ({ message: `Rejected ${init.headers.Authorization}` }),
    })
    const challenge = await beginExistingConnection()
    const logged = []
    const originalError = console.error
    console.error = (...values) => logged.push(values.join(' '))
    try {
      const response = await submitExistingConnection(challenge)
      assert.equal(response.status, 502)
      assert.deepEqual(await response.json(), { error: 'verification_unavailable' })
    } finally {
      console.error = originalError
    }
    assert.equal(logged.length, 1)
    assert.equal(logged[0].includes(fetchCalls[0].init.headers.Authorization), false)
    assert.match(JSON.parse(logged[0]).message, /\[REDACTED_SECRET\]/)
  })

  await context.test('returns a safe 500 and logs unexpected exceptions at each major stage', async (subtests) => {
    const cases = [
      {
        name: 'configuration',
        stage: 'configuration',
        options: {
          requestEnv: new Proxy(env, {
            get(target, property, receiver) {
              if (property === 'APP_ORIGIN') throw new TypeError('sensitive environment binding')
              return Reflect.get(target, property, receiver)
            },
          }),
        },
      },
      {
        name: 'origin validation',
        stage: 'origin_validation',
        options: {
          modifyRequest: (request) => {
            const originalGet = request.headers.get.bind(request.headers)
            request.headers.get = (name) => {
              if (name === 'Origin') throw new TypeError('sensitive header')
              return originalGet(name)
            }
          },
        },
      },
      {
        name: 'request size validation',
        stage: 'request_size_validation',
        options: {
          modifyRequest: (request) => {
            const originalGet = request.headers.get.bind(request.headers)
            request.headers.get = (name) => {
              if (name === 'Content-Length') throw new TypeError('sensitive header')
              return originalGet(name)
            }
          },
        },
      },
      {
        name: 'request body read',
        stage: 'request_body_read',
        options: {
          modifyRequest: (request) => {
            request.text = async () => { throw new TypeError('sensitive body read failure') }
          },
        },
      },
      {
        name: 'request body parse',
        stage: 'request_body_parse',
        before: () => {
          const originalParse = JSON.parse
          JSON.parse = (value, ...args) => {
            if (typeof value === 'string' && value.includes('"installationId"')) {
              throw new TypeError('sensitive parse failure')
            }
            return originalParse(value, ...args)
          }
          return () => { JSON.parse = originalParse }
        },
      },
      {
        name: 'state validation',
        stage: 'state_validation',
        options: {
          modifyRequest: (request) => {
            const originalGet = request.headers.get.bind(request.headers)
            request.headers.get = (name) => {
              if (name === 'Cookie') throw new TypeError('sensitive cookie')
              return originalGet(name)
            }
          },
        },
      },
      {
        name: 'installation verification',
        stage: 'installation_verification',
        before: () => {
          const originalImportKey = crypto.subtle.importKey.bind(crypto.subtle)
          crypto.subtle.importKey = async (format, keyData, algorithm, ...rest) => {
            if (typeof algorithm === 'object' && algorithm.name === 'RSASSA-PKCS1-v1_5') {
              throw new TypeError('sensitive signing key failure')
            }
            return originalImportKey(format, keyData, algorithm, ...rest)
          }
          return () => { crypto.subtle.importKey = originalImportKey }
        },
      },
      {
        name: 'session cookie signing',
        stage: 'session_cookie_signing',
        before: () => {
          const originalSign = crypto.subtle.sign.bind(crypto.subtle)
          crypto.subtle.sign = async (algorithm, ...args) => {
            if (algorithm === 'HMAC' || (typeof algorithm === 'object' && algorithm.name === 'HMAC')) {
              throw new TypeError('sensitive signing secret failure')
            }
            return originalSign(algorithm, ...args)
          }
          return () => { crypto.subtle.sign = originalSign }
        },
      },
      {
        name: 'response construction',
        stage: 'response_construction',
        configureMock: () => {
          const originalHeaders = globalThis.Headers
          mockGitHub({
            beforeRepositoryResponse: () => {
              globalThis.Headers = class extends originalHeaders {
                constructor(...args) {
                  super(...args)
                  throw new TypeError('sensitive response construction failure')
                }
              }
            },
          })
          return () => { globalThis.Headers = originalHeaders }
        },
      },
    ]

    for (const item of cases) {
      await subtests.test(item.name, async () => {
        const restoreMock = item.configureMock?.()
        if (!item.configureMock) mockGitHub()
        const challenge = await beginExistingConnection()
        const restore = item.before?.()
        try {
          const { response, logged } = await captureUnexpectedFailure(challenge, item.options)
          assert.equal(response.status, item.status ?? 500)
          assert.deepEqual(await response.json(), { error: 'connection_unavailable' })
          assert.equal(logged.length, 1)
          const diagnostic = JSON.parse(logged[0])
          assert.equal(diagnostic.event, 'github_connect_existing_post_unexpected_failure')
          assert.equal(diagnostic.stage, item.stage)
          assert.ok(diagnostic.errorType)
          assert.equal(logged[0].includes(installationId), false)
          assert.equal(logged[0].includes(challenge.cookie), false)
          assert.equal(logged[0].includes(challenge.state), false)
          assert.equal(logged[0].includes(env.GITHUB_APP_PRIVATE_KEY), false)
          assert.equal(logged[0].includes(env.SESSION_SIGNING_KEY), false)
          assert.equal(logged[0].includes(installToken), false)
        } finally {
          restore?.()
          restoreMock?.()
        }
      })
    }
  })

  await context.test('preserves the service-unavailable response for missing configuration', async () => {
    const challenge = await beginExistingConnection()
    const response = await submitExistingConnection({ ...challenge, requestEnv: {} })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'connection_unavailable' })
  })

  await context.test('browser connection request timeout aborts and settles the pending operation', async () => {
    let receivedSignal
    await assert.rejects(
      withConnectionTimeout((signal) => {
        receivedSignal = signal
        return new Promise(() => {})
      }, 10),
      /timed out/,
    )
    assert.equal(receivedSignal.aborted, true)
  })

  await context.test('rejects installations outside the required app/account/scope/permission/repository', async (subtests) => {
    const cases = [
      ['wrong app ID', { installation: installationResponse({ app_id: 999 }) }],
      ['wrong installation ID', { installation: installationResponse({ id: 1 }) }],
      ['wrong account', { installation: installationResponse({ account: { login: 'someone-else' } }) }],
      ['all-repository installation', { installation: installationResponse({ repository_selection: 'all' }) }],
      ['write or extra app permission', { installation: installationResponse({ permissions: { metadata: 'write' } }) }],
      ['extra repository permission', { installation: installationResponse({ permissions: { metadata: 'read', contents: 'read' } }) }],
      ['wrong repository', { repositories: { total_count: 1, repositories: [{ full_name: 'thisissurreal2/HUSSHUSS', private: true }] } }],
      ['public repository', { repositories: { total_count: 1, repositories: [{ full_name: repositoryName, private: false }] } }],
      ['multiple repositories', { repositories: { total_count: 2, repositories: [
        { full_name: repositoryName, private: true },
        { full_name: 'thisissurreal2/other', private: true },
      ] } }],
    ]

    for (const [label, mock] of cases) {
      await subtests.test(label, async () => {
        mockGitHub(mock)
        const challenge = await beginExistingConnection()
        const response = await submitExistingConnection(challenge)
        assert.equal(response.status, 403)
        assert.equal((await response.json()).error, 'installation_not_verified')
        assert.equal(response.headers.getSetCookie().length, 0)
      })
    }
  })

  await context.test('rejects a missing or mismatched state cookie', async () => {
    mockGitHub()
    const challenge = await beginExistingConnection()
    const response = await submitExistingConnection({ ...challenge, cookie: '' })
    assert.equal(response.status, 403)
    assert.equal((await response.json()).error, 'invalid_state')
    assert.equal(fetchCalls.length, 0)
  })
})
