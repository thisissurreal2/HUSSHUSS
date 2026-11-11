import { readPrimarySnapshot, writePrimarySnapshot } from './localDatabase'

export const ATHLETIC_STORAGE_KEY = 'husshuss.athletic'
export const ATHLETIC_DATA_VERSION = 1

export type AthleticCategoryId =
  | 'strength'
  | 'core'
  | 'grip'
  | 'balance'
  | 'conditioning'
  | 'agility'
  | 'power'

export type PerformanceDirection = 'higher' | 'lower'
export type AthleticUnit = 'reps' | 'seconds' | 'kg' | 'm' | 'km' | 'cm' | 'score'

export type AthleticMetric = {
  key: string
  label: string
  unit: AthleticUnit
  direction: PerformanceDirection
  maximum: number
  derived?: 'pace'
}

export type AssessmentDefinition = {
  id: string
  category: AthleticCategoryId
  name: string
  metrics: AthleticMetric[]
  custom: boolean
}

export type AthleticRecord = {
  id: string
  assessmentId: string
  assessmentName: string
  category: AthleticCategoryId
  date: string
  createdAt: number
  updatedAt: number
  values: Record<string, number>
  notes: string
}

export type AthleticData = {
  version: typeof ATHLETIC_DATA_VERSION
  customAssessments: AssessmentDefinition[]
  records: AthleticRecord[]
}

export const athleticCategories: { id: AthleticCategoryId; label: string; description: string }[] = [
  { id: 'strength', label: 'Strength', description: 'Repetition-based strength tests.' },
  { id: 'core', label: 'Core stability', description: 'Trunk endurance and control.' },
  { id: 'grip', label: 'Grip strength', description: 'Loaded carries and grip capacity.' },
  { id: 'balance', label: 'Balance', description: 'Steadiness on each side.' },
  { id: 'conditioning', label: 'Conditioning & stamina', description: 'Endurance tests at your own pace.' },
  { id: 'agility', label: 'Agility', description: 'Timed changes of direction.' },
  { id: 'power', label: 'Explosive power', description: 'Jump and short sprint results.' },
]

const reps = (key: string, label: string, direction: PerformanceDirection = 'higher'): AthleticMetric => ({
  key, label, unit: 'reps', direction, maximum: 10000,
})
const seconds = (key: string, label: string, direction: PerformanceDirection = 'higher'): AthleticMetric => ({
  key, label, unit: 'seconds', direction, maximum: 86400,
})
const metric = (
  key: string,
  label: string,
  unit: AthleticUnit,
  direction: PerformanceDirection,
  maximum: number,
): AthleticMetric => ({ key, label, unit, direction, maximum })

export const builtInAssessments: AssessmentDefinition[] = [
  { id: 'max-push-ups', category: 'strength', name: 'Maximum push-ups', metrics: [reps('reps', 'Repetitions')], custom: false },
  { id: 'max-pull-ups', category: 'strength', name: 'Maximum pull-ups', metrics: [reps('reps', 'Repetitions')], custom: false },
  { id: 'plank-hold', category: 'core', name: 'Plank hold', metrics: [seconds('seconds', 'Duration')], custom: false },
  {
    id: 'farmer-carry',
    category: 'grip',
    name: 'Farmer carry',
    metrics: [
      metric('weightKg', 'Weight carried', 'kg', 'higher', 1000),
      seconds('durationSeconds', 'Duration'),
      metric('distanceM', 'Distance', 'm', 'higher', 100000),
    ],
    custom: false,
  },
  {
    id: 'single-leg-balance',
    category: 'balance',
    name: 'Single-leg balance',
    metrics: [
      seconds('leftSeconds', 'Left leg duration'),
      seconds('rightSeconds', 'Right leg duration'),
    ],
    custom: false,
  },
  {
    id: 'timed-run',
    category: 'conditioning',
    name: 'Timed run',
    metrics: [
        metric('distanceKm', 'Running distance', 'km', 'higher', 1000),
        seconds('durationSeconds', 'Running time', 'lower'),
      ],
    custom: false,
  },
  {
    id: 'shuttle-run',
    category: 'agility',
    name: 'Shuttle run / change of direction',
    metrics: [seconds('seconds', 'Completion time', 'lower')],
    custom: false,
  },
  {
    id: 'vertical-jump',
    category: 'power',
    name: 'Vertical jump',
    metrics: [metric('cm', 'Jump height', 'cm', 'higher', 300)],
    custom: false,
  },
  {
    id: 'short-sprint',
    category: 'power',
    name: 'Short-distance sprint',
    metrics: [seconds('seconds', 'Sprint time', 'lower')],
    custom: false,
  },
]

