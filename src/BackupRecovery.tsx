import { useEffect, useRef, useState } from 'react'
import {
  createEncryptedBackup,
  createEncryptedBackupWithFingerprint,
  createPlainBackup,
  getCurrentBackupFingerprint,
  getRestoreSafetyDate,
  parseBackup,
  restoreBackup,
  restorePreviousDataSnapshot,
  type BackupBundle,
} from './backupStorage'
import { forgetPairingSecret, getPairingSecret, MIN_PAIRING_SECRET_LENGTH, pairingHeaders, savePairingSecret } from './pairing'
import { getPendingLocalChanges } from './localSyncQueue'
import { withConnectionTimeout } from './connectionRequest'
import { readRemoteSyncState, writeRemoteSyncState, type RemoteSyncState } from './localDatabase'
import {
  downloadRemoteBackup,
  getRemoteBackupStatus,
  RemoteSyncError,
  uploadEncryptedBackup,
  type RemoteBackupInfo,
  type RemoteBackupStatus,
} from './githubSync'

function downloadJson(text: string, suffix: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `husshuss-backup-${new Date().toISOString().slice(0, 10)}-${suffix}.json`
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

type GitHubConnectionStatus =
  | { kind: 'checking' }
  | { kind: 'not-configured' }
  | { kind: 'not-connected' }
  | { kind: 'connected'; verifiedAt: string }
  | { kind: 'verification-unavailable' }
  | { kind: 'unavailable' }

async function requestGitHubStatus(): Promise<GitHubConnectionStatus> {
  const response = await fetch('/api/github/status', { cache: 'no-store', credentials: 'same-origin', headers: pairingHeaders() })
  if (response.status === 401) return { kind: 'not-connected' }
  if (response.status === 503) {
    const value: unknown = await response.json().catch(() => null)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)
      && 'configured' in value && value.configured === true
      && 'error' in value && value.error === 'verification_unavailable') {
      return { kind: 'verification-unavailable' }
    }
  }
  if (!response.ok) throw new Error('Connection status is unavailable.')
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid connection status.')
  }
  const status = value as Record<string, unknown>
  if (status.configured === false && status.connected === false) return { kind: 'not-configured' }
  if (status.configured === true && status.connected === false) return { kind: 'not-connected' }
  if (status.configured === true && status.connected === true && status.verified === true
    && status.account === 'thisissurreal2'
    && status.repository === 'thisissurreal2/HUSSHUSS-data'
    && status.visibility === 'private'
    && typeof status.verifiedAt === 'string'
    && Number.isFinite(Date.parse(status.verifiedAt))) {
    return { kind: 'connected', verifiedAt: status.verifiedAt }
  }
  throw new Error('Invalid connection status.')
}

