export interface GitHubConnectionEnv {
  APP_ORIGIN?: string
  ALLOWED_REPOSITORY?: string
  GITHUB_APP_ID?: string
  GITHUB_APP_PRIVATE_KEY?: string
  GITHUB_APP_SLUG?: string
  SESSION_SIGNING_KEY?: string
}

export type PagesContext = {
  request: Request
  env: GitHubConnectionEnv
}

export type VerifiedInstallation = {
  installationId: string
  account: string
  repository: string
}

type GitHubInstallation = {
  id: number
  app_id: number
  account: { login: string } | null
  permissions: Record<string, string>
  repository_selection: string
  target_type: string
}

type GitHubRepository = {
  full_name: string
  private: boolean
}

type GitHubInstallationToken = {
  token: string
}

type GitHubRepositoriesResponse = {
  total_count: number
  repositories: GitHubRepository[]
}

const API_VERSION = '2026-03-10'
const SESSION_COOKIE = '__Host-husshuss_github'
const STATE_COOKIE = '__Host-husshuss_github_state'
const SESSION_TTL_SECONDS = 10 * 60
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type GitHubApiStage = 'installation_lookup' | 'installation_token_creation' | 'repository_listing'

export type GitHubApiDiagnostic = {
  stage: GitHubApiStage
  status: number | null
  code?: string
  message?: string
  requestId?: string
}

export class GitHubApiError extends Error {
  readonly diagnostic: GitHubApiDiagnostic

  constructor(diagnostic: GitHubApiDiagnostic) {
    super('GitHub verification request failed.')
    this.name = 'GitHubApiError'
    this.diagnostic = diagnostic
  }
}

export class GitHubInstallationRejectedError extends Error {
  constructor() {
    super('GitHub installation did not meet the configured verification requirements.')
    this.name = 'GitHubInstallationRejectedError'
  }
}

export class GitHubConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubConfigurationError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function joinBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength)
  new Uint8Array(buffer).set(value)
  return buffer
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length)
  const bytes: number[] = []
  for (let remaining = length; remaining > 0; remaining >>>= 8) {
    bytes.unshift(remaining & 0xff)
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

function der(tag: number, content: Uint8Array): Uint8Array {
  return joinBytes(Uint8Array.of(tag), derLength(content.length), content)
}

function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = Uint8Array.of(0x02, 0x01, 0x00)
  const rsaAlgorithm = Uint8Array.of(
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  )
  return der(0x30, joinBytes(version, rsaAlgorithm, der(0x04, pkcs1)))
}

function pemToDer(pem: string): Uint8Array {
  const match = pem.trim().match(/^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----([\s\S]+?)-----END \1-----$/)
  if (!match) throw new Error('Invalid private key format.')
  const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), (character) => character.charCodeAt(0))
  return match[1] === 'RSA PRIVATE KEY' ? pkcs1ToPkcs8(bytes) : bytes
}

function requireConfiguration(env: GitHubConnectionEnv): {
  origin: string
  repository: string
  appId: string
  privateKey: string
  slug: string
  signingKey: string
} {
  const { APP_ORIGIN, ALLOWED_REPOSITORY, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG, SESSION_SIGNING_KEY } = env
  if (!APP_ORIGIN || !ALLOWED_REPOSITORY || !GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY
    || !GITHUB_APP_SLUG || !SESSION_SIGNING_KEY) {
    throw new GitHubConfigurationError('Connection service is not configured.')
  }

  const origin = new URL(APP_ORIGIN)
  const repository = ALLOWED_REPOSITORY.toLowerCase()
  if (origin.protocol !== 'https:' || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash
    || !/^\d+$/.test(GITHUB_APP_ID)
    || !/^[a-z0-9-]+$/.test(GITHUB_APP_SLUG)
    || repository !== 'thisissurreal2/husshuss-data'
    || !/^[0-9a-fA-F]{64}$/.test(SESSION_SIGNING_KEY)) {
    throw new GitHubConfigurationError('Connection service configuration is invalid.')
  }

  return {
    origin: origin.origin,
    repository,
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY,
    slug: GITHUB_APP_SLUG,
    signingKey: SESSION_SIGNING_KEY,
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signValue(value: unknown, secret: string): Promise<string> {
  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify(value)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), textEncoder.encode(payload))
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`
}

async function verifyValue<T>(token: string, secret: string): Promise<T | null> {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      toArrayBuffer(base64UrlDecode(signature)),
      textEncoder.encode(payload),
    )
    if (!valid) return null
    return JSON.parse(textDecoder.decode(base64UrlDecode(payload))) as T
  } catch {
    return null
  }
}

async function importGitHubPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pemToDer(pem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

async function createAppJwt(appId: string, pem: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000) - 60
  const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify({
    iat: issuedAt,
    exp: issuedAt + 9 * 60,
    iss: appId,
  })))
  const signingInput = `${header}.${payload}`
  const key = await importGitHubPrivateKey(pem)
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    textEncoder.encode(signingInput),
  )
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`
}

