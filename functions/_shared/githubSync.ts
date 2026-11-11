import {
  getRemoteBackupBlob,
  getRemoteBackupFileMetadata,
  getSession,
  getVerifiedRepositoryAccess,
  GitHubApiError,
  GitHubInstallationRejectedError,
  jsonResponse,
  requestIsOnAppOrigin,
  createSessionCookie,
  putRemoteBackupFile,
  type GitHubBackupFileMetadata,
  type PagesContext,
  type VerifiedInstallation,
} from './github'

export const MAX_ENCRYPTED_BACKUP_BYTES = 70 * 1024 * 1024
export const MAX_REMOTE_BACKUP_FILE_BYTES = MAX_ENCRYPTED_BACKUP_BYTES + 4096
const CLOUD_BACKUP_FORMAT = 'husshuss-cloud-backup'
const CLOUD_BACKUP_VERSION = 1
const ENCRYPTED_BACKUP_FORMAT = 'husshuss-encrypted-backup'
const ENCRYPTION_VERSION = 1

export type RemoteBackup = {
  format: typeof CLOUD_BACKUP_FORMAT
  version: typeof CLOUD_BACKUP_VERSION
  revision: number
  versionId: string
  updatedAt: string
  encryptedBackup: string
}

export type RemoteBackupInfo = {
  sha: string
  size: number
  revision: number
  versionId: string
  updatedAt: string
}

export type SyncAccess = {
  installation: VerifiedInstallation
  accessToken: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorType(error: unknown): string {
  if (!(error instanceof Error)) return 'NonErrorThrow'
  return ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(error.name)
    ? error.name
    : 'Error'
}

function logSyncFailure(event: string, stage: string, error: unknown): void {
  try {
    console.error(JSON.stringify({
      event,
      stage,
      errorType: safeErrorType(error),
      ...(error instanceof GitHubApiError ? error.diagnostic : {}),
    }))
  } catch {
    // Logging must not interfere with the generic response.
  }
}

export function isEncryptedBackupText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENCRYPTED_BACKUP_BYTES) return false
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isObject(parsed) || parsed.format !== ENCRYPTED_BACKUP_FORMAT
      || parsed.version !== ENCRYPTION_VERSION || parsed.cipher !== 'AES-256-GCM'
      || parsed.kdf !== 'PBKDF2-SHA-256' || !Number.isInteger(parsed.iterations)
      || (parsed.iterations as number) < 100_000 || (parsed.iterations as number) > 1_000_000
      || typeof parsed.salt !== 'string' || typeof parsed.iv !== 'string'
      || typeof parsed.ciphertext !== 'string') return false

    const salt = atob(parsed.salt)
    const iv = atob(parsed.iv)
    return salt.length === 16 && iv.length === 12
      && /^[A-Za-z0-9+/]+={0,2}$/.test(parsed.ciphertext)
      && parsed.ciphertext.length >= 24
  } catch {
    return false
  }
}

function parseRemoteBackup(text: string): RemoteBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_REMOTE_BACKUP_FILE_BYTES) {
    throw new Error('Remote backup exceeds the supported size.')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('Remote backup metadata is invalid.')
  }
  if (!isObject(value) || value.format !== CLOUD_BACKUP_FORMAT || value.version !== CLOUD_BACKUP_VERSION
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || typeof value.versionId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.versionId)
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || !isEncryptedBackupText(value.encryptedBackup)) {
    throw new Error('Remote backup metadata or encrypted payload is invalid.')
  }
  return value as RemoteBackup
}

function decodeBase64Text(value: string): string {
  if (value.length > Math.ceil(MAX_REMOTE_BACKUP_FILE_BYTES / 3) * 4) {
    throw new Error('Remote backup exceeds the supported size.')
  }
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function encodeBase64Text(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function remoteBackupInfo(
  metadata: GitHubBackupFileMetadata,
  backup: RemoteBackup,
): RemoteBackupInfo {
  return {
    sha: metadata.sha,
    size: metadata.size,
    revision: backup.revision,
    versionId: backup.versionId,
    updatedAt: backup.updatedAt,
  }
}

export async function readRemoteBackup(
  env: PagesContext['env'],
  accessToken: string,
): Promise<{ metadata: GitHubBackupFileMetadata; backup: RemoteBackup } | null> {
  const metadata = await getRemoteBackupFileMetadata(env, accessToken)
  if (!metadata) return null
  if (metadata.size > MAX_REMOTE_BACKUP_FILE_BYTES) {
    throw new Error('Remote backup exceeds the supported size.')
  }
  const blob = await getRemoteBackupBlob(
    env,
    accessToken,
    metadata.sha,
    metadata.size,
    MAX_REMOTE_BACKUP_FILE_BYTES,
  )
  if (blob.size !== metadata.size) throw new Error('Remote backup size does not match its metadata.')
  const backup = parseRemoteBackup(decodeBase64Text(blob.content))
  return { metadata, backup }
}

export async function authorizeSyncRequest(
  context: PagesContext,
  method: 'GET' | 'POST',
): Promise<{ response: Response } | { response: null; access: SyncAccess }> {
  try {
    const { request, env } = context
    if (!requestIsOnAppOrigin(request, env)) {
      return { response: jsonResponse({ error: 'connection_unavailable' }, 503) }
    }
    if (method === 'POST'
      && (request.headers.get('Origin') !== new URL(env.APP_ORIGIN ?? '').origin
        || request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json'
        || request.headers.get('Sec-Fetch-Site') === 'cross-site')) {
      return { response: jsonResponse({ error: 'request_rejected' }, 403) }
    }

    let session
    try {
      session = await getSession(request, env)
    } catch (error) {
      logSyncFailure('github_sync_authorization_failed', 'session_validation', error)
      return { response: jsonResponse({ error: 'connection_unavailable' }, 503) }
    }
    if (!session) return { response: jsonResponse({ error: 'not_connected' }, 401) }

    const access = await getVerifiedRepositoryAccess(env, session.installationId)
    return { response: null, access }
  } catch (error) {
    logSyncFailure('github_sync_authorization_failed', 'installation_verification', error)
    return {
      response: error instanceof GitHubInstallationRejectedError
        ? jsonResponse({ error: 'installation_not_verified' }, 403)
        : jsonResponse({ error: 'verification_unavailable' }, 502),
    }
  }
}

export async function syncJsonResponse(
  body: unknown,
  env: PagesContext['env'],
  access: SyncAccess,
  status = 200,
): Promise<Response> {
  const response = jsonResponse(body, status)
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', await createSessionCookie(env, access.installation))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function decodeRemoteBackup(encoded: string): RemoteBackup {
  return parseRemoteBackup(decodeBase64Text(encoded))
}

export function encodeRemoteBackup(backup: RemoteBackup): string {
  return encodeBase64Text(JSON.stringify(backup))
}

export async function saveRemoteBackup(
  env: PagesContext['env'],
  accessToken: string,
  backup: RemoteBackup,
  sha?: string,
): Promise<GitHubBackupFileMetadata> {
  return putRemoteBackupFile(env, accessToken, encodeRemoteBackup(backup), sha)
}

export function logRemoteBackupFailure(stage: string, error: unknown): void {
  logSyncFailure('github_sync_request_failed', stage, error)
}
