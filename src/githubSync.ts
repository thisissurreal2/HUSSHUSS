import { withConnectionTimeout } from './connectionRequest'

export type RemoteBackupInfo = {
  backupFormatVersion: number
  sha: string
  size: number
  revision: number
  versionId: string
  updatedAt: string
}

export type RemoteBackupStatus =
  | { exists: false }
  | {
      exists: true
      sha: string
      size: number
      backupFormatVersion?: number
      revision?: number
      versionId?: string
      updatedAt?: string
    }

export type DownloadedRemoteBackup = {
  backup: string
  remote: RemoteBackupInfo
}

export type ExpectedRemote = {
  sha: string | null
  revision: number | null
  versionId: string | null
}

export class RemoteSyncError extends Error {
  readonly code: string
  readonly remote: RemoteBackupStatus | null

  constructor(code: string, remote: RemoteBackupStatus | null = null) {
    super(code === 'remote_conflict'
      ? 'Another device has updated the remote backup.'
      : 'The remote backup operation could not be completed.')
    this.name = 'RemoteSyncError'
    this.code = code
    this.remote = remote
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRemoteBackupInfo(value: unknown): value is RemoteBackupInfo {
  if (!isObject(value)) return false
  return value.backupFormatVersion === 1
    && typeof value.sha === 'string' && /^[0-9a-f]{40}$/i.test(value.sha)
    && Number.isSafeInteger(value.size) && (value.size as number) >= 0
    && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1
    && typeof value.versionId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.versionId)
    && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
}

function parseRemoteStatus(value: unknown): RemoteBackupStatus {
  if (!isObject(value)) throw new RemoteSyncError('invalid_response')
  if (value.exists === false) return { exists: false }
  if (value.exists === true
    && typeof value.sha === 'string' && /^[0-9a-f]{40}$/i.test(value.sha)
    && Number.isSafeInteger(value.size) && (value.size as number) >= 0) {
    if ('revision' in value || 'versionId' in value || 'updatedAt' in value || 'backupFormatVersion' in value) {
      if (!isRemoteBackupInfo(value)) throw new RemoteSyncError('invalid_response')
      return { exists: true, ...value }
    }
    return { exists: true, sha: value.sha, size: value.size as number }
  }
  throw new RemoteSyncError('invalid_response')
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<{ response: Response; value: T }> {
  return withConnectionTimeout(async (signal) => {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...init,
      signal,
    })
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new RemoteSyncError('invalid_response')
    }
    return { response, value: value as T }
  }, 120_000)
}

async function requireSuccess<T>(path: string, init?: RequestInit): Promise<T> {
  const { response, value } = await requestJson<T>(path, init)
  if (!response.ok) {
    if (response.status === 409 && isObject(value) && value.error === 'remote_conflict') {
      throw new RemoteSyncError('remote_conflict', parseRemoteStatus(value.remote))
    }
    const code = isObject(value) && typeof value.error === 'string' ? value.error : 'request_failed'
    throw new RemoteSyncError(code)
  }
  return value
}

export async function getRemoteBackupStatus(): Promise<RemoteBackupStatus> {
  const value = await requireSuccess<unknown>('/api/github/sync/metadata')
  return parseRemoteStatus(value)
}

export async function downloadRemoteBackup(): Promise<DownloadedRemoteBackup | null> {
  const value = await requireSuccess<unknown>('/api/github/sync/download')
  if (!isObject(value)) throw new RemoteSyncError('invalid_response')
  if (value.exists === false) return null
  if (value.exists !== true || typeof value.backup !== 'string' || !isRemoteBackupInfo(value.remote)) {
    throw new RemoteSyncError('invalid_response')
  }
  return { backup: value.backup, remote: value.remote }
}

export async function uploadEncryptedBackup(
  backup: string,
  expectedRemote: ExpectedRemote,
): Promise<RemoteBackupInfo> {
  const value = await requireSuccess<unknown>('/api/github/sync/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup, expectedRemote }),
  })
  if (!isObject(value) || value.uploaded !== true || !isRemoteBackupInfo(value)) {
    throw new RemoteSyncError('invalid_response')
  }
  return value
}