export function BackupRecovery({ onRestored }: { onRestored: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validatedBundle, setValidatedBundle] = useState<BackupBundle | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [githubStatus, setGithubStatus] = useState<GitHubConnectionStatus>({ kind: 'checking' })
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [existingConnectionOpen, setExistingConnectionOpen] = useState(false)
  const [existingInstallState, setExistingInstallState] = useState<string | null>(null)
  const [installationId, setInstallationId] = useState('')
  const [connectionMessage, setConnectionMessage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('github_connection') === 'failed'
      ? 'GitHub could not verify the selected private repository. No fitness data was sent.'
      : null
  })
  const [remoteBackupStatus, setRemoteBackupStatus] = useState<RemoteBackupStatus | null>(null)
  const [remoteSyncState, setRemoteSyncState] = useState<RemoteSyncState | null>(null)
  const [localFingerprint, setLocalFingerprint] = useState<string | null>(null)
  const [localChangesPending, setLocalChangesPending] = useState(false)
  const [remoteChangesPending, setRemoteChangesPending] = useState(false)
  const [cloudPassphrase, setCloudPassphrase] = useState('')
  const [cloudSyncBusy, setCloudSyncBusy] = useState(false)
  const [cloudSyncMessage, setCloudSyncMessage] = useState<string | null>(null)
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null)
  const [remoteRestoreCandidate, setRemoteRestoreCandidate] = useState<{
    bundle: BackupBundle
    remote: RemoteBackupInfo
  } | null>(null)
  const [restoreSafetyDate] = useState(getRestoreSafetyDate)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refreshCloudBackupStatus() {
    try {
      const [remote, savedState, fingerprint] = await Promise.all([
        getRemoteBackupStatus(),
        readRemoteSyncState(),
        getCurrentBackupFingerprint(),
      ])
      setCloudSyncError(null)
      setRemoteBackupStatus(remote)
      setRemoteSyncState(savedState)
      setLocalFingerprint(fingerprint)
      setLocalChangesPending(!savedState || savedState.localFingerprint !== fingerprint)
      setRemoteChangesPending(savedState
        ? !remote.exists || remote.sha !== savedState.sha
        : remote.exists)
    } catch {
      setCloudSyncError('Could not check the remote backup or local sync state. No data was changed.')
    }
  }

  useEffect(() => {
    let active = true
    const refresh = () => {
      void getPendingLocalChanges()
      .then((changes) => { if (active) setPendingCount(changes.length) })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read the local sync queue.')
      })
    }
    refresh()
    window.addEventListener('husshuss:local-queue-updated', refresh)
    return () => {
      active = false
      window.removeEventListener('husshuss:local-queue-updated', refresh)
    }
  }, [])

  useEffect(() => {
    if (githubStatus.kind !== 'connected') return
    const timer = window.setTimeout(() => { void refreshCloudBackupStatus() }, 0)
    return () => window.clearTimeout(timer)
  }, [githubStatus.kind])

  useEffect(() => {
    let active = true
    const result = new URLSearchParams(window.location.search).get('github_connection')
    if (result === 'failed' || result === 'complete') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    }

    async function refreshConnection() {
      try {
        const status = await requestGitHubStatus()
        if (active) setGithubStatus(status)
      } catch {
        if (active) setGithubStatus({ kind: 'unavailable' })
      }
    }

    void refreshConnection()
    return () => { active = false }
  }, [])

  async function refreshGitHubStatus() {
    setGithubStatus({ kind: 'checking' })
    try {
      setGithubStatus(await requestGitHubStatus())
    } catch {
      setGithubStatus({ kind: 'unavailable' })
    }
  }

  async function prepareExistingInstallation() {
    if (!getPairingSecret()) {
      const entered = window.prompt('Enter your HUSSHUSS pairing secret.')
      if (!entered || entered.trim().length < MIN_PAIRING_SECRET_LENGTH) {
        setConnectionMessage('A pairing secret of at least 32 characters is required.')
        return
      }
      savePairingSecret(entered)
    }
    setConnectionBusy(true)
    setConnectionMessage(null)
    try {
      const value: unknown = await withConnectionTimeout(async (signal) => {
        const response = await fetch('/api/github/connect-existing', {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: pairingHeaders(),
          signal,
        })
        if (response.status === 401) forgetPairingSecret()
        if (!response.ok) throw new Error('Connection setup is unavailable.')
        return await response.json()
      })
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || !('configured' in value) || value.configured !== true
        || !('state' in value) || typeof value.state !== 'string') {
        throw new Error('Invalid connection setup response.')
      }
      setExistingInstallState(value.state)
      setExistingConnectionOpen(true)
    } catch {
      setConnectionMessage('Could not start secure verification. Check the connection and try again.')
    } finally {
      setConnectionBusy(false)
    }
  }

  async function connectExistingInstallation() {
    if (!existingInstallState || !/^\d{1,20}$/.test(installationId)) {
      setConnectionMessage('Enter the numeric installation ID from your GitHub installation settings.')
      return
    }

    setConnectionBusy(true)
    setConnectionMessage(null)
    try {
      const { response, value } = await withConnectionTimeout(async (signal) => {
        const response = await fetch('/api/github/connect-existing', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { ...pairingHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: existingInstallState, installationId }),
          signal,
        })
        return { response, value: await response.json() as unknown }
      })
      if (!response.ok) {
        setConnectionMessage(response.status === 502
          ? 'GitHub could not be reached to verify this installation. Try again shortly.'
          : 'GitHub did not verify this installation for the required app, account, permission, and private repository.')
        setExistingInstallState(null)
        return
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || !('configured' in value) || value.configured !== true
        || !('connected' in value) || value.connected !== true
        || !('verified' in value) || value.verified !== true
        || !('account' in value) || value.account !== 'thisissurreal2'
        || !('repository' in value) || value.repository !== 'thisissurreal2/HUSSHUSS-data'
        || !('visibility' in value) || value.visibility !== 'private'
        || !('verifiedAt' in value) || typeof value.verifiedAt !== 'string'
        || !Number.isFinite(Date.parse(value.verifiedAt))) {
        setConnectionMessage('The connection service returned an invalid verification response.')
        setExistingInstallState(null)
        return
      }

      setGithubStatus({ kind: 'connected', verifiedAt: value.verifiedAt })
      setConnectionMessage('The existing private repository installation was verified for this device.')
      setExistingInstallState(null)
      setExistingConnectionOpen(false)
      setInstallationId('')
    } catch {
      setConnectionMessage('Could not verify the installation. Check the connection and try again.')
      setExistingInstallState(null)
    } finally {
      setConnectionBusy(false)
    }
  }

  async function disconnectGitHub() {
    if (busy || cloudSyncBusy) return
    if (!window.confirm('Disconnect this device from the verified GitHub connection? This does not revoke the GitHub App installation.')) return
    setConnectionBusy(true)
    setConnectionMessage(null)
    try {
      const response = await fetch('/api/github/disconnect', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Could not disconnect this device.')
      setConnectionMessage('This device is disconnected. The GitHub App installation was not revoked.')
      await refreshGitHubStatus()
    } catch {
      setConnectionMessage('Could not disconnect. Check the connection and try again.')
    } finally {
      setConnectionBusy(false)
    }
  }

  async function uploadCloudBackup(reviewedRemote?: RemoteBackupInfo | 'new') {
    if (busy || cloudSyncBusy) return
    if (githubStatus.kind !== 'connected' || !remoteBackupStatus || !localFingerprint) return
    const reviewedRemoteInfo = typeof reviewedRemote === 'object' ? reviewedRemote : null
    const replacingReviewedRemote = reviewedRemoteInfo !== null
    const recreatingMissingRemote = reviewedRemote === 'new'
    if (remoteChangesPending && !replacingReviewedRemote && !recreatingMissingRemote) {
      setCloudSyncError('The remote backup changed or this device has no matching baseline. Download and review it before replacing anything.')
      return
    }
    if (recreatingMissingRemote && (remoteBackupStatus.exists || !remoteSyncState)) return
    if (cloudPassphrase.length < 12) {
      setCloudSyncError('Use the encrypted-backup passphrase with at least 12 characters.')
      return
    }
    const confirmation = replacingReviewedRemote
      ? 'You validated the current remote backup. Replace it with this device’s local data? The two versions will not be merged.'
      : recreatingMissingRemote
        ? 'The previously synced remote backup is missing. Create a new encrypted backup from this device’s local data? The deleted remote version cannot be recovered here.'
        : 'Encrypt the current local workout history (including EXTRAS), measurement, and athletic data with this passphrase and upload it to your private GitHub repository?'
    if (!window.confirm(confirmation)) return

    setCloudSyncBusy(true)
    setCloudSyncError(null)
    setCloudSyncMessage(null)
    setRemoteRestoreCandidate(null)
    try {
      const currentRemote = await getRemoteBackupStatus()
      const expectedRemoteMatches = reviewedRemoteInfo
        ? currentRemote.exists && currentRemote.sha === reviewedRemoteInfo.sha
        : recreatingMissingRemote
          ? !currentRemote.exists
          : remoteSyncState
            ? currentRemote.exists && currentRemote.sha === remoteSyncState.sha
            : !currentRemote.exists
      if (!expectedRemoteMatches) {
        setRemoteBackupStatus(currentRemote)
        setRemoteChangesPending(true)
        setCloudSyncError('The remote backup changed before upload. Nothing was overwritten; check the current version and review it before trying again.')
        return
      }

      const { encryptedBackup, localFingerprint: snapshotFingerprint } =
        await createEncryptedBackupWithFingerprint(cloudPassphrase)
      const expected = reviewedRemoteInfo
        ? {
            sha: reviewedRemoteInfo.sha,
            revision: reviewedRemoteInfo.revision,
            versionId: reviewedRemoteInfo.versionId,
          }
        : !recreatingMissingRemote && remoteSyncState
        ? {
            sha: remoteSyncState.sha,
            revision: remoteSyncState.revision,
            versionId: remoteSyncState.versionId,
          }
        : { sha: null, revision: null, versionId: null }
      const uploaded = await uploadEncryptedBackup(encryptedBackup, expected)
      const savedState: RemoteSyncState = {
        id: 'github-backup-v1',
        sha: uploaded.sha,
        revision: uploaded.revision,
        versionId: uploaded.versionId,
        updatedAt: uploaded.updatedAt,
        localFingerprint: snapshotFingerprint,
      }
      try {
        await writeRemoteSyncState(savedState)
      } catch {
        setCloudSyncError('The encrypted backup was uploaded, but this device could not save its sync marker. Refresh status before retrying.')
        await refreshCloudBackupStatus()
        return
      }
      const currentFingerprint = await getCurrentBackupFingerprint()
      setRemoteSyncState(savedState)
      setRemoteBackupStatus({ exists: true, sha: uploaded.sha, size: uploaded.size })
      setLocalFingerprint(currentFingerprint)
      setLocalChangesPending(currentFingerprint !== snapshotFingerprint)
      setRemoteChangesPending(false)
      setCloudSyncMessage(currentFingerprint === snapshotFingerprint
        ? `Encrypted backup uploaded as revision ${uploaded.revision}.`
        : `Revision ${uploaded.revision} was uploaded; local data changed during the upload and still needs syncing.`)
    } catch (cause) {
      if (cause instanceof RemoteSyncError && cause.code === 'remote_conflict') {
        if (cause.remote) {
          setRemoteBackupStatus(cause.remote)
          setRemoteChangesPending(true)
        }
        setCloudSyncError('Another device changed the remote backup. Nothing was overwritten; download and review the current version.')
      } else {
        setCloudSyncError('Could not upload the encrypted backup. Local data was not changed; check the connection and try again.')
      }
    } finally {
      setCloudPassphrase('')
      setCloudSyncBusy(false)
    }
  }

  async function validateRemoteBackup() {
    if (busy || cloudSyncBusy) return
    if (githubStatus.kind !== 'connected') return
    if (cloudPassphrase.length < 12) {
      setCloudSyncError('Enter the encrypted-backup passphrase with at least 12 characters.')
      return
    }
    setCloudSyncBusy(true)
    setCloudSyncError(null)
    setCloudSyncMessage(null)
    setRemoteRestoreCandidate(null)
    try {
      const downloaded = await downloadRemoteBackup()
      if (!downloaded) {
        setRemoteBackupStatus({ exists: false })
        setRemoteChangesPending(Boolean(remoteSyncState))
        setCloudSyncMessage('No remote backup exists. Local data has not been changed.')
        return
      }
      const bundle = await parseBackup(downloaded.backup, cloudPassphrase)
      setRemoteBackupStatus({ exists: true, sha: downloaded.remote.sha, size: downloaded.remote.size })
      setRemoteRestoreCandidate({ bundle, remote: downloaded.remote })
      setCloudSyncMessage(
        `Validated revision ${downloaded.remote.revision}: ${bundle.data.workouts.history.length} workouts, `
        + `${bundle.data.measurements.sessions.length} measurement sessions, and `
        + `${bundle.data.athletic.records.length} athletic records. No local data has been changed.`,
      )
    } catch {
      setCloudSyncError('The remote backup could not be downloaded or validated. Check the passphrase and connection; local data was not changed.')
    } finally {
      setCloudPassphrase('')
      setCloudSyncBusy(false)
    }
  }

  async function restoreRemoteBackup() {
    if (busy || cloudSyncBusy) return
    if (!remoteRestoreCandidate || githubStatus.kind !== 'connected') return
    if (!window.confirm('Replace this device’s workouts (including EXTRAS), measurements, and athletic records with the validated remote backup? A recovery snapshot of current local data will be saved first.')) return
    setCloudSyncBusy(true)
    setCloudSyncError(null)
    setCloudSyncMessage(null)
    let localDataReplaced = false
    try {
      const latestRemote = await getRemoteBackupStatus()
      if (!latestRemote.exists || latestRemote.sha !== remoteRestoreCandidate.remote.sha) {
        setRemoteBackupStatus(latestRemote)
        setRemoteChangesPending(true)
        setRemoteRestoreCandidate(null)
        setCloudSyncError('The remote backup changed after validation. Download and review the latest version before restoring.')
        return
      }
      await restoreBackup(remoteRestoreCandidate.bundle)
      localDataReplaced = true
      const fingerprint = await getCurrentBackupFingerprint()
      const savedState: RemoteSyncState = {
        id: 'github-backup-v1',
        sha: remoteRestoreCandidate.remote.sha,
        revision: remoteRestoreCandidate.remote.revision,
        versionId: remoteRestoreCandidate.remote.versionId,
        updatedAt: remoteRestoreCandidate.remote.updatedAt,
        localFingerprint: fingerprint,
      }
      await writeRemoteSyncState(savedState)
      setRemoteSyncState(savedState)
      setLocalFingerprint(fingerprint)
      setLocalChangesPending(false)
      setRemoteChangesPending(false)
      setRemoteRestoreCandidate(null)
      setCloudSyncMessage(`Revision ${savedState.revision} was restored. A safety snapshot of the previous local data is available.`)
      onRestored()
    } catch {
      setCloudSyncError(localDataReplaced
        ? 'The remote data was restored, but this device could not save its sync marker. A local recovery snapshot is available; check status before syncing.'
        : 'The remote backup could not be restored. Check local storage and the recovery snapshot before trying again.')
      if (localDataReplaced) {
        setRemoteRestoreCandidate(null)
        onRestored()
      }
    } finally {
      setCloudPassphrase('')
      setCloudSyncBusy(false)
    }
  }

  async function exportEncrypted() {
    if (cloudSyncBusy) return
    setError(null)
    setMessage(null)
    if (exportPassphrase.length < 12) {
      setError('Use a passphrase with at least 12 characters.')
      return
    }
    if (exportPassphrase !== confirmPassphrase) {
      setError('The passphrases do not match.')
      return
    }
    setBusy(true)
    try {
      downloadJson(await createEncryptedBackup(exportPassphrase), 'encrypted')
      setMessage('Encrypted backup downloaded. Keep the passphrase separate; it cannot be recovered.')
      setExportPassphrase('')
      setConfirmPassphrase('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the encrypted backup.')
    } finally {
      setExportPassphrase('')
      setConfirmPassphrase('')
      setBusy(false)
    }
  }

  async function exportPlaintext() {
    if (cloudSyncBusy) return
    setError(null)
    setMessage(null)
    if (!window.confirm('This file contains readable personal workout and body data. Save it only in a location you trust. Continue?')) return
    setBusy(true)
    try {
      downloadJson(await createPlainBackup(), 'plaintext')
      setMessage('Plaintext backup downloaded. Anyone with the file can read its contents.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the backup.')
    } finally {
      setBusy(false)
    }
  }

  async function validateSelectedFile() {
    if (cloudSyncBusy) return
    if (!selectedFile) return
    setBusy(true)
    setError(null)
    setMessage(null)
    setValidatedBundle(null)
    try {
      if (selectedFile.size > 50_000_000) throw new Error('This backup is too large to import (maximum 50 MB).')
      const bundle = await parseBackup(await selectedFile.text(), importPassphrase)
      setValidatedBundle(bundle)
      setImportPassphrase('')
      const workoutCount = bundle.data.workouts.history.length
      const measurementCount = bundle.data.measurements.sessions.length
      const assessmentCount = bundle.data.athletic.records.length
      setMessage(`Validated: ${workoutCount} completed workouts, ${measurementCount} measurement sessions, and ${assessmentCount} athletic records. No data has been changed yet.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not validate this backup.')
    } finally {
      setImportPassphrase('')
      setBusy(false)
    }
  }

  async function performRestore() {
    if (cloudSyncBusy) return
    if (!validatedBundle) return
    if (!window.confirm('Replace all HUSSHUSS workout history (including EXTRAS), measurement, and athletic data on this device with this backup? A recovery snapshot of the current data will be saved first.')) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      await restoreBackup(validatedBundle)
      onRestored()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Restore failed.')
    } finally {
      setImportPassphrase('')
      setCloudPassphrase('')
      setBusy(false)
    }
  }

  async function restorePrevious() {
    if (cloudSyncBusy) return
    if (!window.confirm('Restore the three HUSSHUSS data stores from the last pre-restore safety snapshot? The current local state will become the new rollback snapshot.')) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      await restorePreviousDataSnapshot()
      onRestored()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore the safety snapshot.')
    } finally {
      setImportPassphrase('')
      setCloudPassphrase('')
      setBusy(false)
    }
  }

  return (
    <div className="backup-recovery">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR DATA · PHASE 4.3</div>
          <h1>Keep a copy. Keep control.</h1>
          <p className="page-subtitle">Local records stay primary. Export, restore, or explicitly sync an encrypted backup.</p>
        </div>
        <div className="weekly-chip">LOCAL FIRST</div>
      </div>

      <section className="backup-status panel">
        <div>
          <div className="eyebrow">CROSS-DEVICE SYNC</div>
          <h2>
            {githubStatus.kind === 'connected' ? 'Private repository verified'
              : githubStatus.kind === 'not-connected' ? 'Not connected'
                : githubStatus.kind === 'not-configured' ? 'Connection setup unavailable'
                    : githubStatus.kind === 'verification-unavailable' ? 'Unable to verify connection'
                    : githubStatus.kind === 'unavailable' ? 'Status unavailable'
                    : 'Checking connection'}
          </h2>
          <p aria-live="polite">
            {githubStatus.kind === 'connected'
              ? `Verified ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(githubStatus.verifiedAt))}. ${'thisissurreal2/HUSSHUSS-data'} is private.`
              : githubStatus.kind === 'not-connected'
                ? 'No GitHub installation is connected to this device. Fitness data remains local.'
                : githubStatus.kind === 'not-configured'
                  ? 'The secure connection service is not configured. Nothing is uploaded.'
                  : githubStatus.kind === 'verification-unavailable'
                    ? 'GitHub could not verify the existing installation. No connected state is assumed, and no fitness data was sent.'
                  : githubStatus.kind === 'unavailable'
                    ? 'The secure connection service could not be reached or returned an invalid status. No connected state is assumed.'
                    : 'Checking with the secure connection service…'}
          </p>
          <p>Phase 4.3 can transfer only client-encrypted backups after this device’s private repository connection is verified.</p>
          {connectionMessage && <p className="connection-message" role="status">{connectionMessage}</p>}
          <div className="backup-actions connection-actions">
            {githubStatus.kind === 'not-connected' && (
              <>
                <button
                  className="button-primary"
                  type="button"
                  disabled={connectionBusy || cloudSyncBusy}
                  onClick={() => { window.location.assign('/api/github/connect') }}
                >
                  Install GitHub App
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={connectionBusy || cloudSyncBusy}
                  onClick={() => void prepareExistingInstallation()}
                >
                  Already installed? Connect this device
                </button>
              </>
            )}
            {(githubStatus.kind === 'connected' || githubStatus.kind === 'verification-unavailable') && (
              <button className="button-secondary" type="button" disabled={connectionBusy || cloudSyncBusy} onClick={() => void disconnectGitHub()}>
                Disconnect this device
              </button>
            )}
            <button
              className="button-secondary"
              type="button"
              disabled={connectionBusy || cloudSyncBusy || githubStatus.kind === 'checking'}
              onClick={() => void refreshGitHubStatus()}
            >
              Check status
            </button>
          </div>
          {existingConnectionOpen && githubStatus.kind === 'not-connected' && (
            <div className="existing-installation-connect">
              <label>
                <span>GitHub installation ID</span>
                <input
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={20}
                  pattern="[0-9]{1,20}"
                  value={installationId}
                  onChange={(event) => setInstallationId(event.target.value)}
                  aria-describedby="existing-installation-help"
                />
              </label>
              <p id="existing-installation-help">
                Find the numeric ID in the GitHub installation settings page URL. HUSSHUSS treats it as untrusted and verifies it directly with GitHub.
              </p>
              <div className="backup-actions">
                <button
                  className="button-primary"
                  type="button"
                  disabled={connectionBusy || cloudSyncBusy || !existingInstallState || !/^\d{1,20}$/.test(installationId)}
                  onClick={() => void connectExistingInstallation()}
                >
                  {connectionBusy ? 'Verifying…' : 'Verify and connect'}
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={connectionBusy || cloudSyncBusy}
                  onClick={() => {
                    setExistingConnectionOpen(false)
                    setExistingInstallState(null)
                    setInstallationId('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="backup-queue-count">
          <strong>{pendingCount === null ? '—' : pendingCount}</strong>
          <span>data areas staged locally</span>
        </div>
      </section>

      <section className="backup-panel panel">
        <div>
          <div className="eyebrow">ENCRYPTED CLOUD BACKUP</div>
          <h2>Sync an encrypted backup</h2>
        </div>
        <p>
          HUSSHUSS encrypts the complete backup in this browser with AES-256-GCM before upload. The GitHub service stores and returns only the encrypted file; it never receives your passphrase or plaintext fitness data. GitHub is not a guaranteed permanent backup.
        </p>
        <p aria-live="polite">
          {githubStatus.kind !== 'connected'
            ? 'Connect and verify the private repository before using encrypted cloud backup.'
            : remoteBackupStatus === null
              ? 'Checking remote backup status…'
              : remoteBackupStatus.exists
                ? `A remote encrypted backup exists (${formatBytes(remoteBackupStatus.size)}).`
                : 'No remote backup exists yet.'}
        </p>
        {githubStatus.kind === 'connected' && remoteBackupStatus !== null && (
          <p>
            {localChangesPending ? 'Local data differs from this device’s last synced snapshot.'
              : remoteSyncState ? 'Local data matches this device’s last synced snapshot.'
                : 'This device has no saved sync baseline.'}
            {remoteChangesPending
              ? remoteBackupStatus.exists
                ? ' The remote version differs from this device’s baseline; download and validate it before choosing which version to keep.'
                : ' The previously synced remote file is missing; a new upload requires an explicit confirmation.'
              : ''}
          </p>
        )}
        <label className="backup-passphrase-import">
          <span>Encryption passphrase · 12 characters minimum</span>
          <input
            autoComplete="new-password"
            type="password"
            value={cloudPassphrase}
            onChange={(event) => setCloudPassphrase(event.target.value)}
          />
        </label>
        <div className="backup-actions">
          <button
            className="button-secondary"
            type="button"
            disabled={githubStatus.kind !== 'connected' || cloudSyncBusy || busy}
            onClick={() => void refreshCloudBackupStatus()}
          >
            Check remote backup
          </button>
          <button
            className="button-primary"
            type="button"
            disabled={githubStatus.kind !== 'connected' || cloudSyncBusy || busy || !localChangesPending
              || remoteChangesPending || remoteBackupStatus === null || cloudPassphrase.length < 12}
            onClick={() => void uploadCloudBackup()}
          >
            {cloudSyncBusy ? 'Working…' : 'Encrypt and upload'}
          </button>
          {remoteChangesPending && remoteRestoreCandidate && githubStatus.kind === 'connected' && (
            <button
              className="button-secondary"
              type="button"
              disabled={githubStatus.kind !== 'connected' || cloudSyncBusy || busy || cloudPassphrase.length < 12}
              onClick={() => void uploadCloudBackup(remoteRestoreCandidate.remote)}
            >
              Keep local data and replace remote
            </button>
          )}
          {remoteChangesPending && remoteBackupStatus?.exists === false && remoteSyncState && (
            <button
              className="button-secondary"
              type="button"
              disabled={githubStatus.kind !== 'connected' || cloudSyncBusy || busy || cloudPassphrase.length < 12}
              onClick={() => void uploadCloudBackup('new')}
            >
              Create a new remote backup
            </button>
          )}
          <button
            className="button-secondary"
            type="button"
            disabled={githubStatus.kind !== 'connected' || cloudSyncBusy || busy
              || remoteBackupStatus?.exists !== true || cloudPassphrase.length < 12}
            onClick={() => void validateRemoteBackup()}
          >
            Download and validate
          </button>
          {remoteRestoreCandidate && githubStatus.kind === 'connected' && (
            <button
              className="button-primary"
              type="button"
              disabled={githubStatus.kind !== 'connected' || cloudSyncBusy || busy}
              onClick={() => void restoreRemoteBackup()}
            >
              Restore validated remote backup
            </button>
          )}
        </div>
        {cloudSyncMessage && <p className="backup-message" role="status">{cloudSyncMessage}</p>}
        {cloudSyncError && <p className="backup-error" role="alert">{cloudSyncError}</p>}
      </section>

      <section className="backup-panel panel">
        <div className="performance-section-heading">
          <div>
            <div className="eyebrow">EXPORT</div>
            <h2>Create a portable backup</h2>
          </div>
        </div>
        <p>Encrypted exports use AES-256-GCM and a passphrase-derived key. The passphrase is never saved; losing it makes that file unrecoverable.</p>
        <div className="backup-fields">
          <label>
            <span>Backup passphrase · 12 characters minimum</span>
            <input autoComplete="new-password" type="password" value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} />
          </label>
          <label>
            <span>Confirm passphrase</span>
            <input autoComplete="new-password" type="password" value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} />
          </label>
        </div>
        <div className="backup-actions">
          <button className="button-primary" type="button" disabled={busy || cloudSyncBusy} onClick={() => void exportEncrypted()}>
            {busy ? 'Preparing…' : 'Download encrypted backup'}
          </button>
          <button className="button-secondary" type="button" disabled={busy || cloudSyncBusy} onClick={() => void exportPlaintext()}>Download plaintext JSON</button>
        </div>
      </section>

      <section className="backup-panel panel">
        <div>
          <div className="eyebrow">RECOVERY</div>
          <h2>Restore from a backup</h2>
        </div>
        <p>Choose a HUSSHUSS JSON backup. It is fully validated before any data is changed; the current three data stores are snapshotted for rollback first.</p>
        <label className="backup-file-label">
          <span>Backup file</span>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              setSelectedFile(file)
              setValidatedBundle(null)
              setMessage(file ? `${file.name} · ${formatBytes(file.size)}` : null)
              setError(null)
            }}
          />
        </label>
        {selectedFile && (
          <label className="backup-passphrase-import">
            <span>Backup passphrase · only needed for encrypted files</span>
            <input autoComplete="off" type="password" value={importPassphrase} onChange={(event) => {
              setImportPassphrase(event.target.value)
              setValidatedBundle(null)
            }} />
          </label>
        )}
        <div className="backup-actions">
          <button className="button-secondary" type="button" disabled={!selectedFile || busy || cloudSyncBusy} onClick={() => void validateSelectedFile()}>
            {busy ? 'Checking…' : 'Validate backup'}
          </button>
          {validatedBundle && <button className="button-primary" type="button" disabled={busy || cloudSyncBusy} onClick={() => void performRestore()}>Replace local data</button>}
        </div>
        {restoreSafetyDate && (
          <div className="backup-safety-restore">
            <p>Pre-restore snapshot saved {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(restoreSafetyDate))}.</p>
            <button type="button" className="button-secondary" disabled={busy || cloudSyncBusy} onClick={() => void restorePrevious()}>
              Restore previous local state
            </button>
          </div>
        )}
        {message && <p className="backup-message" role="status">{message}</p>}
        {error && <p className="backup-error" role="alert">{error}</p>}
      </section>

      <section className="backup-note">
        <strong>Important</strong>
        <span>These backups include workout history, unfinished workout state, EXTRAS session history and favourites, body measurements, and athletic assessments. They do not include unrelated browser data. Store exported files securely.</span>
      </section>
    </div>
  )
}
