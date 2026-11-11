import { stageLocalSnapshot } from './localSyncQueue'

export const MEASUREMENT_STORAGE_KEY = 'husshuss.measurements'
export const MEASUREMENT_DATA_VERSION = 1

export type MeasurementValues = {
  neckCm: number | null
  chestCm: number | null
  waistCm: number | null
  shouldersCm: number | null
  bicepsRelaxedCm: number | null
  bicepsFlexedCm: number | null
  forearmsRelaxedCm: number | null
  forearmsFlexedCm: number | null
  thighCm: number | null
  calfCm: number | null
  bodyWeightKg: number | null
}

export type MeasurementSession = {
  id: string
  date: string
  createdAt: number
  updatedAt: number
  values: MeasurementValues
}

export type MeasurementData = {
  version: typeof MEASUREMENT_DATA_VERSION
  sessions: MeasurementSession[]
}

const valueKeys: (keyof MeasurementValues)[] = [
  'neckCm',
  'chestCm',
  'waistCm',
  'shouldersCm',
  'bicepsRelaxedCm',
  'bicepsFlexedCm',
  'forearmsRelaxedCm',
  'forearmsFlexedCm',
  'thighCm',
  'calfCm',
  'bodyWeightKg',
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime())
    && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10))
}

function isMeasurementValue(key: keyof MeasurementValues, value: unknown): value is number | null {
  if (value === null) return true
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  return key === 'bodyWeightKg'
    ? value > 0 && value <= 500
    : value > 0 && value <= 300
}

function isMeasurementSession(value: unknown): value is MeasurementSession {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.length === 0
    || value.id.length > 128 || !isDate(value.date)
    || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)
    || !isObject(value.values)) {
    return false
  }
  const values = value.values
  return valueKeys.every((key) => isMeasurementValue(key, values[key]))
}

export function isMeasurementData(value: unknown): value is MeasurementData {
  if (!isObject(value) || value.version !== MEASUREMENT_DATA_VERSION
    || !Array.isArray(value.sessions) || !value.sessions.every(isMeasurementSession)) {
    return false
  }
  const ids = value.sessions.map((session) => session.id)
  const dates = value.sessions.map((session) => session.date)
  return new Set(ids).size === ids.length && new Set(dates).size === dates.length
}

export function readMeasurementData(): { data: MeasurementData; error: string | null } {
  try {
    const raw = window.localStorage.getItem(MEASUREMENT_STORAGE_KEY)
    if (raw === null) {
      return {
        data: { version: MEASUREMENT_DATA_VERSION, sessions: [] },
        error: null,
      }
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isMeasurementData(parsed)) {
      return {
        data: { version: MEASUREMENT_DATA_VERSION, sessions: [] },
        error: 'Saved measurement data is invalid or from an unsupported version. It has not been overwritten.',
      }
    }
    return { data: parsed, error: null }
  } catch {
    return {
      data: { version: MEASUREMENT_DATA_VERSION, sessions: [] },
      error: 'Saved measurement data could not be read. Browser storage may be unavailable or corrupted.',
    }
  }
}

export function writeMeasurementData(data: MeasurementData): void {
  window.localStorage.setItem(MEASUREMENT_STORAGE_KEY, JSON.stringify(data))
  stageLocalSnapshot('measurements', data)
}

export function createMeasurementId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createEmptyMeasurementValues(): MeasurementValues {
  return {
    neckCm: null,
    chestCm: null,
    waistCm: null,
    shouldersCm: null,
    bicepsRelaxedCm: null,
    bicepsFlexedCm: null,
    forearmsRelaxedCm: null,
    forearmsFlexedCm: null,
    thighCm: null,
    calfCm: null,
    bodyWeightKg: null,
  }
}