function safeDiagnosticText(value: unknown, limit: number, secrets: string[] = []): string | undefined {
  if (typeof value !== 'string') return undefined
  const withoutControls = Array.from(value, (character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f ? ' ' : character
  }).join('')
  let safe = withoutControls
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"']+/gi, '$1[REDACTED]')
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join('[REDACTED_SECRET]')
  }
  safe = safe
    .trim()
    .slice(0, limit)
  return safe || undefined
}

async function githubErrorDiagnostic(
  response: Response,
  stage: GitHubApiStage,
  requestToken: string,
  sensitiveValues: string[],
): Promise<GitHubApiDiagnostic> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  let code: string | undefined
  let message: string | undefined
  if (isObject(payload)) {
    message = safeDiagnosticText(payload.message, 300, [requestToken, ...sensitiveValues])
    if (Array.isArray(payload.errors)) {
      for (const item of payload.errors) {
        if (!isObject(item)) continue
        code = safeDiagnosticText(item.code, 64, sensitiveValues)
        if (!message) message = safeDiagnosticText(item.message, 300, [requestToken, ...sensitiveValues])
        if (code) break
      }
    }
    if (!code) code = safeDiagnosticText(payload.code, 64, sensitiveValues)
  }

  return {
    stage,
    status: response.status,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(safeDiagnosticText(response.headers.get('x-github-request-id'), 100, sensitiveValues)
      ? { requestId: safeDiagnosticText(response.headers.get('x-github-request-id'), 100, sensitiveValues) }
      : {}),
  }
}

