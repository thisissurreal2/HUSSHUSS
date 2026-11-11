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
let onSyncMetadataGet
let onSyncDownloadGet
let onSyncUploadPost
let clientSync
let maxRemoteBackupFileBytes
let withConnectionTimeout
let fetchCalls
let remoteBackupRecord
let successfulRemotePuts

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
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const helper = await vite.ssrLoadModule('/functions/_shared/github.ts')
  const callback = await vite.ssrLoadModule('/functions/api/github/callback.ts')
  const existing = await vite.ssrLoadModule('/functions/api/github/connect-existing.ts')
  const syncMetadata = await vite.ssrLoadModule('/functions/api/github/sync/metadata.ts')
  const syncDownload = await vite.ssrLoadModule('/functions/api/github/sync/download.ts')
  const syncUpload = await vite.ssrLoadModule('/functions/api/github/sync/upload.ts')
  const syncHelper = await vite.ssrLoadModule('/functions/_shared/githubSync.ts')
  const connectionRequest = await vite.ssrLoadModule('/src/connectionRequest.ts')
  clientSync = await vite.ssrLoadModule('/src/githubSync.ts')
  createInstallState = helper.createInstallState
  onFirstInstallCallback = callback.onRequestGet
  onExistingConnectionGet = existing.onRequestGet
  onExistingConnectionPost = existing.onRequestPost
  onSyncMetadataGet = syncMetadata.onRequestGet
  onSyncDownloadGet = syncDownload.onRequestGet
  onSyncUploadPost = syncUpload.onRequestPost
  maxRemoteBackupFileBytes = syncHelper.MAX_REMOTE_BACKUP_FILE_BYTES
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
    permissions: { metadata: 'read', contents: 'write' },
    ...overrides,
  }
}

const encryptedBackupText = JSON.stringify({
  format: 'husshuss-encrypted-backup',
  version: 1,
  cipher: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA-256',
  iterations: 600_000,
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA',
})

