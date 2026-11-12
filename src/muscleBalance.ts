/**
 * Muscle Balance calculations (pure functions, no storage access).
 *
 * Model: every completed set with reps > 0 adds the exercise's mapped weight
 * (see muscleMap.ts) to each muscle it trains. "Weighted sets" is the only
 * unit compared across muscles. kg × reps is tracked per muscle but is never
 * compared between different muscles, because loads on different lifts are not
 * comparable.
 *
 * Results describe training exposure. They say nothing about muscle size,
 * strength, or whether a muscle is under-trained for your goals.
 */
import { workouts } from './workouts'
import type { WorkoutRecord } from './workoutStorage'
import { getCompletedSets, isStandardRepRange } from './strengthAnalytics'
import { getMuscleEntry, getMuscleLabel, muscles, type MuscleId } from './muscleMap'

export type MusclePeriod = '7d' | '30d' | '90d'

export const musclePeriodDays: Record<MusclePeriod, number> = { '7d': 7, '30d': 30, '90d': 90 }

export const musclePeriodLabels: Record<MusclePeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}

/** A muscle counts as "trained" on a day when that day adds at least this many weighted sets. */
export const TRAINED_DAY_THRESHOLD = 1
/** Minimum sessions in the selected period before insights are produced. */
export const MIN_SESSIONS_FOR_INSIGHTS = 3
const PAIR_RATIO = 2
const CHANGE_MIN_FRACTION = 0.25
const CHANGE_MIN_SETS = 2
const LOW_FRACTION_OF_MEAN = 0.5
const CONSISTENCY_WEEKS = 4
const CONSISTENCY_MIN_LOW_WEEKS = 3

export type DateRange = { start: number; end: number }

export type MuscleContribution = { exerciseId: string; name: string; weightedSets: number }

export type MuscleStat = {
  muscle: MuscleId
  label: string
  shortLabel: string
  weightedSets: number
  setsPerWeek: number
  /** Fraction of all weighted sets in the window (sums to 1 across muscles). */
  share: number
  /** weightedSets divided by the highest muscle in the window; drives the radar shape. */
  relative: number
  trainedDays: number
  /** Mapped kg × reps. Only comparable for the same muscle across periods. */
  volumeLoadKg: number
  contributions: MuscleContribution[]
}

export type Exposure = {
  muscles: MuscleStat[]
  workoutCount: number
  trainingDays: number
  totalWeightedSets: number
  countedSets: number
  /** Ticked sets with no reps entered. Not counted. */
  setsWithoutReps: number
  /** Sets from exercises deliberately left out of the radar. */
  designExcludedSets: number
  /** Sets from exercise IDs that have no entry in the mapping. */
  unmappedSets: number
  unmappedExerciseNames: string[]
}

export type InsightKind = 'pair' | 'gap' | 'change' | 'low' | 'info'

export type Insight = { id: string; kind: InsightKind; text: string }

