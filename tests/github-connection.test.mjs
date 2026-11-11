import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
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
let createInstallState
let onFirstInstallCallback
let onExistingConnectionGet
let onExistingConnectionPost
let fetchCalls

before(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
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
  createInstallState = helper.createInstallState
  onFirstInstallCallback = callback.onRequestGet
  onExistingConnectionGet = existing.onRequestGet
  onExistingConnectionPost = existing.onRequestPost
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

function mockGitHub({ installation = installationResponse(), repositories, failWith } = {}) {
  fetchCalls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    fetchCalls.push({ url, init })
    if (failWith) return Response.json({ message: 'mock verification failure' }, { status: failWith })
    if (url.pathname === `/app/installations/${installationId}` && init.method !== 'POST') {
      return Response.json(installation)
    }
    if (url.pathname === `/app/installations/${installationId}/access_tokens` && init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { permissions: { metadata: 'read' } })
      return Response.json({ token: installToken })
    }
    if (url.pathname === '/installation/repositories') {
      assert.equal(init.headers.Authorization, `Bearer ${installToken}`)
      return Response.json(repositories ?? {
        total_count: 1,
        repositories: [{ full_name: repositoryName, private: true }],
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

async function submitExistingConnection({ state, cookie, id = installationId }) {
  return onExistingConnectionPost({
    request: new Request(`${appOrigin}/api/github/connect-existing`, {
      method: 'POST',
      headers: {
        Origin: appOrigin,
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
        Cookie: cookie,
      },
      body: JSON.stringify({ state, installationId: id }),
    }),
    env,
  })
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

  await context.test('rejects missing installations from GitHub without issuing a session', async () => {
    mockGitHub({ failWith: 404 })
    const challenge = await beginExistingConnection()
    const response = await submitExistingConnection(challenge)
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error, 'verification_unavailable')
    assert.equal(response.headers.getSetCookie().length, 0)
    assert.equal(fetchCalls.length, 1)
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
