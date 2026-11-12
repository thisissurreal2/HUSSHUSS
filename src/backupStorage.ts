import { isAthleticData, readAthleticData, ATHLETIC_STORAGE_KEY, type AthleticData } from './athleticStorage'
import { isMeasurementData, MEASUREMENT_STORAGE_KEY, type MeasurementData } from './measurementStorage'
import { createInitialData, isAppData, normalizeAppData, readAppData, STORAGE_KEY, type AppData } from './workoutStorage'
import { readMeasurementData } from './measurementStorage'
import { queueLocalSnapshots } from './localSyncQueue'
import { readConsistentPrimarySnapshots } from './localDatabase'

export const BACKUP_FORMAT = 'husshuss-backup'
export const BACKUP_VERSION = 2
// The encrypted envelope is unchanged (v1) so existing GitHub sync validators remain compatible.
const ENCRYPTED_BACKUP_VERSION = 1
export const ENCRYPTED_BACKUP_FORMAT = 'husshuss-encrypted-backup'
export const ENCRYPTION_ITERATIONS = 600_000
export const RESTORE_SAFETY_KEY = 'husshuss.restore-safety.v1'

function encryptionAadPrefix(version: number): string { return `${ENCRYPTED_BACKUP_FORMAT}\n${version}\nAES-256-GCM\nPBKDF2-SHA-256` }
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export type BackupBundle = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  data: {
    workouts: AppData
    measurements: MeasurementData
    athletic: AthleticData
  }
}

type EncryptedBackup = {
  format: typeof ENCRYPTED_BACKUP_FORMAT
  version: typeof ENCRYPTED_BACKUP_VERSION
  cipher: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA-256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredValue(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function encryptionAad(salt: string, iv: string, iterations: number, version: number): Uint8Array {
  return encoder.encode(`${encryptionAadPrefix(version)}\n${iterations}\n${salt}\n${iv}`)
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('Secure browser cryptography is unavailable. Use a current browser over HTTPS or localhost.')
  }
  return globalThis.crypto
}

function isBackupBundle(value: unknown): value is BackupBundle {
  return isObject(value)
    && value.format === BACKUP_FORMAT
    && value.version === BACKUP_VERSION
    && typeof value.exportedAt === 'string'
    && Number.isFinite(Date.parse(value.exportedAt))
    && isObject(value.data)
    && isAppData(value.data.workouts)
    && isMeasurementData(value.data.measurements)
    && isAthleticData(value.data.athletic)
}

function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (!isObject(value) || value.format !== ENCRYPTED_BACKUP_FORMAT
    || value.version !== ENCRYPTED_BACKUP_VERSION || value.cipher !== 'AES-256-GCM'
    || value.kdf !== 'PBKDF2-SHA-256' || typeof value.iterations !== 'number'
    || !Number.isInteger(value.iterations) || value.iterations < 100_000 || value.iterations > 1_000_000
    || typeof value.salt !== 'string' || typeof value.iv !== 'string'
    || typeof value.ciphertext !== 'string') return false

  try {
    return base64ToBytes(value.salt).length === 16
      && base64ToBytes(value.iv).length === 12
      && base64ToBytes(value.ciphertext).length >= 16
  } catch {
    return false
  }
}

async function createBundle(): Promise<BackupBundle> {
  const [workouts, measurements, athletic] = await Promise.all([
    readAppData(),
    readMeasurementData(),
    readAthleticData(),
  ])
  if (workouts.error) throw new Error(`Workout data could not be included in the backup: ${workouts.error}`)
  if (measurements.error) throw new Error(`Measurement data could not be included in the backup: ${measurements.error}`)
  if (athletic.error) throw new Error(`Athletic assessment data could not be included in the backup: ${athletic.error}`)
  const snapshots = await readConsistentPrimarySnapshots({
    workouts: isAppData,
    measurements: isMeasurementData,
    athletic: isAthleticData,
  })
  if (!isAppData(snapshots.workouts)
    || !isMeasurementData(snapshots.measurements)
    || !isAthleticData(snapshots.athletic)) {
    throw new Error('Local data changed or became invalid while creating the backup.')
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      workouts: { ...(snapshots.workouts as AppData), extrasSessions: (snapshots.workouts as AppData).extrasSessions ?? [], extrasFavourites: (snapshots.workouts as AppData).extrasFavourites ?? [] },
      measurements: snapshots.measurements,
      athletic: snapshots.athletic,
    },
  }
}

export async function createPlainBackup(): Promise<string> {
  const text = JSON.stringify(await createBundle(), null, 2)
  if (text.length > 50_000_000) throw new Error('This backup is too large to export (maximum 50 MB).')
  return text
}

