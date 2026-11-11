import {
  authorizeSyncRequest,
  logRemoteBackupFailure,
  readRemoteBackup,
  remoteBackupInfo,
  syncJsonResponse,
} from '../../../_shared/githubSync'
import { jsonResponse, type PagesContext } from '../../../_shared/github'

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const authorization = await authorizeSyncRequest(context, 'GET')
  if (authorization.response) return authorization.response
  const { access } = authorization

  try {
    const remote = await readRemoteBackup(context.env, access.accessToken)
    if (!remote) return await syncJsonResponse({ exists: false }, context.env, access)
    return await syncJsonResponse({
      exists: true,
      backup: remote.backup.encryptedBackup,
      remote: {
        backupFormatVersion: remote.backup.version,
        ...remoteBackupInfo(remote.metadata, remote.backup),
      },
    }, context.env, access)
  } catch (error) {
    logRemoteBackupFailure('download', error)
    return jsonResponse({ error: 'remote_backup_unavailable' }, 502)
  }
}
