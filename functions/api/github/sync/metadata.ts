import {
  authorizeSyncRequest,
  logRemoteBackupFailure,
  syncJsonResponse,
} from '../../../_shared/githubSync'
import { getRemoteBackupFileMetadata, jsonResponse, type PagesContext } from '../../../_shared/github'

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const authorization = await authorizeSyncRequest(context, 'GET')
  if (authorization.response) return authorization.response
  const { access } = authorization

  try {
    const metadata = await getRemoteBackupFileMetadata(context.env, access.accessToken)
    if (!metadata) {
      return await syncJsonResponse({ exists: false }, context.env, access)
    }
    return await syncJsonResponse({
      exists: true,
      sha: metadata.sha,
      size: metadata.size,
    }, context.env, access)
  } catch (error) {
    logRemoteBackupFailure('metadata', error)
    return jsonResponse({ error: 'remote_backup_unavailable' }, 502)
  }
}