function remoteBackupFile(revision = 1) {
  const content = JSON.stringify({
    format: 'husshuss-cloud-backup',
    version: 1,
    revision,
    versionId: `00000000-0000-4000-8000-${String(revision).padStart(12, '0')}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    encryptedBackup: encryptedBackupText,
  })
  return {
    sha: 'a'.repeat(40),
    content,
    revision,
    size: Buffer.byteLength(content),
  }
}

function mockGitHub({
  installation = installationResponse(),
  repositories,
  initialRemoteBackup = null,
  metadataSizeOverride,
  blobSizeOverride,
  beforePut,
  onSuccessfulPut,
  failAt,
  failWith,
  failBody,
  networkFailAt,
  invalidJsonAt,
  beforeRepositoryResponse,
} = {}) {
  fetchCalls = []
  remoteBackupRecord = initialRemoteBackup
  successfulRemotePuts = 0
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
      assert.deepEqual(JSON.parse(init.body), { permissions: { metadata: 'read', contents: 'write' } })
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
    if (url.pathname === `/repos/${repositoryName.toLowerCase()}/contents/husshuss/encrypted-backup-v1.json` && init.method === 'PUT') {
      const payload = JSON.parse(init.body)
      await beforePut?.(payload, remoteBackupRecord)
      if ((!remoteBackupRecord && Object.hasOwn(payload, 'sha'))
        || (remoteBackupRecord && payload.sha !== remoteBackupRecord.sha)) {
        return Response.json({ message: 'Conflict: file SHA does not match' }, { status: 409 })
      }
      const sha = `${String((remoteBackupRecord?.revision ?? 0) + 1).padStart(40, '0')}`
      const content = Buffer.from(payload.content, 'base64').toString('utf8')
      remoteBackupRecord = {
        sha,
        content,
        revision: (remoteBackupRecord?.revision ?? 0) + 1,
        size: Buffer.byteLength(content),
      }
      successfulRemotePuts += 1
      onSuccessfulPut?.(remoteBackupRecord, successfulRemotePuts)
      return Response.json({ content: { sha, size: remoteBackupRecord.size } })
    }
    if (url.pathname === `/repos/${repositoryName.toLowerCase()}/contents/husshuss/encrypted-backup-v1.json`) {
      if (!remoteBackupRecord) return Response.json({ message: 'Not Found' }, { status: 404 })
      return Response.json({
        type: 'file',
        sha: remoteBackupRecord.sha,
        size: metadataSizeOverride ?? remoteBackupRecord.size,
      })
    }
    if (url.pathname.startsWith(`/repos/${repositoryName.toLowerCase()}/git/blobs/`)) {
      if (!remoteBackupRecord || url.pathname.endsWith(remoteBackupRecord.sha) === false) {
        return Response.json({ message: 'Not Found' }, { status: 404 })
      }
      return Response.json({
        sha: remoteBackupRecord.sha,
        size: blobSizeOverride ?? remoteBackupRecord.size,
        encoding: 'base64',
        content: Buffer.from(remoteBackupRecord.content).toString('base64'),
      })
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

async function establishSessionCookie() {
  const challenge = await beginExistingConnection()
  const response = await submitExistingConnection(challenge)
  assert.equal(response.status, 200)
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('__Host-husshuss_github='))
  assert.ok(cookie)
  return cookie.split(';')[0]
}

function syncContext(path, method, cookie, body) {
  const headers = { Cookie: cookie }
  if (method === 'POST') {
    headers.Origin = appOrigin
    headers['Content-Type'] = 'application/json'
    headers['Sec-Fetch-Site'] = 'same-origin'
  }
  return {
    request: new Request(`${appOrigin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  }
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
      ['missing contents permission', { installation: installationResponse({ permissions: { metadata: 'read' } }) }],
      ['contents read-only permission', { installation: installationResponse({ permissions: { metadata: 'read', contents: 'read' } }) }],
      ['write or extra app permission', { installation: installationResponse({ permissions: { metadata: 'write', contents: 'write' } }) }],
      ['extra repository permission', { installation: installationResponse({ permissions: { metadata: 'read', contents: 'write', issues: 'read' } }) }],
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

test('GitHub encrypted backup routes preserve encryption and reject unsafe overwrites', async (context) => {
  await context.test('metadata checks report existence without downloading backup contents', async () => {
    mockGitHub()
    const cookie = await establishSessionCookie()
    fetchCalls = []

    const response = await onSyncMetadataGet(syncContext('/api/github/sync/metadata', 'GET', cookie))
    assert.equal(response.status, 200, JSON.stringify(fetchCalls.map(({ url }) => url.pathname)))
    assert.deepEqual(await response.json(), { exists: false })
    assert.equal(fetchCalls.some(({ url }) => url.pathname.includes('/git/blobs/')), false)
  })

  await context.test('uploads only a validated encrypted envelope and downloads it unchanged', async () => {
    mockGitHub()
    const cookie = await establishSessionCookie()
    fetchCalls = []
    const upload = await onSyncUploadPost(syncContext('/api/github/sync/upload', 'POST', cookie, {
      backup: encryptedBackupText,
      expectedRemote: { sha: null, revision: null, versionId: null },
    }))
    assert.equal(upload.status, 200)
    const uploaded = await upload.json()
    assert.equal(uploaded.uploaded, true)
    assert.equal(uploaded.revision, 1)
    assert.equal(JSON.parse(remoteBackupRecord.content).encryptedBackup, encryptedBackupText)
    assert.equal(JSON.stringify(uploaded).includes('installToken'), false)

    const updated = await onSyncUploadPost(syncContext('/api/github/sync/upload', 'POST', cookie, {
      backup: encryptedBackupText,
      expectedRemote: {
        sha: uploaded.sha,
        revision: uploaded.revision,
        versionId: uploaded.versionId,
      },
    }))
    assert.equal(updated.status, 200)
    assert.equal((await updated.json()).revision, 2)

    const metadata = await onSyncMetadataGet(syncContext('/api/github/sync/metadata', 'GET', cookie))
    const status = await metadata.json()
    assert.equal(status.exists, true)
    assert.equal(status.sha, remoteBackupRecord.sha)

    const download = await onSyncDownloadGet(syncContext('/api/github/sync/download', 'GET', cookie))
    assert.equal(download.status, 200)
    const downloaded = await download.json()
    assert.equal(downloaded.backup, encryptedBackupText)
    assert.equal(downloaded.remote.revision, 2)
    assert.ok(fetchCalls.some(({ url }) => url.pathname.includes('/git/blobs/')))
  })

  await context.test('rejects plaintext and malformed encrypted payloads without writing', async (subtests) => {
    const payloads = [
      { backup: JSON.stringify({ workouts: ['plaintext'] }), expectedRemote: { sha: null, revision: null, versionId: null } },
      { backup: '{"format":"husshuss-encrypted-backup"}', expectedRemote: { sha: null, revision: null, versionId: null } },
    ]
    for (const body of payloads) {
      await subtests.test('invalid backup format', async () => {
        mockGitHub()
        const cookie = await establishSessionCookie()
        fetchCalls = []
        const response = await onSyncUploadPost(syncContext('/api/github/sync/upload', 'POST', cookie, body))
        assert.equal(response.status, 400)
        assert.equal(remoteBackupRecord, null)
        assert.equal(fetchCalls.some(({ init }) => init.method === 'PUT'), false)
      })
    }
  })

  await context.test('returns a conflict instead of replacing an existing backup without its baseline', async () => {
    mockGitHub({ initialRemoteBackup: remoteBackupFile() })
    const cookie = await establishSessionCookie()
    const response = await onSyncUploadPost(syncContext('/api/github/sync/upload', 'POST', cookie, {
      backup: encryptedBackupText,
      expectedRemote: { sha: null, revision: null, versionId: null },
    }))
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, 'remote_conflict')
    assert.equal(remoteBackupRecord.revision, 1)
  })

  await context.test('GitHub SHA preconditions allow only one concurrent upload from the same baseline', async () => {
    let signalFirstPut
    let signalSecondPut
    let signalFirstWrite
    const firstPutReached = new Promise((resolve) => { signalFirstPut = resolve })
    const secondPutReached = new Promise((resolve) => { signalSecondPut = resolve })
    const firstWriteCompleted = new Promise((resolve) => { signalFirstWrite = resolve })
    let putCount = 0
    const baseline = remoteBackupFile(1)
    mockGitHub({
      initialRemoteBackup: baseline,
      beforePut: async () => {
        putCount += 1
        if (putCount === 1) {
          signalFirstPut()
          await secondPutReached
        } else {
          signalSecondPut()
          await firstWriteCompleted
        }
      },
      onSuccessfulPut: (_record, count) => {
        if (count === 1) {
          signalFirstWrite()
        }
      },
    })
    const cookie = await establishSessionCookie()
    const expectedRemote = {
      sha: baseline.sha,
      revision: baseline.revision,
      versionId: '00000000-0000-4000-8000-000000000001',
    }
    const firstPayload = {
      backup: encryptedBackupText,
      expectedRemote,
    }
    const secondBackup = encryptedBackupText.replace('AAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBB')
    const secondPayload = { backup: secondBackup, expectedRemote }

    const firstUpload = onSyncUploadPost(syncContext('/api/github/sync/upload', 'POST', cookie, firstPayload))
    await firstPutReached
    const secondUpload = onSyncUploadPost(syncContext('/api/github/sync/upload', 'POST', cookie, secondPayload))
    const [firstResponse, secondResponse] = await Promise.all([firstUpload, secondUpload])
    assert.equal(firstResponse.status, 200)
    assert.equal(secondResponse.status, 409)
    assert.equal((await secondResponse.json()).error, 'remote_conflict')
    assert.equal(remoteBackupRecord.revision, 2)
    assert.equal(JSON.parse(remoteBackupRecord.content).encryptedBackup, encryptedBackupText)
    assert.equal(successfulRemotePuts, 1)
  })

  await context.test('rejects oversized metadata before requesting the Git blob', async () => {
    mockGitHub({
      initialRemoteBackup: remoteBackupFile(),
      metadataSizeOverride: maxRemoteBackupFileBytes + 1,
    })
    const cookie = await establishSessionCookie()
    fetchCalls = []
    const response = await onSyncDownloadGet(syncContext('/api/github/sync/download', 'GET', cookie))
    assert.equal(response.status, 502)
    assert.equal(fetchCalls.some(({ url }) => url.pathname.includes('/git/blobs/')), false)
  })

  await context.test('rejects a Git blob whose reported byte size differs from file metadata', async () => {
    const backup = remoteBackupFile()
    mockGitHub({
      initialRemoteBackup: backup,
      blobSizeOverride: backup.size + 1,
    })
    const cookie = await establishSessionCookie()
    fetchCalls = []
    const response = await onSyncDownloadGet(syncContext('/api/github/sync/download', 'GET', cookie))
    assert.equal(response.status, 502)
    assert.equal(fetchCalls.some(({ url }) => url.pathname.includes('/git/blobs/')), true)
  })

  await context.test('keeps GitHub contents failures generic in the browser response', async () => {
    mockGitHub({
      failAt: `/repos/${repositoryName.toLowerCase()}/contents/husshuss/encrypted-backup-v1.json`,
      failWith: 500,
      failBody: { message: 'private repository diagnostic' },
    })
    const cookie = await establishSessionCookie()
    const response = await onSyncMetadataGet(syncContext('/api/github/sync/metadata', 'GET', cookie))
    assert.equal(response.status, 502)
    const body = await response.text()
    assert.equal(body.includes('private repository diagnostic'), false)
    assert.equal(body.includes(installToken), false)
  })

  await context.test('requires a valid signed browser session', async () => {
    mockGitHub()
    fetchCalls = []
    const response = await onSyncMetadataGet(syncContext('/api/github/sync/metadata', 'GET', ''))
    assert.equal(response.status, 401)
    assert.equal(fetchCalls.length, 0)
  })

  await context.test('browser upload sends encrypted JSON with same-origin credentials only', async () => {
    const savedFetch = globalThis.fetch
    let outgoing
    globalThis.fetch = async (input, init) => {
      outgoing = { url: String(input), init }
      return Response.json({
        uploaded: true,
        backupFormatVersion: 1,
        sha: 'b'.repeat(40),
        size: 1024,
        revision: 1,
        versionId: '00000000-0000-4000-8000-000000000001',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    }
    try {
      await clientSync.uploadEncryptedBackup(encryptedBackupText, {
        sha: null,
        revision: null,
        versionId: null,
      })
      assert.equal(outgoing.url, '/api/github/sync/upload')
      assert.equal(outgoing.init.credentials, 'same-origin')
      assert.equal(outgoing.init.headers.Authorization, undefined)
      assert.equal(JSON.parse(outgoing.init.body).backup, encryptedBackupText)
    } finally {
      globalThis.fetch = savedFetch
    }
  })
})