export type MuscleBalanceResult = {
  period: MusclePeriod
  days: number
  current: Exposure
  previous: Exposure
  /** Fractional change vs the previous equal window; null when the previous window had none. */
  changeFraction: Record<MuscleId, number | null>
  lowMuscles: MuscleId[]
  lowConfidence: boolean
  insights: Insight[]
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function shiftDays(date: Date, days: number): Date {
  const result = startOfDay(date)
  result.setDate(result.getDate() + days)
  return result
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/**
 * Windows follow the Performance dashboard: local calendar days, with today
 * included. The previous window is the equal-length block immediately before.
 */
export function getRanges(period: MusclePeriod, now: Date): {
  days: number
  current: DateRange
  previous: DateRange
} {
  const days = musclePeriodDays[period]
  const currentStart = shiftDays(now, -(days - 1)).getTime()
  return {
    days,
    current: { start: currentStart, end: now.getTime() },
    previous: { start: shiftDays(now, -(2 * days - 1)).getTime(), end: currentStart - 1 },
  }
}

function recordsIn(history: WorkoutRecord[], range: DateRange): WorkoutRecord[] {
  return history.filter((record) => record.completedAt >= range.start && record.completedAt <= range.end)
}

function formatNumber(value: number): string {
  return Number(value.toFixed(1)).toString()
}

export function computeExposure(records: WorkoutRecord[], days: number): Exposure {
  const weighted = new Map<MuscleId, number>()
  const volume = new Map<MuscleId, number>()
  const daily = new Map<MuscleId, Map<string, number>>()
  const contributions = new Map<MuscleId, Map<string, MuscleContribution>>()
  const trainingDayKeys = new Set<string>()
  const unmappedNames = new Set<string>()
  let countedSets = 0
  let setsWithoutReps = 0
  let designExcludedSets = 0
  let unmappedSets = 0

  for (const record of records) {
    const dayKey = localDayKey(record.completedAt)
    trainingDayKeys.add(dayKey)
    for (const exercise of record.exercises) {
      const sets = getCompletedSets(exercise)
      setsWithoutReps += exercise.sets.filter((set) => set.completed).length - sets.length
      if (sets.length === 0) continue

      const entry = getMuscleEntry(exercise.exerciseId)
      if (!entry) {
        unmappedSets += sets.length
        unmappedNames.add(exercise.name)
        continue
      }
      if (entry.excluded) {
        designExcludedSets += sets.length
        continue
      }

      countedSets += sets.length
      const loadedVolume = isStandardRepRange(exercise.targetReps)
        ? sets.reduce((total, set) => (
          set.weightKg !== null && set.weightKg > 0 ? total + set.weightKg * set.reps : total
        ), 0)
        : 0

      for (const [muscle, weight] of Object.entries(entry.weights) as [MuscleId, number][]) {
        const added = weight * sets.length
        weighted.set(muscle, (weighted.get(muscle) ?? 0) + added)
        volume.set(muscle, (volume.get(muscle) ?? 0) + weight * loadedVolume)

        const byDay = daily.get(muscle) ?? new Map<string, number>()
        byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + added)
        daily.set(muscle, byDay)

        const byExercise = contributions.get(muscle) ?? new Map<string, MuscleContribution>()
        const existing = byExercise.get(exercise.exerciseId)
        byExercise.set(exercise.exerciseId, {
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          weightedSets: (existing?.weightedSets ?? 0) + added,
        })
        contributions.set(muscle, byExercise)
      }
    }
  }

  const total = [...weighted.values()].reduce((sum, value) => sum + value, 0)
  const highest = Math.max(0, ...weighted.values())
  const weeks = days / 7

  return {
    muscles: muscles.map(({ id, label, shortLabel }) => {
      const weightedSets = weighted.get(id) ?? 0
      return {
        muscle: id,
        label,
        shortLabel,
        weightedSets,
        setsPerWeek: weightedSets / weeks,
        share: total === 0 ? 0 : weightedSets / total,
        relative: highest === 0 ? 0 : weightedSets / highest,
        trainedDays: [...(daily.get(id)?.values() ?? [])]
          .filter((value) => value >= TRAINED_DAY_THRESHOLD).length,
        volumeLoadKg: volume.get(id) ?? 0,
        contributions: [...(contributions.get(id)?.values() ?? [])]
          .sort((a, b) => b.weightedSets - a.weightedSets)
          .slice(0, 3),
      }
    }),
    workoutCount: records.length,
    trainingDays: trainingDayKeys.size,
    totalWeightedSets: total,
    countedSets,
    setsWithoutReps,
    designExcludedSets,
    unmappedSets,
    unmappedExerciseNames: [...unmappedNames],
  }
}

/** True when at least one exercise in the current rotation is mapped to the muscle at weight 0.5 or more. */
export function rotationCoversMuscle(muscle: MuscleId): boolean {
  return workouts.some((workout) => workout.exercises.some((exercise) => {
    const entry = getMuscleEntry(exercise.id)
    return entry !== undefined && !entry.excluded && (entry.weights[muscle] ?? 0) >= 0.5
  }))
}

function joinLabels(ids: MuscleId[]): string {
  const labels = ids.map((id) => getMuscleLabel(id).toLowerCase())
  const text = labels.length <= 1
    ? labels.join('')
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function getLowMuscles(exposure: Exposure): MuscleId[] {
  const mean = exposure.totalWeightedSets / exposure.muscles.length
  if (mean === 0) return []
  return exposure.muscles
    .filter((stat) => stat.weightedSets > 0 && stat.weightedSets < mean * LOW_FRACTION_OF_MEAN)
    .map((stat) => stat.muscle)
}

function getConsistentlyLow(history: WorkoutRecord[], now: Date): { muscle: MuscleId; lowWeeks: number; trainedWeeks: number }[] {
  const lowCounts = new Map<MuscleId, number>()
  let trainedWeeks = 0
  for (let week = 0; week < CONSISTENCY_WEEKS; week += 1) {
    const range: DateRange = {
      start: shiftDays(now, -(7 * week + 6)).getTime(),
      end: week === 0 ? now.getTime() : shiftDays(now, -7 * week + 1).getTime() - 1,
    }
    const records = recordsIn(history, range)
    if (records.length === 0) continue
    trainedWeeks += 1
    for (const muscle of getLowMuscles(computeExposure(records, 7))) {
      lowCounts.set(muscle, (lowCounts.get(muscle) ?? 0) + 1)
    }
  }
  if (trainedWeeks < CONSISTENCY_MIN_LOW_WEEKS) return []
  return [...lowCounts]
    .filter(([, lowWeeks]) => lowWeeks >= CONSISTENCY_MIN_LOW_WEEKS)
    .map(([muscle, lowWeeks]) => ({ muscle, lowWeeks, trainedWeeks }))
}

const comparisonPairs: [MuscleId, MuscleId][] = [
  ['chest', 'back'],
  ['biceps', 'triceps'],
  ['quadriceps', 'hamstrings'],
]

function buildInsights(
  history: WorkoutRecord[],
  current: Exposure,
  previous: Exposure,
  days: number,
  now: Date,
): Insight[] {
  if (current.workoutCount === 0) return []
  if (current.workoutCount < MIN_SESSIONS_FOR_INSIGHTS) {
    return [{
      id: 'few-sessions',
      kind: 'info',
      text: `Only ${current.workoutCount} completed ${current.workoutCount === 1 ? 'workout' : 'workouts'} in this period. Insights need at least ${MIN_SESSIONS_FOR_INSIGHTS} sessions to say anything useful.`,
    }]
  }

  const insights: Insight[] = []
  const byMuscle = new Map(current.muscles.map((stat) => [stat.muscle, stat]))
  const previousByMuscle = new Map(previous.muscles.map((stat) => [stat.muscle, stat]))

  for (const [first, second] of comparisonPairs) {
    const a = byMuscle.get(first)
    const b = byMuscle.get(second)
    if (!a || !b || a.weightedSets === 0 || b.weightedSets === 0) continue
    const [high, low] = a.weightedSets >= b.weightedSets ? [a, b] : [b, a]
    const ratio = high.weightedSets / low.weightedSets
    if (ratio < PAIR_RATIO) continue
    insights.push({
      id: `pair-${first}-${second}`,
      kind: 'pair',
      text: `${high.label} received ${formatNumber(ratio)}× the training exposure of ${low.label.toLowerCase()} (${formatNumber(high.setsPerWeek)} vs ${formatNumber(low.setsPerWeek)} weighted sets per week).`,
    })
  }

  const zero = current.muscles.filter((stat) => stat.weightedSets === 0).map((stat) => stat.muscle)
  const uncovered = zero.filter((muscle) => !rotationCoversMuscle(muscle))
  const covered = zero.filter((muscle) => rotationCoversMuscle(muscle))
  if (uncovered.length > 0) {
    insights.push({
      id: 'gap-rotation',
      kind: 'gap',
      text: `${joinLabels(uncovered)}: no completed sets counted in this period, and no exercise in your current rotation is mapped ${uncovered.length === 1 ? 'to it' : 'to them'}. That is a gap in the programme, not a measure of strength.`,
    })
  }
  if (covered.length > 0) {
    insights.push({
      id: 'gap-covered',
      kind: 'gap',
      text: `${joinLabels(covered)}: no completed sets counted in this period, although your rotation includes ${covered.length === 1 ? 'an exercise' : 'exercises'} for ${covered.length === 1 ? 'it' : 'them'}.`,
    })
  }

  if (previous.workoutCount === 0) {
    insights.push({
      id: 'no-previous',
      kind: 'info',
      text: `There were no completed workouts in the previous ${days} days, so changes cannot be compared.`,
    })
  } else {
    const changes = current.muscles.flatMap((stat) => {
      const before = previousByMuscle.get(stat.muscle)?.weightedSets ?? 0
      const difference = stat.weightedSets - before
      if (before === 0) {
        return stat.weightedSets >= CHANGE_MIN_SETS
          ? [{ stat, before, fraction: Number.POSITIVE_INFINITY }]
          : []
      }
      const fraction = difference / before
      return Math.abs(fraction) >= CHANGE_MIN_FRACTION && Math.abs(difference) >= CHANGE_MIN_SETS
        ? [{ stat, before, fraction }]
        : []
    }).sort((a, b) => Math.abs(b.fraction) - Math.abs(a.fraction)).slice(0, 3)

    for (const { stat, before, fraction } of changes) {
      insights.push({
        id: `change-${stat.muscle}`,
        kind: 'change',
        text: before === 0
          ? `${stat.label} had no counted sets in the previous ${days} days and ${formatNumber(stat.weightedSets)} weighted sets in this period.`
          : `${stat.label} exposure is ${fraction > 0 ? 'up' : 'down'} ${Math.round(Math.abs(fraction) * 100)}% compared with the previous ${days} days (${formatNumber(before)} → ${formatNumber(stat.weightedSets)} weighted sets).`,
      })
    }
  }

  for (const { muscle, lowWeeks, trainedWeeks } of getConsistentlyLow(history, now)) {
    if (zero.includes(muscle)) continue
    insights.push({
      id: `low-${muscle}`,
      kind: 'low',
      text: `${getMuscleLabel(muscle)} exposure was below half the average across muscle groups in ${lowWeeks} of the last ${trainedWeeks} training weeks.`,
    })
  }

  return insights
}

export function analyzeMuscleBalance(
  history: WorkoutRecord[],
  period: MusclePeriod,
  now: Date,
): MuscleBalanceResult {
  const { days, current: currentRange, previous: previousRange } = getRanges(period, now)
  const current = computeExposure(recordsIn(history, currentRange), days)
  const previous = computeExposure(recordsIn(history, previousRange), days)

  const changeFraction = {} as Record<MuscleId, number | null>
  for (const stat of current.muscles) {
    const before = previous.muscles.find((item) => item.muscle === stat.muscle)?.weightedSets ?? 0
    changeFraction[stat.muscle] = before > 0 ? (stat.weightedSets - before) / before : null
  }

  return {
    period,
    days,
    current,
    previous,
    changeFraction,
    lowMuscles: getLowMuscles(current),
    lowConfidence: current.workoutCount > 0 && current.workoutCount < MIN_SESSIONS_FOR_INSIGHTS,
    insights: buildInsights(history, current, previous, days, now),
  }
}