async function githubJson<T>(
  url: string,
  token: string,
  stage: GitHubApiStage,
  method = 'GET',
  body?: unknown,
  sensitiveValues: string[] = [],
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      throw new GitHubApiError(await githubErrorDiagnostic(response, stage, token, sensitiveValues))
    }
    try {
      return await response.json() as T
    } catch {
      throw new GitHubApiError({
        stage,
        status: response.status,
        code: 'INVALID_JSON_RESPONSE',
        message: 'GitHub returned a successful status with an invalid JSON response.',
        ...(safeDiagnosticText(response.headers.get('x-github-request-id'), 100, sensitiveValues)
          ? { requestId: safeDiagnosticText(response.headers.get('x-github-request-id'), 100, sensitiveValues) }
          : {}),
      })
    }
  } catch (error) {
    if (error instanceof GitHubApiError) throw error
    throw new GitHubApiError({
      stage,
      status: null,
      code: 'NETWORK_ERROR',
      message: 'No HTTP response was received from GitHub.',
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function verifyInstallation(
  env: GitHubConnectionEnv,
  installationId: string,
): Promise<VerifiedInstallation> {
  const config = requireConfiguration(env)
  if (!/^\d{1,20}$/.test(installationId)) throw new Error('Invalid installation.')

  const appJwt = await createAppJwt(config.appId, config.privateKey)
  const installation = await githubJson<GitHubInstallation>(
    `https://api.github.com/app/installations/${installationId}`,
    appJwt,
    'installation_lookup',
    'GET',
    undefined,
    [installationId],
  )
  if (!isObject(installation) || installation.id !== Number(installationId)
    || installation.app_id !== Number(config.appId)
    || installation.target_type !== 'User'
    || installation.repository_selection !== 'selected'
    || !installation.account || typeof installation.account.login !== 'string'
    || installation.account.login.toLowerCase() !== config.repository.split('/')[0]
    || !isObject(installation.permissions)
    || Object.keys(installation.permissions).length !== 1
    || installation.permissions.metadata !== 'read') {
    throw new GitHubInstallationRejectedError()
  }

  const accessToken = await githubJson<GitHubInstallationToken>(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    appJwt,
    'installation_token_creation',
    'POST',
    { permissions: { metadata: 'read' } },
    [installationId],
  )
  if (!isObject(accessToken) || typeof accessToken.token !== 'string' || accessToken.token.length < 20) {
    throw new GitHubInstallationRejectedError()
  }

  const repositoryList = await githubJson<GitHubRepositoriesResponse>(
    'https://api.github.com/installation/repositories?per_page=100',
    accessToken.token,
    'repository_listing',
    'GET',
    undefined,
    [installationId],
  )
  if (!isObject(repositoryList) || repositoryList.total_count !== 1
    || !Array.isArray(repositoryList.repositories) || repositoryList.repositories.length !== 1) {
    throw new GitHubInstallationRejectedError()
  }
  const repository = repositoryList.repositories[0]
  if (!repository || typeof repository.full_name !== 'string' || repository.private !== true
    || repository.full_name.toLowerCase() !== config.repository) {
    throw new GitHubInstallationRejectedError()
  }

  return {
    installationId,
    account: installation.account.login,
    repository: repository.full_name,
  }
}

type ConnectionSession = VerifiedInstallation & {
  expiresAt: number
}

function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=')
    if (separator < 0) continue
    if (cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim()
    }
  }
  return null
}

export async function getSession(
  request: Request,
  env: GitHubConnectionEnv,
): Promise<ConnectionSession | null> {
  const config = requireConfiguration(env)
  const value = cookieValue(request, SESSION_COOKIE)
  if (!value) return null
  const session = await verifyValue<ConnectionSession>(value, config.signingKey)
  if (!session || !/^\d{1,20}$/.test(session.installationId)
    || session.repository.toLowerCase() !== config.repository
    || session.account.toLowerCase() !== config.repository.split('/')[0]
    || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
    return null
  }
  return session
}

export async function createSessionCookie(
  env: GitHubConnectionEnv,
  installation: VerifiedInstallation,
): Promise<string> {
  const config = requireConfiguration(env)
  const value = await signValue({
    ...installation,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  } satisfies ConnectionSession, config.signingKey)
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

export async function createInstallState(env: GitHubConnectionEnv): Promise<{ state: string; cookie: string }> {
  const config = requireConfiguration(env)
  const nonce = new Uint8Array(32)
  crypto.getRandomValues(nonce)
  const value = base64UrlEncode(nonce)
  return {
    state: await signValue({ issuedAt: Date.now(), nonce: value }, config.signingKey),
    cookie: `${STATE_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  }
}

export async function isValidInstallState(
  state: string,
  request: Request,
  env: GitHubConnectionEnv,
): Promise<boolean> {
  const config = requireConfiguration(env)
  const value = await verifyValue<{ issuedAt: number; nonce: string }>(state, config.signingKey)
  const browserNonce = cookieValue(request, STATE_COOKIE)
  return value !== null
    && Number.isFinite(value.issuedAt)
    && Date.now() - value.issuedAt >= 0
    && Date.now() - value.issuedAt <= 10 * 60 * 1000
    && typeof value.nonce === 'string'
    && value.nonce.length >= 32
    && browserNonce === value.nonce
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

export function getSafeConfig(env: GitHubConnectionEnv): { origin: string; slug: string } {
  const config = requireConfiguration(env)
  return { origin: config.origin, slug: config.slug }
}

export function isConfigured(env: GitHubConnectionEnv): boolean {
  try {
    requireConfiguration(env)
    return true
  } catch {
    return false
  }
}

export function requestIsOnAppOrigin(request: Request, env: GitHubConnectionEnv): boolean {
  try {
    return new URL(request.url).origin === requireConfiguration(env).origin
  } catch {
    return false
  }
}

export function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...extraHeaders,
    },
  })
}
