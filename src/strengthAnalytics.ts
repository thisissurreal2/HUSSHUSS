import { workouts } from './workouts'
import type { ActiveExercise, RecordedExercise, RecordedSet, WorkoutRecord } from './workoutStorage'

export type StrengthSet = {
  id: string
  weightKg: number | null
  reps: number
  leftReps?: number | null
  rightReps?: number | null
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

export type ExerciseProgressionStatus = 'Progressing' | 'Maintaining' | 'Needs attention' | 'New exercise'
export type ExerciseMetricType = 'reps' | 'assisted' | 'timed' | 'distance' | 'per-side' | 'per-side-time'

export type ProgressionPlan = {
  status: ExerciseProgressionStatus
  metricType: ExerciseMetricType
  targetText: string
  reason: string
  sourceRecord: WorkoutRecord | null
  targetSets: number
  reducedReadiness: boolean
  targetMinimum: number | null
  targetMaximum: number | null
  unit: string
}

function repRange(target: string): { low: number; high: number; unit: string } | null {
  const perSide = target.match(/^\s*(\d+(?:\.\d+)?)\s*([-–]\s*\d+(?:\.\d+)?)?\s*(seconds?|secs?|sec|s)?\s*per\s+(side|leg)\s*$/i)
  if (perSide) {
    const high = perSide[2] ? Number(perSide[2].replace(/[-–]/, '').trim()) : Number(perSide[1])
    return { low: Number(perSide[1]), high, unit: `${perSide[3] ? 'sec' : 'reps'}/${perSide[4].toLowerCase()}` }
  }
  const match = target.match(/^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|meters?|metres?|m|kilomet(?:er|re)s?|km)?\s*$/i)
  if (!match) return null
  const rawUnit = match[3]?.toLowerCase() ?? ''
  const unit = /kilomet|km/.test(rawUnit) ? 'km' : /meter|metre|^m$/.test(rawUnit) ? 'm' : /sec|^s$/.test(rawUnit) ? 'sec' : 'reps'
  return { low: Number(match[1]), high: Number(match[2]), unit }
}

export function getExerciseMetricType(exerciseId: string, name: string, targetReps: string): ExerciseMetricType {
  if (/assisted/i.test(`${exerciseId} ${name}`)) return 'assisted'
  if (/per\s+(side|leg)/i.test(targetReps)) return /seconds?|secs?|\bsec\b|\bs\b/i.test(targetReps) ? 'per-side-time' : 'per-side'
  if (/seconds?|secs?|\bsec\b|\bs\b/i.test(targetReps)) return 'timed'
  if (/meters?|metres?|\bm\b|\bkm\b|\bdistance\b/i.test(targetReps)) return 'distance'
  return 'reps'
}

function comparablePerformances(history: WorkoutRecord[], exerciseId: string, targetSets: number, targetReps: string): ExercisePerformance[] {
  return getExercisePerformances(history, exerciseId).filter((performance) => (
    !performance.record.readinessAdjusted
    && performance.exercise.completed
    && performance.exercise.targetSets === targetSets
    && performance.exercise.targetReps === targetReps
    && performance.sets.length === targetSets
  ))
}

