import { useEffect, useRef, useState } from 'react'
import {
  createEncryptedBackup,
  createPlainBackup,
  getRestoreSafetyDate,
  parseBackup,
  restoreBackup,
  restorePreviousDataSnapshot,
  type BackupBundle,
} from './backupStorage'
import { getPendingLocalChanges } from './localSyncQueue'

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
  const response = await fetch('/api/github/status', { cache: 'no-store', credentials: 'same-origin' })
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
  const [connectionMessage, setConnectionMessage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('github_connection') === 'failed'
      ? 'GitHub could not verify the selected private repository. No fitness data was sent.'
      : null
  })
  const [restoreSafetyDate] = useState(getRestoreSafetyDate)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  async function disconnectGitHub() {
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

  async function exportEncrypted() {
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
      setBusy(false)
    }
  }

  function exportPlaintext() {
    setError(null)
    setMessage(null)
    if (!window.confirm('This file contains readable personal workout and body data. Save it only in a location you trust. Continue?')) return
    try {
      downloadJson(createPlainBackup(), 'plaintext')
      setMessage('Plaintext backup downloaded. Anyone with the file can read its contents.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the backup.')
    }
  }

  async function validateSelectedFile() {
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
      setBusy(false)
    }
  }

  async function performRestore() {
    if (!validatedBundle) return
    if (!window.confirm('Replace all HUSSHUSS workout, measurement, and athletic data on this device with this backup? A recovery snapshot of the current data will be saved first.')) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      await restoreBackup(validatedBundle)
      onRestored()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Restore failed.')
    } finally {
      setBusy(false)
    }
  }

  async function restorePrevious() {
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
      setBusy(false)
    }
  }

  return (
    <div className="backup-recovery">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR DATA · PHASE 3.5</div>
          <h1>Keep a copy. Keep control.</h1>
          <p className="page-subtitle">Export or restore your local records. Files stay on this device unless you move them yourself.</p>
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
          <p>Phase 4.2 verifies the private repository only. Fitness data upload and remote sync are not enabled.</p>
          {connectionMessage && <p className="connection-message" role="status">{connectionMessage}</p>}
          <div className="backup-actions connection-actions">
            {githubStatus.kind === 'not-connected' && (
              <button
                className="button-primary"
                type="button"
                disabled={connectionBusy}
                onClick={() => { window.location.assign('/api/github/connect') }}
              >
                Connect private repository
              </button>
            )}
            {(githubStatus.kind === 'connected' || githubStatus.kind === 'verification-unavailable') && (
              <button className="button-secondary" type="button" disabled={connectionBusy} onClick={() => void disconnectGitHub()}>
                Disconnect this device
              </button>
            )}
            <button
              className="button-secondary"
              type="button"
              disabled={connectionBusy || githubStatus.kind === 'checking'}
              onClick={() => void refreshGitHubStatus()}
            >
              Check status
            </button>
          </div>
        </div>
        <div className="backup-queue-count">
          <strong>{pendingCount === null ? '—' : pendingCount}</strong>
          <span>data areas staged locally</span>
        </div>
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
          <button className="button-primary" type="button" disabled={busy} onClick={() => void exportEncrypted()}>
            {busy ? 'Preparing…' : 'Download encrypted backup'}
          </button>
          <button className="button-secondary" type="button" disabled={busy} onClick={exportPlaintext}>Download plaintext JSON</button>
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
          <button className="button-secondary" type="button" disabled={!selectedFile || busy} onClick={() => void validateSelectedFile()}>
            {busy ? 'Checking…' : 'Validate backup'}
          </button>
          {validatedBundle && <button className="button-primary" type="button" disabled={busy} onClick={() => void performRestore()}>Replace local data</button>}
        </div>
        {restoreSafetyDate && (
          <div className="backup-safety-restore">
            <p>Pre-restore snapshot saved {new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(restoreSafetyDate))}.</p>
            <button type="button" className="button-secondary" disabled={busy} onClick={() => void restorePrevious()}>
              Restore previous local state
            </button>
          </div>
        )}
        {message && <p className="backup-message" role="status">{message}</p>}
        {error && <p className="backup-error" role="alert">{error}</p>}
      </section>

      <section className="backup-note">
        <strong>Important</strong>
        <span>These backups include workout history, unfinished workout state, body measurements, and athletic assessments. They do not include unrelated browser data. Store exported files securely.</span>
      </section>
    </div>
  )
}