async function encryptBundle(bundle: BackupBundle, passphrase: string): Promise<string> {
  if (passphrase.length < 12) throw new Error('Use a backup passphrase with at least 12 characters.')
  if (passphrase.length > 1024) throw new Error('The backup passphrase must be no more than 1,024 characters.')
  const crypto = requireCrypto()
  const salt = new Uint8Array(16)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(salt)
  crypto.getRandomValues(iv)
  const saltText = bytesToBase64(salt)
  const ivText = bytesToBase64(iv)
  const plainText = JSON.stringify(bundle, null, 2)
  if (plainText.length > 50_000_000) throw new Error('This backup is too large to export (maximum 50 MB).')
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(encoder.encode(passphrase)), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: ENCRYPTION_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(encryptionAad(saltText, ivText, ENCRYPTION_ITERATIONS, ENCRYPTED_BACKUP_VERSION)),
    },
    key,
    toArrayBuffer(encoder.encode(plainText)),
  )
  const result: EncryptedBackup = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: ENCRYPTION_ITERATIONS,
    salt: saltText,
    iv: ivText,
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
  return JSON.stringify(result, null, 2)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function fingerprintBackupData(data: BackupBundle['data']): Promise<string> {
  const digest = await requireCrypto().subtle.digest('SHA-256', encoder.encode(JSON.stringify(data)))
  return bytesToHex(new Uint8Array(digest))
}

export async function getCurrentBackupFingerprint(): Promise<string> {
  const bundle = await createBundle()
  return fingerprintBackupData(bundle.data)
}

export async function createEncryptedBackupWithFingerprint(
  passphrase: string,
): Promise<{ encryptedBackup: string; localFingerprint: string }> {
  const bundle = await createBundle()
  const [encryptedBackup, localFingerprint] = await Promise.all([
    encryptBundle(bundle, passphrase),
    fingerprintBackupData(bundle.data),
  ])
  return { encryptedBackup, localFingerprint }
}

export async function createEncryptedBackup(passphrase: string): Promise<string> {
  const bundle = await createBundle()
  return encryptBundle(bundle, passphrase)
}

export async function parseBackup(text: string, passphrase: string): Promise<BackupBundle> {
  if (text.length > 50_000_000) throw new Error('This backup is too large to import (maximum 50 MB).')
  if (passphrase.length > 1024) throw new Error('The backup passphrase must be no more than 1,024 characters.')
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }

  if (isEncryptedBackup(parsed)) {
    if (passphrase.length === 0) throw new Error('Enter the passphrase used to encrypt this backup.')
    const crypto = requireCrypto()
    const salt = base64ToBytes(parsed.salt)
    const iv = base64ToBytes(parsed.iv)
    const material = await crypto.subtle.importKey('raw', toArrayBuffer(encoder.encode(passphrase)), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: parsed.iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    let decrypted: ArrayBuffer
    try {
      decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(iv),
          additionalData: toArrayBuffer(encryptionAad(parsed.salt, parsed.iv, parsed.iterations, parsed.version)),
        },
        key,
        toArrayBuffer(base64ToBytes(parsed.ciphertext)),
      )
    } catch {
      throw new Error('The passphrase is incorrect or the encrypted backup has been altered.')
    }
    try {
      parsed = JSON.parse(decoder.decode(decrypted)) as unknown
    } catch {
      throw new Error('The decrypted backup is not valid UTF-8 JSON.')
    }
  }

  if (isObject(parsed) && parsed.format === BACKUP_FORMAT && (parsed.version === 1 || parsed.version === BACKUP_VERSION) && isObject(parsed.data)) {
    const workouts = normalizeAppData(parsed.data.workouts)
    if (workouts) parsed = { ...parsed, version: BACKUP_VERSION, data: { ...parsed.data, workouts } }
  }
  if (!isBackupBundle(parsed)) {
    throw new Error('This backup is invalid or uses an unsupported format. No data has been changed.')
  }
  return parsed
}

type RestoreSafetySnapshot = {
  createdAt: string
  values: Record<typeof STORAGE_KEY | typeof MEASUREMENT_STORAGE_KEY | typeof ATHLETIC_STORAGE_KEY, string | null>
}

function readSafetySnapshot(): RestoreSafetySnapshot | null {
  try {
    const raw = window.localStorage.getItem(RESTORE_SAFETY_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed) || parsed.format !== 'husshuss-restore-safety' || parsed.version !== 1
      || typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))
      || !isObject(parsed.values)) return null
    const values = parsed.values
    if (!isStoredValue(values[STORAGE_KEY])
      || !isStoredValue(values[MEASUREMENT_STORAGE_KEY])
      || !isStoredValue(values[ATHLETIC_STORAGE_KEY])) return null
    return {
      createdAt: parsed.createdAt,
      values: {
        [STORAGE_KEY]: values[STORAGE_KEY],
        [MEASUREMENT_STORAGE_KEY]: values[MEASUREMENT_STORAGE_KEY],
        [ATHLETIC_STORAGE_KEY]: values[ATHLETIC_STORAGE_KEY],
      },
    }
  } catch {
    return null
  }
}

