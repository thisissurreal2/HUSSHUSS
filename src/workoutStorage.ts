import { getWorkout, workouts, type Exercise, type Workout, type WorkoutId } from './workouts'
import { readPrimarySnapshot, writePrimarySnapshot } from './localDatabase'
import { isExtraSessionRecord, type ExtraSessionRecord } from './extras'

export const STORAGE_KEY = 'husshuss.data'
export const DATA_VERSION = 2

export type SetEntry = {
  id: string
  weightKg: string
  reps: string
  completed: boolean
}

export type ActiveExercise = {
  exerciseId: string
  completed: boolean
  sets: SetEntry[]
}

export type ActiveWorkout = {
  id: string
  workoutId: WorkoutId
  startedAt: number
  template: Workout
  exercises: ActiveExercise[]
  warmupCompletedIds: string[]
  cooldownCompletedIds: string[]
}

export type RecordedSet = {
  id: string
  weightKg: number | null
  reps: number | null
  completed: boolean
}

export type RecordedExercise = {
  exerciseId: string
  name: string
  instructions: string
  targetSets: number
  targetReps: string
  completed: boolean
  sets: RecordedSet[]
}

export type WorkoutRecord = {
  id: string
  workoutId: WorkoutId
  workoutName: string
  startedAt: number
  completedAt: number
  durationSeconds: number
  exercises: RecordedExercise[]
}

export type AppData = {
  version: typeof DATA_VERSION
  rotationIndex: number
  currentWorkout: ActiveWorkout | null
  history: WorkoutRecord[]
  restDurationSeconds: number
  timerRemainingSeconds: number
  timerDeadline: number | null
  timerRunning: boolean
  recoverySelected: boolean
  extrasSessions?: ExtraSessionRecord[]
  extrasFavourites?: string[]
  timerAutoStart?: boolean
  timerCountdownWarnings?: boolean
  timerVibration?: boolean
}

export const restPresets = [30, 60, 90, 120, 180] as const
export const MIN_REST_SECONDS = 15
export const MAX_REST_SECONDS = 600

export function createInitialData(): AppData {
  return {
    version: DATA_VERSION,
    rotationIndex: 0,
    currentWorkout: null,
    history: [],
    restDurationSeconds: 90,
    timerRemainingSeconds: 90,
    timerDeadline: null,
    timerRunning: false,
    recoverySelected: false,
    extrasSessions: [],
    extrasFavourites: [],
    timerAutoStart: true,
    timerCountdownWarnings: true,
    timerVibration: false,
  }
}

export function createId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function previousSets(history: WorkoutRecord[], exerciseId: string): RecordedSet[] {
  let latestAt = -1
  let latest: RecordedSet[] = []
  for (const record of history) {
    const exercise = record.exercises.find((item) => item.exerciseId === exerciseId)
    if (!exercise || record.completedAt <= latestAt) continue
    const done = exercise.sets.filter((set) => set.completed && set.weightKg !== null && set.reps !== null)
    if (done.length === 0) continue
    latestAt = record.completedAt
    latest = done
  }
  return latest
}

