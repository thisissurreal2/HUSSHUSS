import {
  authorizeSyncRequest,
  isEncryptedBackupText,
  logRemoteBackupFailure,
  MAX_ENCRYPTED_BACKUP_BYTES,
  readRemoteBackup,
  remoteBackupInfo,
  saveRemoteBackup,
  syncJsonResponse,
  type RemoteBackupInfo,
} from '../../../_shared/githubSync'
import {
  GitHubApiError,
  jsonResponse,
  type PagesContext,
} from '../../../_shared/github'

const MAX_REQUEST_BYTES = MAX_ENCRYPTED_BACKUP_BYTES + 16_384

type ExpectedRemote = {
  sha: string | null
  revision: number | null
  versionId: string | null
}

function isExpectedRemote(value: unknown): value is ExpectedRemote {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const expected = value as Record<string, unknown>
  if (expected.sha === null && expected.revision === null && expected.versionId === null) return true
  return typeof expected.sha === 'string' && /^[0-9a-f]{40}$/i.test(expected.sha)
    && Number.isSafeInteger(expected.revision) && (expected.revision as number) >= 1
    && typeof expected.versionId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expected.versionId)
}

function hasExpectedVersion(expected: ExpectedRemote, remote: RemoteBackupInfo): boolean {
  return expected.sha === remote.sha
    && expected.revision === remote.revision
    && expected.versionId === remote.versionId
}

async function conflictResponse(
  context: PagesContext,
  access: Parameters<typeof syncJsonResponse>[2],
  remote: RemoteBackupInfo | null,
): Promise<Response> {
  return syncJsonResponse({
    error: 'remote_conflict',
    remote: remote
      ? {
          backupFormatVersion: 1,
          sha: remote.sha,
          size: remote.size,
          revision: remote.revision,
          versionId: remote.versionId,
          updatedAt: remote.updatedAt,
        }
      : { exists: false },
  }, context.env, access, 409)
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const authorization = await authorizeSyncRequest(context, 'POST')
  if (authorization.response) return authorization.response
  const { access } = authorization

  try {
    const declaredLength = Number(context.request.headers.get('Content-Length') ?? 0)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: 'payload_too_large' }, 413)
    }

    const body = await context.request.text()
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: 'payload_too_large' }, 413)
    }

    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return jsonResponse({ error: 'invalid_request' }, 400)
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)
      || !('backup' in payload) || !isEncryptedBackupText(payload.backup)
      || !('expectedRemote' in payload) || !isExpectedRemote(payload.expectedRemote)) {
      return jsonResponse({ error: 'invalid_encrypted_backup' }, 400)
    }

    const expected = payload.expectedRemote
    let current: Awaited<ReturnType<typeof readRemoteBackup>>
    try {
      current = await readRemoteBackup(context.env, access.accessToken)
    } catch (error) {
      logRemoteBackupFailure('upload_conflict_check', error)
      return jsonResponse({ error: 'remote_backup_unavailable' }, 502)
    }

    const currentInfo = current ? remoteBackupInfo(current.metadata, current.backup) : null
    if (currentInfo) {
      if (!hasExpectedVersion(expected, currentInfo)) {
        return await conflictResponse(context, access, currentInfo)
      }
    } else if (expected.sha !== null || expected.revision !== null || expected.versionId !== null) {
      return await conflictResponse(context, access, null)
    }

    const remoteBackup = {
      format: 'husshuss-cloud-backup' as const,
      version: 1 as const,
      revision: current ? current.backup.revision + 1 : 1,
      versionId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      encryptedBackup: payload.backup,
    }

    try {
      const saved = await saveRemoteBackup(
        context.env,
        access.accessToken,
        remoteBackup,
        current?.metadata.sha,
      )
      const info = remoteBackupInfo(saved, remoteBackup)
      return await syncJsonResponse({
        uploaded: true,
        backupFormatVersion: remoteBackup.version,
        ...info,
      }, context.env, access)
    } catch (error) {
      if (error instanceof GitHubApiError
        && (error.diagnostic.status === 409 || error.diagnostic.status === 422)) {
        return await conflictResponse(context, access, currentInfo)
      }
      logRemoteBackupFailure('upload', error)
      return jsonResponse({ error: 'remote_backup_unavailable' }, 502)
    }
  } catch (error) {
    logRemoteBackupFailure('upload_request', error)
    return jsonResponse({ error: 'remote_backup_unavailable' }, 500)
  }
}
