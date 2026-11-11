import { workouts } from './workouts'
import type { ActiveExercise, RecordedExercise, RecordedSet, WorkoutRecord } from './workoutStorage'

export type StrengthSet = {
  id: string
  weightKg: number | null
  reps: number
}

export type ExercisePerformance = {
  record: WorkoutRecord
  exercise: RecordedExercise
  sets: StrengthSet[]
  estimatedOneRepMaxKg: number | null
  volumeKg: number | null
  topWeightKg: number | null
}

export type PersonalRecord = {
  recordId: string
  exerciseId: string
  exerciseName: string
  workoutName: string
  completedAt: number
  estimatedOneRepMaxKg: number
  firstBenchmark: boolean
}

function isStandardRepRange(targetReps: string): boolean {
  return /^\d+\s*[-–]\s*\d+$/.test(targetReps)
}

function getCompletedSets(exercise: RecordedExercise): StrengthSet[] {
  return exercise.sets.flatMap((set: RecordedSet) => (
    set.completed
      && set.reps !== null
      && set.reps > 0
      ? [{ id: set.id, weightKg: set.weightKg, reps: set.reps }]
      : []
  ))
}

function estimateOneRepMaxKg(sets: StrengthSet[], targetReps: string): number | null {
  if (!isStandardRepRange(targetReps)) return null
  const estimates = sets
    .filter((set): set is StrengthSet & { weightKg: number } => (
      set.weightKg !== null && set.weightKg > 0 && set.reps <= 12
    ))
    .map((set) => set.reps === 1 ? set.weightKg : set.weightKg * (1 + set.reps / 30))
  return estimates.length > 0 ? Math.max(...estimates) : null
}

export function getExercisePerformances(
  history: WorkoutRecord[],
  exerciseId: string,
): ExercisePerformance[] {
  return history
    .flatMap((record) => {
      const exercise = record.exercises.find((item) => item.exerciseId === exerciseId)
      if (!exercise) return []
      const sets = getCompletedSets(exercise)
      const standardRepRange = isStandardRepRange(exercise.targetReps)
      const loadedSets = sets.filter((set) => set.weightKg !== null && set.weightKg > 0)
      return [{
        record,
        exercise,
        sets,
        estimatedOneRepMaxKg: estimateOneRepMaxKg(sets, exercise.targetReps),
        volumeKg: standardRepRange && loadedSets.length > 0
          ? loadedSets.reduce((total, set) => total + (set.weightKg ?? 0) * set.reps, 0)
          : null,
        topWeightKg: sets.some((set) => set.weightKg !== null && set.weightKg > 0)
          ? Math.max(...sets.flatMap((set) => set.weightKg === null ? [] : [set.weightKg]))
          : null,
      }]
    })
    .sort((a, b) => a.record.completedAt - b.record.completedAt)
}

export function getProgressionRecommendation(
  performance: ExercisePerformance | null,
): string | null {
  if (!performance || !isStandardRepRange(performance.exercise.targetReps)) return null
  const match = performance.exercise.targetReps.match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/)
  if (!match) return null

  const lowerReps = Number(match[1])
  const upperReps = Number(match[2])
  const workingSets = performance.sets.filter((set): set is StrengthSet & { weightKg: number } => (
    set.weightKg !== null && set.weightKg > 0
  ))
  if (workingSets.length === 0) return null

  const setTarget = performance.exercise.targetSets
  if (workingSets.length < setTarget) {
    return `Only ${workingSets.length} of ${setTarget} target sets have completed logged weight and reps. Log the remaining sets before using a load progression suggestion.`
  }
  const averageWeightKg = workingSets.reduce((total, set) => total + set.weightKg, 0) / workingSets.length
  if (workingSets.length >= setTarget && workingSets.every((set) => set.reps >= upperReps)) {
    const incrementKg = Math.max(0.5, averageWeightKg * 0.025)
    const nextWeightKg = Math.ceil((averageWeightKg + incrementKg) * 2) / 2
    return `All ${workingSets.length} completed sets reached ${upperReps} reps. Consider a small increase to about ${formatKg(nextWeightKg)} kg next time, then build within the rep range.`
  }

  if (workingSets.every((set) => set.reps >= lowerReps && set.reps <= upperReps)) {
    return `Stay near ${formatKg(averageWeightKg)} kg and aim to add a rep to one or more sets before increasing the load.`
  }

  return `Keep the load comfortable and work toward ${lowerReps}–${upperReps} reps across your working sets before considering an increase.`
}

