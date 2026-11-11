import { isAthleticData, ATHLETIC_STORAGE_KEY, type AthleticData } from './athleticStorage'
import { isMeasurementData, MEASUREMENT_STORAGE_KEY, type MeasurementData } from './measurementStorage'
import { createInitialData, isAppData, STORAGE_KEY, type AppData } from './workoutStorage'
import { queueLocalSnapshots } from './localSyncQueue'

export const BACKUP_FORMAT = 'husshuss-backup'
export const BACKUP_VERSION = 1
export const ENCRYPTED_BACKUP_FORMAT = 'husshuss-encrypted-backup'
export const ENCRYPTION_ITERATIONS = 600_000
export const RESTORE_SAFETY_KEY = 'husshuss.restore-safety.v1'

const encryptionAadPrefix = `${ENCRYPTED_BACKUP_FORMAT}\n${BACKUP_VERSION}\nAES-256-GCM\nPBKDF2-SHA-256`
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
  version: typeof BACKUP_VERSION
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

function encryptionAad(salt: string, iv: string, iterations: number): Uint8Array {
  return encoder.encode(`${encryptionAadPrefix}\n${iterations}\n${salt}\n${iv}`)
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
    || value.version !== BACKUP_VERSION || value.cipher !== 'AES-256-GCM'
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

function createBundle(): BackupBundle {
  const workoutRaw = window.localStorage.getItem(STORAGE_KEY)
  const measurementRaw = window.localStorage.getItem(MEASUREMENT_STORAGE_KEY)
  const athleticRaw = window.localStorage.getItem(ATHLETIC_STORAGE_KEY)
  const workouts = workoutRaw === null ? createInitialData() : JSON.parse(workoutRaw) as unknown
  const measurements = measurementRaw === null
    ? { version: 1, sessions: [] }
    : JSON.parse(measurementRaw) as unknown
  const athletic = athleticRaw === null
    ? { version: 1, customAssessments: [], records: [] }
    : JSON.parse(athleticRaw) as unknown

  if (!isAppData(workouts)) {
    throw new Error('Workout data is invalid or unsupported. It was not included in the backup.')
  }
  if (!isMeasurementData(measurements)) {
    throw new Error('Measurement data is invalid or unsupported. It was not included in the backup.')
  }
  if (!isAthleticData(athletic)) {
    throw new Error('Athletic assessment data is invalid or unsupported. It was not included in the backup.')
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { workouts, measurements, athletic },
  }
}

export function createPlainBackup(): string {
  const text = JSON.stringify(createBundle(), null, 2)
  if (text.length > 50_000_000) throw new Error('This backup is too large to export (maximum 50 MB).')
  return text
}

export async function createEncryptedBackup(passphrase: string): Promise<string> {
  if (passphrase.length < 12) throw new Error('Use a backup passphrase with at least 12 characters.')
  if (passphrase.length > 1024) throw new Error('The backup passphrase must be no more than 1,024 characters.')
  const crypto = requireCrypto()
  const salt = new Uint8Array(16)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(salt)
  crypto.getRandomValues(iv)
  const saltText = bytesToBase64(salt)
  const ivText = bytesToBase64(iv)
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
      additionalData: toArrayBuffer(encryptionAad(saltText, ivText, ENCRYPTION_ITERATIONS)),
    },
    key,
    toArrayBuffer(encoder.encode(createPlainBackup())),
  )
  const result: EncryptedBackup = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: BACKUP_VERSION,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: ENCRYPTION_ITERATIONS,
    salt: saltText,
    iv: ivText,
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
  return JSON.stringify(result, null, 2)
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
          additionalData: toArrayBuffer(encryptionAad(parsed.salt, parsed.iv, parsed.iterations)),
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

  if (!isBackupBundle(parsed)) {
    throw new Error('This backup is invalid or uses an unsupported format. No data has been changed.')
  }
  return parsed
}