const validCategories = new Set(athleticCategories.map((category) => category.id))
const validUnits = new Set<AthleticUnit>(['reps', 'seconds', 'kg', 'm', 'km', 'cm', 'score'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime())
    && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value
}

function isAssessment(value: unknown): value is AssessmentDefinition {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128
    || !validCategories.has(value.category as AthleticCategoryId) || typeof value.name !== 'string'
    || value.name.trim().length === 0 || value.name.length > 80 || value.custom !== true
    || !Array.isArray(value.metrics) || value.metrics.length !== 1) return false
  const item = value.metrics[0]
  return isObject(item) && item.key === 'result' && item.label === 'Result'
    && validUnits.has(item.unit as AthleticUnit)
    && (item.direction === 'higher' || item.direction === 'lower')
    && typeof item.maximum === 'number' && Number.isFinite(item.maximum) && item.maximum > 0
}

function isRecord(value: unknown): value is AthleticRecord {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128
    || typeof value.assessmentId !== 'string' || value.assessmentId.length === 0
    || typeof value.assessmentName !== 'string' || !validCategories.has(value.category as AthleticCategoryId)
    || !isDate(value.date) || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
    || typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)
    || !isObject(value.values) || typeof value.notes !== 'string' || value.notes.length > 1000) return false
  const entries = Object.entries(value.values)
  return entries.length > 0 && entries.length <= 8 && entries.every(([key, result]) => (
    /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) && typeof result === 'number' && Number.isFinite(result) && result > 0
  ))
}

export function isAthleticData(value: unknown): value is AthleticData {
  if (!isObject(value) || value.version !== ATHLETIC_DATA_VERSION
    || !Array.isArray(value.customAssessments) || !value.customAssessments.every(isAssessment)
    || !Array.isArray(value.records) || !value.records.every(isRecord)) return false
  const allIds = [
    ...value.customAssessments.map((assessment) => assessment.id),
    ...value.records.map((record) => record.id),
  ]
  if (new Set(allIds).size !== allIds.length) return false
  const definitions = [...builtInAssessments, ...value.customAssessments]
  return value.records.every((record) => {
    const definition = definitions.find((item) => item.id === record.assessmentId)
    if (!definition || definition.category !== record.category || definition.name !== record.assessmentName) return false
    const validMetrics = new Map(definition.metrics.map((item) => [item.key, item]))
    return Object.entries(record.values).every(([key, result]) => {
      const item = validMetrics.get(key)
      return item !== undefined && result <= item.maximum
    })
  })
}

export function readAthleticData(): Promise<{ data: AthleticData; error: string | null; usable: boolean }> {
  return readPrimarySnapshot(
    'athletic',
    ATHLETIC_STORAGE_KEY,
    isAthleticData,
    (value) => isAthleticData(value) ? value : null,
    { version: ATHLETIC_DATA_VERSION, customAssessments: [], records: [] },
  )
}

export function writeAthleticData(data: AthleticData): Promise<void> {
  return writePrimarySnapshot('athletic', data, isAthleticData)
}

export function createAthleticId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function athleticUnitLabel(unit: AthleticUnit): string {
  const labels: Record<AthleticUnit, string> = {
    reps: 'reps',
    seconds: 'sec',
    kg: 'kg',
    m: 'm',
    km: 'km',
    cm: 'cm',
    score: 'score',
  }
  return labels[unit]
}