export function getLiveEstimatedOneRepMax(
  exercise: Pick<RecordedExercise, 'targetReps'>,
  activeExercise: ActiveExercise,
): number | null {
  if (!isStandardRepRange(exercise.targetReps)) return null
  const sets = activeExercise.sets.flatMap((set) => {
    const weightKg = Number(set.weightKg)
    const reps = Number(set.reps)
    return set.completed
      && set.weightKg !== ''
      && set.reps !== ''
      && Number.isFinite(weightKg)
      && weightKg > 0
      && Number.isInteger(reps)
      && reps > 0
      && reps <= 12
      ? [{ id: set.id, weightKg, reps }]
      : []
  })
  return estimateOneRepMaxKg(sets, exercise.targetReps)
}

export function getHistoricalBestOneRepMax(
  performances: ExercisePerformance[],
): number | null {
  const estimates = performances.flatMap((performance) => (
    performance.estimatedOneRepMaxKg === null ? [] : [performance.estimatedOneRepMaxKg]
  ))
  return estimates.length > 0 ? Math.max(...estimates) : null
}

export function getPersonalRecords(history: WorkoutRecord[]): PersonalRecord[] {
  const exerciseIds = new Set(history.flatMap((record) => record.exercises.map((exercise) => exercise.exerciseId)))
  const records: PersonalRecord[] = []

  for (const exerciseId of exerciseIds) {
    let bestSoFar: number | null = null
    for (const performance of getExercisePerformances(history, exerciseId)) {
      const estimate = performance.estimatedOneRepMaxKg
      if (estimate === null || (bestSoFar !== null && estimate <= bestSoFar)) continue
      records.push({
        recordId: performance.record.id,
        exerciseId,
        exerciseName: performance.exercise.name,
        workoutName: performance.record.workoutName,
        completedAt: performance.record.completedAt,
        estimatedOneRepMaxKg: estimate,
        firstBenchmark: bestSoFar === null,
      })
      bestSoFar = estimate
    }
  }

  return records.sort((a, b) => b.completedAt - a.completedAt)
}

export function getStalledExercises(history: WorkoutRecord[]): {
  exerciseId: string
  exerciseName: string
  sessions: ExercisePerformance[]
}[] {
  const exerciseIds = new Set(history.flatMap((record) => record.exercises.map((exercise) => exercise.exerciseId)))
  const stalled = []
  for (const exerciseId of exerciseIds) {
    const usable = getExercisePerformances(history, exerciseId)
      .filter((performance) => performance.estimatedOneRepMaxKg !== null)
    const recent = usable.slice(-3)
    if (recent.length < 3) continue
    const start = recent[0].estimatedOneRepMaxKg
    const latest = recent[2].estimatedOneRepMaxKg
    if (start === null || latest === null || latest > start * 1.01) continue
    stalled.push({
      exerciseId,
      exerciseName: recent[2].exercise.name,
      sessions: recent,
    })
  }
  return stalled
}

export function getExerciseOptions(history: WorkoutRecord[]): { id: string; name: string }[] {
  const options = new Map<string, string>()
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      options.set(exercise.id, exercise.name)
    }
  }
  for (const record of history) {
    for (const exercise of record.exercises) {
      options.set(exercise.exerciseId, exercise.name)
    }
  }
  return [...options].map(([id, name]) => ({ id, name }))
}

export function formatKg(value: number): string {
  return Number(value.toFixed(1)).toString()
}

export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(timestamp))
}