function restoreRawValue(key: string, rawValue: string | null): void {
  if (rawValue === null) window.localStorage.removeItem(key)
  else window.localStorage.setItem(key, rawValue)
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
  validator: (value: unknown) => value is T,
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
  if (!validator(parsed)) throw new Error(`The recovery snapshot's ${label} data is invalid or unsupported.`)
  return parsed
}

export async function restorePreviousDataSnapshot(): Promise<void> {
  const safetySnapshot = readSafetySnapshot()
  if (!safetySnapshot) throw new Error('No valid pre-restore recovery snapshot is available.')
  const keys = [STORAGE_KEY, MEASUREMENT_STORAGE_KEY, ATHLETIC_STORAGE_KEY] as const
  const current = Object.fromEntries(keys.map((key) => [key, window.localStorage.getItem(key)]))
  const workouts = parseSafetyValue(
    safetySnapshot.values[STORAGE_KEY], isAppData, createInitialData(), 'workout',
  )
  const measurements = parseSafetyValue(
    safetySnapshot.values[MEASUREMENT_STORAGE_KEY], isMeasurementData,
    { version: 1, sessions: [] }, 'measurement',
  )
  const athletic = parseSafetyValue(
    safetySnapshot.values[ATHLETIC_STORAGE_KEY], isAthleticData,
    { version: 1, customAssessments: [], records: [] }, 'athletic assessment',
  )

  window.localStorage.setItem(RESTORE_SAFETY_KEY, JSON.stringify({
    format: 'husshuss-restore-safety',
    version: 1,
    createdAt: new Date().toISOString(),
    values: current,
  }))
  try {
    for (const key of keys) restoreRawValue(key, safetySnapshot.values[key])
    await queueLocalSnapshots([
      { category: 'workouts', snapshot: workouts },
      { category: 'measurements', snapshot: measurements },
      { category: 'athletic', snapshot: athletic },
    ])
  } catch (error) {
    try {
      for (const key of keys) restoreRawValue(key, current[key])
    } catch {
      throw new Error(`Recovery restore failed and automatic rollback could not finish. The prior values are preserved under ${RESTORE_SAFETY_KEY}.`)
    }
    throw new Error(error instanceof Error
      ? `Recovery restore failed; the current data was restored. ${error.message}`
      : 'Recovery restore failed; the current data was restored.')
  }
  window.dispatchEvent(new Event('husshuss:local-data-changed'))
}

export async function restoreBackup(bundle: BackupBundle): Promise<void> {
  const keys = [STORAGE_KEY, MEASUREMENT_STORAGE_KEY, ATHLETIC_STORAGE_KEY] as const
  const previous = Object.fromEntries(keys.map((key) => [key, window.localStorage.getItem(key)]))
  const recoveryPoint = JSON.stringify({
    format: 'husshuss-restore-safety',
    version: 1,
    createdAt: new Date().toISOString(),
    values: previous,
  })

  window.localStorage.setItem(RESTORE_SAFETY_KEY, recoveryPoint)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle.data.workouts))
    window.localStorage.setItem(MEASUREMENT_STORAGE_KEY, JSON.stringify(bundle.data.measurements))
    window.localStorage.setItem(ATHLETIC_STORAGE_KEY, JSON.stringify(bundle.data.athletic))
    await queueLocalSnapshots([
      { category: 'workouts', snapshot: bundle.data.workouts },
      { category: 'measurements', snapshot: bundle.data.measurements },
      { category: 'athletic', snapshot: bundle.data.athletic },
    ])
  } catch (error) {
    try {
      for (const key of keys) restoreRawValue(key, previous[key])
    } catch {
      throw new Error(`Restore was interrupted and automatic rollback also failed. The original values are preserved under ${RESTORE_SAFETY_KEY}.`)
    }
    throw new Error(error instanceof Error
      ? `Restore failed; the previous data was restored. ${error.message}`
      : 'Restore failed; the previous data was restored.')
  }
  window.dispatchEvent(new Event('husshuss:local-data-changed'))
}