function performanceValue(performance: ExercisePerformance, type: ExerciseMetricType): number | null {
  if (type === 'reps' && performance.estimatedOneRepMaxKg !== null) return performance.estimatedOneRepMaxKg
  const values = performance.sets.map((set) => set.reps)
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function getProgressionStatus(performances: ExercisePerformance[], type: ExerciseMetricType): ExerciseProgressionStatus {
  if (performances.length === 0) return 'New exercise'
  if (performances.length < 3) return 'Maintaining'
  const recent = performances.slice(-3)
  const [first, middle, latest] = recent.map((performance) => performanceValue(performance, type))
  if (first === null || middle === null || latest === null) return 'Maintaining'
  if (latest > first * 1.02) return 'Progressing'
  const lowRepTarget = repRange(recent[2].exercise.targetReps)?.low
  if (lowRepTarget !== undefined) {
    const failedSets = recent.slice(1).map((performance) => (
      performance.sets.filter((set) => set.reps < lowRepTarget).length / Math.max(1, performance.exercise.targetSets)
    ))
    const earlierPassed = recent[0].sets.filter((set) => set.reps >= lowRepTarget).length >= Math.ceil(recent[0].exercise.targetSets / 2)
    if (earlierPassed && failedSets.every((ratio) => ratio >= 0.5)) return 'Needs attention'
  }
  return 'Maintaining'
}

function observedLoadIncrement(performances: ExercisePerformance[]): number | null {
  const loads = [...new Set(performances.flatMap((performance) => performance.sets
    .flatMap((set) => set.weightKg !== null && set.weightKg > 0 ? [set.weightKg] : [])))].sort((a, b) => a - b)
  const increments = loads.slice(1).map((load, index) => load - loads[index]).filter((step) => step > 0)
  return increments.length ? increments[0] : null
}

export function getProgressionPlan(
  history: WorkoutRecord[],
  exercise: Pick<RecordedExercise, 'exerciseId' | 'name' | 'targetSets' | 'targetReps'>,
  todaySetCount = exercise.targetSets,
  readinessAdjusted = false,
): ProgressionPlan {
  const metricType = getExerciseMetricType(exercise.exerciseId, exercise.name, exercise.targetReps)
  const performances = comparablePerformances(history, exercise.exerciseId, exercise.targetSets, exercise.targetReps)
  const baseline = performances.at(-1) ?? null
  const status = getProgressionStatus(performances, metricType)
  const parsedRange = repRange(exercise.targetReps)
  const targetMinimum = parsedRange?.low ?? null
  const targetMaximum = parsedRange?.high ?? null
  const unit = metricType === 'timed' ? 'sec' : metricType === 'per-side-time' ? 'sec/side' : metricType === 'per-side' ? 'reps/side' : metricType === 'distance' ? (parsedRange?.unit ?? 'm') : 'reps'
  const reducedNote = readinessAdjusted
    ? ` Today’s readiness adjustment sets ${todaySetCount} working sets; it does not lower your normal progression target of ${exercise.targetSets}.`
    : ''
  if (!baseline) {
    return {
      status, metricType, targetText: `First exposure · ${exercise.targetSets} sets × ${exercise.targetReps}`,
      reason: `No comparable completed session yet. Start with a comfortable effort and use the prescribed range.${reducedNote}`,
      sourceRecord: null, targetSets: exercise.targetSets, reducedReadiness: readinessAdjusted,
      targetMinimum, targetMaximum, unit,
    }
  }

  const range = parsedRange
  const setCountMatches = baseline.sets.length === exercise.targetSets
  const allAtTop = range !== null && setCountMatches && baseline.sets.every((set) => set.reps >= range.high)
  const increment = observedLoadIncrement(performances)
  const loadIsKnown = baseline.sets.every((set) => set.weightKg !== null && set.weightKg > 0)
  let targetText = `${exercise.targetSets} sets × ${exercise.targetReps}`
  let reason: string

  if (metricType === 'assisted') {
    const assistance = baseline.sets.find((set) => set.weightKg !== null)?.weightKg
    if (allAtTop && assistance !== null && assistance !== undefined && increment !== null) {
      targetText = `${exercise.targetSets} sets · reduce assistance toward ${formatKg(Math.max(0, assistance - increment))} kg · ${range.low} reps`
      reason = `All prescribed sets reached the top of the range. Historical loads show a ${formatKg(increment)} kg step; reduce assistance by one familiar step.`
    } else if (allAtTop) {
      targetText = `${exercise.targetSets} sets × ${range.low}–${range.high} reps`
      reason = 'All prescribed sets reached the top. If your assistance machine allows it, reduce assistance by its smallest available step; no step is assumed.'
    } else {
      reason = 'Keep assistance steady and build reps within the range before reducing assistance.'
    }
  } else if (range && allAtTop && metricType !== 'timed' && metricType !== 'distance') {
    if (loadIsKnown && increment !== null) {
      const nextLoad = Math.max(...baseline.sets.flatMap((set) => set.weightKg === null ? [] : [set.weightKg])) + increment
      targetText = `${exercise.targetSets} sets × ${formatKg(nextLoad)} kg · ${range.low}–${range.high} ${range.unit}`
      reason = `All ${exercise.targetSets} prescribed sets reached ${range.high}. The smallest load step observed in your history is ${formatKg(increment)} kg; begin the range again at that load.`
    } else if (metricType === 'reps') {
      targetText = `${exercise.targetSets} sets × ${range.low}–${range.high} reps`
      reason = loadIsKnown
        ? 'All prescribed sets reached the top of the range. Consider the smallest increase available at your gym; the equipment increment is unknown, so no load is invented.'
        : 'All prescribed sets reached the top using bodyweight or unlogged resistance. Add external load only if appropriate and available; no load is invented.'
    } else {
      reason = `All prescribed sets reached ${range.high}. Repeat the top target or choose a small available increase; no equipment increment is assumed.`
    }
  } else if (range && (metricType === 'timed' || metricType === 'distance')) {
    const averageQuantity = baseline.sets.reduce((sum, set) => sum + set.reps, 0) / baseline.sets.length
    const unit = metricType === 'timed' ? 'sec' : range.unit
    const nextQuantity = Math.min(range.high, Math.max(range.low, Math.floor(averageQuantity + (metricType === 'timed' ? 5 : 1))))
    if (metricType === 'timed' && /farmer[- ]carries/i.test(`${exercise.exerciseId} ${exercise.name}`) && allAtTop) {
      const load = baseline.sets.flatMap((set) => set.weightKg === null ? [] : [set.weightKg])
      if (load.length && increment !== null) {
        const nextLoad = Math.max(...load) + increment
        targetText = `${exercise.targetSets} sets × ${formatKg(nextLoad)} kg · ${range.low}–${range.high} sec`
        reason = `Every carry reached the time cap. Your history shows a ${formatKg(increment)} kg step; start the time range again at that load.`
      } else {
        targetText = `${exercise.targetSets} sets × ${range.high} sec`
        reason = 'Every carry reached the time cap. Add load only by the smallest available step at your gym; no equipment increment is assumed.'
      }
    } else {
      targetText = `${exercise.targetSets} sets × ${nextQuantity}${unit}`
      reason = allAtTop
        ? `All sets reached the ${range.high}${unit} cap. Maintain this target before making the movement harder; do not extend duration or distance indefinitely.`
        : `Build the average completed ${unit} amount gradually within ${range.low}–${range.high}${unit}.`
    }
  } else if (range && (metricType === 'per-side' || metricType === 'per-side-time')) {
    targetText = `${exercise.targetSets} sets × ${exercise.targetReps}`
    reason = metricType === 'per-side-time'
      ? 'Log each side separately and use the weaker side as the conservative progression reference. Hold the prescription before extending the time.'
      : 'Log each side separately and use the weaker side as the conservative progression reference before adding resistance.'
  } else if (range) {
    const setTargets = baseline.sets.slice(0, exercise.targetSets).map((set) => Math.min(range.high, Math.max(range.low, set.reps + (set.reps < range.high ? 1 : 0))))
    const setDescriptions = setTargets.map((reps, index) => {
      const weight = baseline.sets[index]?.weightKg
      const resistance = weight === null || weight === undefined
        ? 'bodyweight / resistance not logged'
        : `${formatKg(weight)} kg`
      return `${resistance} × ${reps} ${range.unit}`
    })
    targetText = `${exercise.targetSets} sets · ${setDescriptions.join(' / ')}`
    reason = setCountMatches
      ? `Last session logged ${baseline.sets.map((set) => set.reps).join(', ')} reps. Aim to add a rep to each set that is below ${range.high}, keeping the same resistance.`
      : `Last session logged ${baseline.sets.length} of ${exercise.targetSets} prescribed sets. Complete the prescribed sets before considering a load increase.`
  } else {
    reason = 'Repeat the current prescription with controlled technique. This exercise uses a fixed or side-specific target rather than double progression.'
  }

  if (status === 'Needs attention') reason += ' Recent comparable sessions have repeatedly fallen below the minimum rep target; consider recovery, technique, or a comfortable load.'
  reason += reducedNote
  return { status, metricType, targetText, reason, sourceRecord: baseline.record, targetSets: exercise.targetSets, reducedReadiness: readinessAdjusted, targetMinimum, targetMaximum, unit }
}

export function getExerciseCompletionFeedback(
  plan: ProgressionPlan,
  sets: ActiveExercise['sets'],
  exerciseCompleted: boolean,
): string | null {
  if (!exerciseCompleted) return null
  if (plan.reducedReadiness) return 'Reduced-readiness session recorded. It does not lower your normal progression target or count as a missed progression.'
  if (plan.targetMinimum === null) return 'Exercise marked complete. This fixed or side-specific target does not use automatic rep progression.'
  const workingSets = sets.slice(0, plan.targetSets)
  if (workingSets.length < plan.targetSets || workingSets.some((set) => !set.completed || !/^\d+$/.test(set.reps))) {
    return 'Some prescribed working sets are unlogged or incomplete. One session does not change your longer-term progression status.'
  }
  const values = workingSets.map((set) => Number(set.reps))
  if (plan.metricType === 'per-side-time' && values.every((value) => value >= plan.targetMinimum!)) {
    return 'Both sides reached the prescribed hold time. Keep recording left and right separately; the weaker side remains the progression reference.'
  }
  if (plan.metricType === 'per-side' && values.every((value) => value >= plan.targetMinimum!)) {
    return 'Both sides reached the prescribed reps. Keep them balanced before increasing resistance.'
  }
  if (plan.targetMaximum !== null && values.every((value) => value >= plan.targetMaximum!)) {
    return 'All prescribed sets reached the top of the target. Next session, consider the smallest familiar resistance increase; if none is known, choose an available step yourself.'
  }
  if (values.every((value) => value >= plan.targetMinimum!)) {
    return `Target minimum reached across all sets. Keep building toward ${plan.targetMaximum ?? plan.targetMinimum} ${plan.unit} before increasing resistance.`
  }
  return 'The target was not reached across all sets today. Repeat a comfortable load next time; this single session does not lower your progression status.'
}

export function isStandardRepRange(targetReps: string): boolean {
  return /^\d+\s*[-–]\s*\d+$/.test(targetReps)
}

export function getCompletedSets(exercise: RecordedExercise): StrengthSet[] {
  return exercise.sets.flatMap((set: RecordedSet) => (
    set.completed
      && set.reps !== null
      && set.reps > 0
      ? [{ id: set.id, weightKg: set.weightKg, reps: set.reps, ...(set.leftReps !== undefined ? { leftReps: set.leftReps } : {}), ...(set.rightReps !== undefined ? { rightReps: set.rightReps } : {}) }]
      : []
  ))
}

function estimateOneRepMaxKg(sets: StrengthSet[], targetReps: string, exerciseId = '', name = ''): number | null {
  if (!isStandardRepRange(targetReps) || getExerciseMetricType(exerciseId, name, targetReps) !== 'reps') return null
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
  const historyOrder = new Map(history.map((record, index) => [record.id, index]))
  return history
    .flatMap((record) => {
      const exercise = record.exercises.find((item) => item.exerciseId === exerciseId)
      if (!exercise) return []
      const sets = getCompletedSets(exercise)
      const standardRepRange = isStandardRepRange(exercise.targetReps)
      const metricType = getExerciseMetricType(exercise.exerciseId, exercise.name, exercise.targetReps)
      const loadedSets = metricType === 'assisted' ? [] : sets.filter((set) => set.weightKg !== null && set.weightKg > 0)
      return [{
        record,
        exercise,
        sets,
        estimatedOneRepMaxKg: estimateOneRepMaxKg(sets, exercise.targetReps, exercise.exerciseId, exercise.name),
        volumeKg: standardRepRange && loadedSets.length > 0
          ? loadedSets.reduce((total, set) => total + (set.weightKg ?? 0) * set.reps, 0)
          : null,
        topWeightKg: metricType !== 'assisted' && sets.some((set) => set.weightKg !== null && set.weightKg > 0)
          ? Math.max(...sets.flatMap((set) => set.weightKg === null ? [] : [set.weightKg]))
          : null,
      }]
    })
    .sort((a, b) => a.record.completedAt - b.record.completedAt
      || (historyOrder.get(b.record.id) ?? 0) - (historyOrder.get(a.record.id) ?? 0))
}

export function getLiveEstimatedOneRepMax(
  exercise: Pick<RecordedExercise, 'exerciseId' | 'name' | 'targetReps'>,
  activeExercise: ActiveExercise,
): number | null {
  if (!isStandardRepRange(exercise.targetReps) || getExerciseMetricType(exercise.exerciseId, exercise.name, exercise.targetReps) !== 'reps') return null
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
    const complete = getExercisePerformances(history, exerciseId)
      .filter((performance) => !performance.record.readinessAdjusted
        && performance.exercise.completed
        && performance.sets.length === performance.exercise.targetSets
        && performance.estimatedOneRepMaxKg !== null)
    const latestComparable = complete.at(-1)
    if (!latestComparable) continue
    const usable = complete.filter((performance) => performance.exercise.targetSets === latestComparable.exercise.targetSets
      && performance.exercise.targetReps === latestComparable.exercise.targetReps)
    const recent = usable.slice(-3)
    if (recent.length < 3) continue
    const range = repRange(recent[2].exercise.targetReps)
    if (range && recent.some((performance) => performance.sets.some((set) => set.reps < range.low || set.reps > range.high))) continue
    const start = recent[0].estimatedOneRepMaxKg
    const middle = recent[1].estimatedOneRepMaxKg
    const latest = recent[2].estimatedOneRepMaxKg
    if (start === null || middle === null || latest === null || latest > start * 1.01
      || latest < middle * 0.95 || middle < start * 0.95) continue
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