export function getRestoreSafetyDate(): string | null {
  return readSafetySnapshot()?.createdAt ?? null
}

function parseSafetyValue<T>(
  raw: string | null,
  normalize: (value: unknown) => T | null,
  fallback: T,
  label: string,
): T {
  if (raw === null) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`The recovery snapshot's ${label} data is not valid JSON.`)
  }
  const value = normalize(parsed)
  if (value === null) throw new Error(`The recovery snapshot's ${label} data is invalid or unsupported.`)
  return value
}

export async function restorePreviousDataSnapshot(): Promise<void> {
  const safetySnapshot = readSafetySnapshot()
  if (!safetySnapshot) throw new Error('No valid pre-restore recovery snapshot is available.')
  const [currentWorkouts, currentMeasurements, currentAthletic] = await Promise.all([
    readAppData(),
    readMeasurementData(),
    readAthleticData(),
  ])
  const currentErrors = [currentWorkouts.error, currentMeasurements.error, currentAthletic.error].filter(Boolean)
  if (currentErrors.length > 0) throw new Error(`Current data could not be secured before recovery: ${currentErrors.join(' ')}`)
  const current = {
    [STORAGE_KEY]: JSON.stringify(currentWorkouts.data),
    [MEASUREMENT_STORAGE_KEY]: JSON.stringify(currentMeasurements.data),
    [ATHLETIC_STORAGE_KEY]: JSON.stringify(currentAthletic.data),
  }
  const workouts = parseSafetyValue(
    safetySnapshot.values[STORAGE_KEY], normalizeAppData, createInitialData(), 'workout',
  )
  const measurements = parseSafetyValue(
    safetySnapshot.values[MEASUREMENT_STORAGE_KEY],
    (value) => isMeasurementData(value) ? value : null,
    { version: 1, sessions: [] }, 'measurement',
  )
  const athletic = parseSafetyValue(
    safetySnapshot.values[ATHLETIC_STORAGE_KEY],
    (value) => isAthleticData(value) ? value : null,
    { version: 1, customAssessments: [], records: [] }, 'athletic assessment',
  )

  const previousSafetyRaw = window.localStorage.getItem(RESTORE_SAFETY_KEY)
  const currentSafety = JSON.stringify({
    format: 'husshuss-restore-safety',
    version: 1,
    createdAt: new Date().toISOString(),
    values: current,
  })
  window.localStorage.setItem(RESTORE_SAFETY_KEY, currentSafety)
  try {
    await queueLocalSnapshots([
      { category: 'workouts', snapshot: workouts },
      { category: 'measurements', snapshot: measurements },
      { category: 'athletic', snapshot: athletic },
    ])
  } catch (error) {
    try {
      if (previousSafetyRaw === null) window.localStorage.removeItem(RESTORE_SAFETY_KEY)
      else window.localStorage.setItem(RESTORE_SAFETY_KEY, previousSafetyRaw)
    } catch {
      throw new Error(`Recovery failed and the safety pointer could not be restored. Your database transaction was atomic; the original data remains available under ${RESTORE_SAFETY_KEY}.`)
    }
    throw error
  }
  window.dispatchEvent(new Event('husshuss:local-data-changed'))
}

export async function restoreBackup(bundle: BackupBundle): Promise<void> {
  if (!isBackupBundle(bundle)) throw new Error('This backup is invalid or uses an unsupported format. No data has been changed.')
  const [currentWorkouts, currentMeasurements, currentAthletic] = await Promise.all([
    readAppData(),
    readMeasurementData(),
    readAthleticData(),
  ])
  const currentErrors = [currentWorkouts.error, currentMeasurements.error, currentAthletic.error].filter(Boolean)
  if (currentErrors.length > 0) throw new Error(`Current data could not be secured before restore: ${currentErrors.join(' ')}`)
  const previous = {
    [STORAGE_KEY]: JSON.stringify(currentWorkouts.data),
    [MEASUREMENT_STORAGE_KEY]: JSON.stringify(currentMeasurements.data),
    [ATHLETIC_STORAGE_KEY]: JSON.stringify(currentAthletic.data),
  }
  const recoveryPoint = JSON.stringify({
    format: 'husshuss-restore-safety',
    version: 1,
    createdAt: new Date().toISOString(),
    values: previous,
  })

  window.localStorage.setItem(RESTORE_SAFETY_KEY, recoveryPoint)
  await queueLocalSnapshots([
    { category: 'workouts', snapshot: { ...bundle.data.workouts, extrasSessions: bundle.data.workouts.extrasSessions ?? [], extrasFavourites: bundle.data.workouts.extrasFavourites ?? [] } },
    { category: 'measurements', snapshot: bundle.data.measurements },
    { category: 'athletic', snapshot: bundle.data.athletic },
  ])
  window.dispatchEvent(new Event('husshuss:local-data-changed'))
}