export function createActiveWorkout(
  workoutId: WorkoutId,
  startedAt = Date.now(),
  history: WorkoutRecord[] = [],
): ActiveWorkout {
  const workout = getWorkout(workoutId)
  return {
    id: createId(),
    workoutId,
    startedAt,
    template: workout,
    exercises: workout.exercises.map((exercise) => {
      const previous = previousSets(history, exercise.id)
      return {
        exerciseId: exercise.id,
        completed: false,
        sets: Array.from({ length: exercise.targetSets }, (_, index) => {
          const last = previous[Math.min(index, previous.length - 1)]
          return {
            id: createId(),
            weightKg: last ? String(last.weightKg) : '',
            reps: last ? String(last.reps) : '',
            completed: false,
          }
        }),
      }
    }),
    warmupCompletedIds: [],
    cooldownCompletedIds: [],
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isWorkoutId(value: unknown): value is WorkoutId {
  return workouts.some((workout) => workout.id === value)
}

function isSetEntry(value: unknown): value is SetEntry {
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 128
    && typeof value.weightKg === 'string'
    && (value.weightKg === '' || (/^\d+(\.\d{0,2})?$/.test(value.weightKg) && Number.isFinite(Number(value.weightKg)) && Number(value.weightKg) <= 1000))
    && typeof value.reps === 'string'
    && (value.reps === '' || (/^\d+$/.test(value.reps) && Number(value.reps) > 0 && Number(value.reps) <= 500))
    && typeof value.completed === 'boolean'
}

function isExercise(value: unknown): value is Exercise {
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && typeof value.focus === 'string'
    && typeof value.instructions === 'string'
    && Number.isInteger(value.targetSets)
    && (value.targetSets as number) > 0
    && (value.targetSets as number) <= 20
    && typeof value.targetReps === 'string'
    && (value.isLowerBody === undefined || typeof value.isLowerBody === 'boolean')
}

function isWorkoutTemplate(value: unknown): value is Workout {
  return isObject(value)
    && isWorkoutId(value.id)
    && typeof value.name === 'string'
    && typeof value.focus === 'string'
    && typeof value.description === 'string'
    && typeof value.duration === 'string'
    && Array.isArray(value.warmup)
    && value.warmup.every((item) => isObject(item)
      && typeof item.id === 'string'
      && typeof item.name === 'string'
      && typeof item.instructions === 'string')
    && Array.isArray(value.cooldown)
    && value.cooldown.every((item) => isObject(item)
      && typeof item.id === 'string'
      && typeof item.name === 'string'
      && typeof item.instructions === 'string')
    && Array.isArray(value.exercises)
    && value.exercises.length > 0
    && value.exercises.length <= 20
    && value.exercises.every(isExercise)
}

function isActiveWorkout(value: unknown): value is ActiveWorkout {
  if (!isObject(value) || typeof value.id !== 'string' || !isWorkoutId(value.workoutId)
    || !isTimestamp(value.startedAt) || !isWorkoutTemplate(value.template)
    || value.template.id !== value.workoutId || !Array.isArray(value.exercises)
    || !Array.isArray(value.warmupCompletedIds) || !Array.isArray(value.cooldownCompletedIds)) {
    return false
  }
  const template = value.template
  const warmupIds = template.warmup.map((item) => item.id)
  const cooldownIds = template.cooldown.map((item) => item.id)
  return value.exercises.length === template.exercises.length
    && value.exercises.every((exercise, index) => isObject(exercise)
      && exercise.exerciseId === template.exercises[index].id
      && typeof exercise.completed === 'boolean'
      && Array.isArray(exercise.sets)
      && exercise.sets.length > 0
      && exercise.sets.length <= 20
      && exercise.sets.every(isSetEntry))
    && value.warmupCompletedIds.every((id) => typeof id === 'string' && warmupIds.includes(id))
    && value.cooldownCompletedIds.every((id) => typeof id === 'string' && cooldownIds.includes(id))
    && new Set(value.warmupCompletedIds).size === value.warmupCompletedIds.length
    && new Set(value.cooldownCompletedIds).size === value.cooldownCompletedIds.length
}

type LegacyActiveWorkout = {
  id: string
  workoutId: WorkoutId
  startedAt: number
  exercises: ActiveExercise[]
}

type LegacyAppData = Omit<AppData, 'version' | 'currentWorkout'> & {
  version: 1
  currentWorkout: LegacyActiveWorkout | null
}

const legacyExerciseIds: Record<WorkoutId, string[]> = {
  push: ['dumbbell-bench-press', 'seated-shoulder-press', 'cable-fly', 'goblet-squat'],
  pull: ['lat-pulldown', 'chest-supported-row', 'face-pull', 'romanian-deadlift'],
  core: ['dead-bug', 'pallof-press', 'front-plank', 'seated-calf-raise'],
}

const legacyExerciseNames: Record<string, { name: string; focus: string; lowerBody?: boolean }> = {
  'dumbbell-bench-press': { name: 'Dumbbell Bench Press', focus: 'Chest' },
  'seated-shoulder-press': { name: 'Seated Shoulder Press', focus: 'Shoulders' },
  'cable-fly': { name: 'Cable Fly', focus: 'Chest' },
  'goblet-squat': { name: 'Goblet Squat', focus: 'Lower body', lowerBody: true },
  'lat-pulldown': { name: 'Lat Pulldown', focus: 'Back' },
  'chest-supported-row': { name: 'Chest-Supported Row', focus: 'Back' },
  'face-pull': { name: 'Face Pull', focus: 'Rear shoulders' },
  'romanian-deadlift': { name: 'Romanian Deadlift', focus: 'Lower body', lowerBody: true },
  'dead-bug': { name: 'Dead Bug', focus: 'Core' },
  'pallof-press': { name: 'Pallof Press', focus: 'Core' },
  'front-plank': { name: 'Front Plank', focus: 'Core' },
  'seated-calf-raise': { name: 'Seated Calf Raise', focus: 'Lower body', lowerBody: true },
}

function isLegacyActiveWorkout(value: unknown): value is LegacyActiveWorkout {
  if (!isObject(value) || typeof value.id !== 'string' || value.id.length === 0
    || !isWorkoutId(value.workoutId) || !isTimestamp(value.startedAt)
    || !Array.isArray(value.exercises)) {
    return false
  }
  const ids = legacyExerciseIds[value.workoutId]
  return value.exercises.length === ids.length
    && value.exercises.every((exercise, index) => isObject(exercise)
      && exercise.exerciseId === ids[index]
      && typeof exercise.completed === 'boolean'
      && Array.isArray(exercise.sets)
      && exercise.sets.length > 0
      && exercise.sets.length <= 20
      && exercise.sets.every(isSetEntry))
}

function isRecordedSet(value: unknown): value is RecordedSet {
  return isObject(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && value.id.length <= 128
    && (value.weightKg === null || (typeof value.weightKg === 'number' && Number.isFinite(value.weightKg) && value.weightKg >= 0 && value.weightKg <= 1000))
    && (value.reps === null || (typeof value.reps === 'number' && Number.isInteger(value.reps) && value.reps > 0 && value.reps <= 500))
    && typeof value.completed === 'boolean'
}

function isWorkoutRecord(value: unknown): value is WorkoutRecord {
  if (!isObject(value) || typeof value.id !== 'string' || !isWorkoutId(value.workoutId)
    || typeof value.workoutName !== 'string' || !isTimestamp(value.startedAt)
    || !isTimestamp(value.completedAt) || !Number.isFinite(value.durationSeconds)
    || value.id.length === 0 || value.id.length > 128
    || (value.durationSeconds as number) < 0
    || value.completedAt < value.startedAt
    || !Array.isArray(value.exercises) || value.exercises.length === 0 || value.exercises.length > 20) {
    return false
  }
  return value.exercises.every((exercise) => isObject(exercise)
    && typeof exercise.exerciseId === 'string'
    && exercise.exerciseId.length > 0
    && typeof exercise.name === 'string'
    && typeof exercise.instructions === 'string'
    && Number.isInteger(exercise.targetSets)
    && (exercise.targetSets as number) > 0
    && (exercise.targetSets as number) <= 20
    && typeof exercise.targetReps === 'string'
    && exercise.completed === true
    && Array.isArray(exercise.sets)
    && exercise.sets.length > 0
    && exercise.sets.length <= 20
    && exercise.sets.every(isRecordedSet))
}

export function isAppData(value: unknown): value is AppData {
  if (!isObject(value) || value.version !== DATA_VERSION
    || !Number.isInteger(value.rotationIndex)
    || (value.rotationIndex as number) < 0 || (value.rotationIndex as number) >= workouts.length
    || !(value.currentWorkout === null || isActiveWorkout(value.currentWorkout))
    || !Array.isArray(value.history) || !value.history.every(isWorkoutRecord)
    || !Number.isInteger(value.restDurationSeconds) || (value.restDurationSeconds as number) < MIN_REST_SECONDS || (value.restDurationSeconds as number) > MAX_REST_SECONDS
    || !Number.isInteger(value.timerRemainingSeconds)
    || (value.timerRemainingSeconds as number) < 0 || (value.timerRemainingSeconds as number) > MAX_REST_SECONDS
    || !(value.timerDeadline === null || isTimestamp(value.timerDeadline))
    || typeof value.timerRunning !== 'boolean'
    || typeof value.recoverySelected !== 'boolean'
     || (value.timerAutoStart !== undefined && typeof value.timerAutoStart !== 'boolean')
     || (value.timerCountdownWarnings !== undefined && typeof value.timerCountdownWarnings !== 'boolean')
     || (value.timerVibration !== undefined && typeof value.timerVibration !== 'boolean')
    || (value.extrasSessions !== undefined && (!Array.isArray(value.extrasSessions) || !value.extrasSessions.every(isExtraSessionRecord)))
    || (value.extrasFavourites !== undefined && (!Array.isArray(value.extrasFavourites) || !value.extrasFavourites.every((id) => typeof id === 'string' && Boolean(id))))) {
    return false
  }
  const ids = value.history.map((record) => (record as WorkoutRecord).id)
  const activeWorkout = value.currentWorkout as ActiveWorkout | null
  const extras = (value.extrasSessions as ExtraSessionRecord[] | undefined) ?? []
  const favourites = (value.extrasFavourites as string[] | undefined) ?? []
  return new Set(ids).size === ids.length
    && new Set(extras.map((session) => session.id)).size === extras.length
    && new Set(favourites).size === favourites.length
    && (!activeWorkout || activeWorkout.workoutId === workouts[value.rotationIndex as number].id)
    && (!activeWorkout || !ids.includes(activeWorkout.id))
    && ((value.timerRunning as boolean) === (value.timerDeadline !== null))
}

function isLegacyAppData(value: unknown): value is LegacyAppData {
  if (!isObject(value) || value.version !== 1
    || !Number.isInteger(value.rotationIndex)
    || (value.rotationIndex as number) < 0 || (value.rotationIndex as number) >= workouts.length
    || !(value.currentWorkout === null || isLegacyActiveWorkout(value.currentWorkout))
    || !Array.isArray(value.history) || !value.history.every(isWorkoutRecord)
    || !Number.isInteger(value.restDurationSeconds) || (value.restDurationSeconds as number) < MIN_REST_SECONDS || (value.restDurationSeconds as number) > MAX_REST_SECONDS
    || !Number.isInteger(value.timerRemainingSeconds)
    || (value.timerRemainingSeconds as number) < 0 || (value.timerRemainingSeconds as number) > MAX_REST_SECONDS
    || !(value.timerDeadline === null || isTimestamp(value.timerDeadline))
    || typeof value.timerRunning !== 'boolean'
    || typeof value.recoverySelected !== 'boolean'
     || (value.timerAutoStart !== undefined && typeof value.timerAutoStart !== 'boolean')
     || (value.timerCountdownWarnings !== undefined && typeof value.timerCountdownWarnings !== 'boolean')
     || (value.timerVibration !== undefined && typeof value.timerVibration !== 'boolean')
    || (value.extrasSessions !== undefined && (!Array.isArray(value.extrasSessions) || !value.extrasSessions.every(isExtraSessionRecord)))
    || (value.extrasFavourites !== undefined && (!Array.isArray(value.extrasFavourites) || !value.extrasFavourites.every((id) => typeof id === 'string' && Boolean(id))))) {
    return false
  }
  const ids = value.history.map((record) => (record as WorkoutRecord).id)
  const currentWorkout = value.currentWorkout as LegacyActiveWorkout | null
  return new Set(ids).size === ids.length
    && (!currentWorkout || currentWorkout.workoutId === workouts[value.rotationIndex as number].id)
    && (!currentWorkout || !ids.includes(currentWorkout.id))
    && ((value.timerRunning as boolean) === (value.timerDeadline !== null))
}

function migrateLegacyData(legacy: LegacyAppData): AppData {
  const active = legacy.currentWorkout
  const migratedWorkout: ActiveWorkout | null = active
    ? {
        ...active,
        template: {
          id: active.workoutId,
          name: active.workoutId === 'core' ? 'Core' : active.workoutId[0].toUpperCase() + active.workoutId.slice(1),
          focus: 'Previous routine · preserved session',
          description: 'This in-progress session was preserved from an earlier version.',
          duration: 'Previous session',
          warmup: [],
          cooldown: [],
          exercises: active.exercises.map((state) => {
            const details = legacyExerciseNames[state.exerciseId]
            return {
              id: state.exerciseId,
              name: details?.name ?? 'Previous exercise',
              focus: details?.focus ?? 'Previous routine',
              instructions: 'Preserved from your earlier session. Continue at a comfortable pace.',
              targetSets: state.sets.length,
              targetReps: 'As logged',
              ...(details?.lowerBody ? { isLowerBody: true } : {}),
            }
          }),
        },
        warmupCompletedIds: [],
        cooldownCompletedIds: [],
      }
    : null
  return {
    ...legacy,
    version: DATA_VERSION,
    currentWorkout: migratedWorkout,
    extrasSessions: legacy.extrasSessions ?? [],
    extrasFavourites: legacy.extrasFavourites ?? [],
    timerAutoStart: legacy.timerAutoStart ?? true,
    timerCountdownWarnings: legacy.timerCountdownWarnings ?? true,
    timerVibration: legacy.timerVibration ?? false,
  }
}

export function normalizeAppData(value: unknown): AppData | null {
  if (isAppData(value)) return { ...value, extrasSessions: value.extrasSessions ?? [], extrasFavourites: value.extrasFavourites ?? [], timerAutoStart: value.timerAutoStart ?? true, timerCountdownWarnings: value.timerCountdownWarnings ?? true, timerVibration: value.timerVibration ?? false }
  return isLegacyAppData(value) ? migrateLegacyData(value) : null
}

export async function readAppData(): Promise<{ data: AppData; error: string | null; usable: boolean }> {
  const result = await readPrimarySnapshot('workouts', STORAGE_KEY, isAppData, normalizeAppData, createInitialData())
  return { ...result, data: { ...result.data, extrasSessions: result.data.extrasSessions ?? [], extrasFavourites: result.data.extrasFavourites ?? [], timerAutoStart: result.data.timerAutoStart ?? true, timerCountdownWarnings: result.data.timerCountdownWarnings ?? true, timerVibration: result.data.timerVibration ?? false } }
}

export function writeAppData(data: AppData): Promise<void> {
  return writePrimarySnapshot('workouts', data, isAppData)
}

function parseWeight(value: string): number | null {
  if (value.trim() === '') return null
  const weight = Number(value)
  return Number.isFinite(weight) && weight >= 0 ? weight : null
}

function parseReps(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const reps = Number(value)
  return Number.isInteger(reps) && reps > 0 ? reps : null
}

export function createWorkoutRecord(active: ActiveWorkout, completedAt = Date.now()): WorkoutRecord {
  const workout = active.template
  return {
    id: active.id,
    workoutId: active.workoutId,
    workoutName: workout.name,
    startedAt: active.startedAt,
    completedAt,
    durationSeconds: Math.max(0, Math.floor((completedAt - active.startedAt) / 1000)),
    exercises: workout.exercises.map((exercise, index) => {
      const state = active.exercises[index]
      return {
        exerciseId: exercise.id,
        name: exercise.name,
        instructions: exercise.instructions,
        targetSets: exercise.targetSets,
        targetReps: exercise.targetReps,
        completed: state.completed,
        sets: state.sets.map((set) => ({
          id: set.id,
          weightKg: parseWeight(set.weightKg),
          reps: parseReps(set.reps),
          completed: set.completed,
        })),
      }
    }),
  }
}
