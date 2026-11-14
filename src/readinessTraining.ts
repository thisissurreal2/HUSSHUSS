import type { Workout, Exercise } from './workouts'
import { getReadinessCategory, getReadinessFactors, type ReadinessCheckIn, type ReadinessCategory } from './readiness'
import type { WorkoutRecord } from './workoutStorage'

export type ReadinessRecommendation = {
  category: ReadinessCategory | 'missing'
  label: 'Train as planned' | 'Scale back' | 'Recovery recommended' | 'No check-in today'
  explanation: string
  factors: string[]
}

export function getTrainingRecommendation(checkIn?: ReadinessCheckIn): ReadinessRecommendation {
  if (!checkIn) return {
    category: 'missing', label: 'No check-in today',
    explanation: 'Use your own judgement. You can train as planned or check in first; a check-in is never required.', factors: [],
  }
  const category = getReadinessCategory(checkIn.score)
  const factors = getReadinessFactors(checkIn)
  const negative = factors.filter((factor) => factor.contribution < 0).sort((a, b) => a.contribution - b.contribution)
  const positive = factors.filter((factor) => factor.contribution > 0).sort((a, b) => b.contribution - a.contribution)
  const factorsText = [
    ...negative.slice(0, 2).map((factor) => `${factor.label} reduced the score`),
    ...positive.slice(0, 1).map((factor) => `${factor.label} supported the score`),
  ]
  return {
    category,
    label: category === 'ready' ? 'Train as planned' : category === 'caution' ? 'Scale back' : 'Recovery recommended',
    explanation: category === 'ready'
      ? 'Your check-in is in the ready range. Follow the planned session and adjust if your body tells you otherwise.'
      : category === 'caution'
        ? 'Your score is in the caution range. A lighter session can preserve the main lifts while trimming optional work.'
        : 'Your score is below 60. Consider rest or gentle movement; the workout rotation will wait for you.',
    factors: factorsText.length ? factorsText : ['No factor differs from the neutral midpoint.'],
  }
}

function isCompound(exercise: Exercise): boolean {
  return /(bench|press|row|squat|deadlift|hinge|pulldown|pull-up|chin-up)/i.test(`${exercise.name} ${exercise.id}`)
}

export function createScaledWorkout(workout: Workout, reduction = 0.25): Workout {
  if (!Number.isFinite(reduction) || reduction < 0.2 || reduction > 0.3) throw new Error('Training volume reduction must be between 20% and 30%.')
  const exercises = workout.exercises.map((exercise) => ({ ...exercise }))
  const totalSets = exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0)
  let setsToRemove = Math.min(totalSets - exercises.length, Math.round(totalSets * reduction))
  const accessoryFirst = exercises.map((exercise, index) => ({ exercise, index }))
    .sort((a, b) => Number(isCompound(a.exercise)) - Number(isCompound(b.exercise)) || b.index - a.index)
  for (const { index } of accessoryFirst) {
    while (setsToRemove > 0 && exercises[index].targetSets > 1) {
      exercises[index] = { ...exercises[index], targetSets: exercises[index].targetSets - 1 }
      setsToRemove -= 1
    }
  }
  return { ...workout, exercises }
}

export function chooseWorkoutPlan(workout: Workout, acceptScaleBack: boolean): Workout {
  return acceptScaleBack ? createScaledWorkout(workout) : workout
}

function localDateFromTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export type ReadinessInsight = { id: string; text: string }

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function pearson(left: number[], right: number[]): number | null {
  if (left.length < 2 || left.length !== right.length) return null
  const avgLeft = average(left)!
  const avgRight = average(right)!
  const numerator = left.reduce((sum, value, index) => sum + (value - avgLeft) * (right[index] - avgRight), 0)
  const leftVariance = left.reduce((sum, value) => sum + (value - avgLeft) ** 2, 0)
  const rightVariance = right.reduce((sum, value) => sum + (value - avgRight) ** 2, 0)
  return leftVariance && rightVariance ? numerator / Math.sqrt(leftVariance * rightVariance) : null
}

export function getReadinessInsights(history: ReadinessCheckIn[], workouts: WorkoutRecord[], today: string): ReadinessInsight[] {
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 29)
  const from = start.toISOString().slice(0, 10)
  const recent = history.filter((entry) => entry.date >= from && entry.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  const insights: ReadinessInsight[] = []
  if (recent.length >= 5) {
    const sleepAverage = average(recent.map((entry) => entry.sleep))!
    if (sleepAverage <= 2.5) insights.push({ id: 'sleep', text: `Sleep ratings averaged ${sleepAverage.toFixed(1)}/5 across ${recent.length} recent check-ins, which lowered your readiness scores.` })
    const sorenessAverage = average(recent.map((entry) => entry.soreness))!
    if (sorenessAverage >= 3.5) insights.push({ id: 'soreness', text: `Soreness averaged ${sorenessAverage.toFixed(1)}/5 across ${recent.length} recent check-ins.` })
    if (recent.length >= 8) {
      const earlierSoreness = average(recent.slice(0, 4).map((entry) => entry.soreness))!
      const latestSoreness = average(recent.slice(-4).map((entry) => entry.soreness))!
      if (latestSoreness - earlierSoreness >= 0.5) insights.push({ id: 'soreness-rising', text: `Recent soreness ratings are trending upward (${earlierSoreness.toFixed(1)} to ${latestSoreness.toFixed(1)}/5 across the first and latest four logged days).` })
    }
  }
  const latestSeven = recent.slice(-7)
  const priorSeven = recent.slice(-14, -7)
  if (latestSeven.length >= 4 && priorSeven.length >= 4) {
    const change = average(latestSeven.map((entry) => entry.score))! - average(priorSeven.map((entry) => entry.score))!
    if (Math.abs(change) >= 5) insights.push({ id: 'trend', text: `Average readiness is ${change > 0 ? 'up' : 'down'} ${Math.round(Math.abs(change))} points compared with the previous logged period.` })
  }

  const workoutsByDate = new Map<string, number>()
  for (const record of workouts) {
    const date = localDateFromTimestamp(record.completedAt)
    const sets = record.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.completed && set.reps !== null && set.reps > 0).length, 0)
    workoutsByDate.set(date, (workoutsByDate.get(date) ?? 0) + sets)
  }
  const pairs = recent.filter((entry) => workoutsByDate.has(entry.date)).map((entry) => ({ score: entry.score, sets: workoutsByDate.get(entry.date)! }))
  if (pairs.length >= 7 && new Set(pairs.map((pair) => pair.score)).size >= 3 && new Set(pairs.map((pair) => pair.sets)).size >= 3) {
    const correlation = pearson(pairs.map((pair) => pair.score), pairs.map((pair) => pair.sets))
    if (correlation !== null && Math.abs(correlation) >= 0.4) insights.push({
      id: 'workout-comparison',
      text: `Observation across ${pairs.length} days with both a check-in and completed workout: readiness and completed-set counts moved ${correlation > 0 ? 'together' : 'in opposite directions'} (r=${correlation.toFixed(2)}). This is a pattern, not proof that one caused the other.`,
    })
  }
  return insights
}

export const recoveryActivities = [
  { id: 'rest', label: 'Rest only' },
  { id: 'mobility', label: 'Mobility' },
  { id: 'walking', label: 'Gentle walking' },
  { id: 'stretching', label: 'Stretching' },
  { id: 'balance', label: 'Balance work' },
  { id: 'light-movement', label: 'Light recovery movement' },
] as const

export type RecoveryActivity = typeof recoveryActivities[number]['id']
export type RecoverySession = {
  id: string
  date: string
  createdAt: number
  activity: RecoveryActivity
  durationMinutes: number | null
  notes: string
}

export function createRecoverySession(activity: RecoveryActivity, durationMinutes: number | null, notes: string, date: string, createdAt = Date.now()): RecoverySession {
  if (!recoveryActivities.some((item) => item.id === activity)) throw new Error('Choose a valid recovery activity.')
  if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600)) throw new Error('Duration must be from 1 to 600 minutes.')
  if (typeof notes !== 'string' || notes.length > 500) throw new Error('Notes must be 500 characters or fewer.')
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Recovery date is invalid.')
  return { id: globalThis.crypto?.randomUUID?.() ?? `recovery-${createdAt}-${Math.random().toString(36).slice(2)}`, date, createdAt, activity, durationMinutes, notes: notes.trim() }
}

export function isRecoverySession(value: unknown): value is RecoverySession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const session = value as Record<string, unknown>
  return typeof session.id === 'string' && session.id.length > 0
    && typeof session.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(session.date)
    && Number.isFinite(new Date(`${session.date}T00:00:00Z`).getTime())
    && new Date(`${session.date}T00:00:00Z`).toISOString().slice(0, 10) === session.date
    && Number.isFinite(session.createdAt) && (session.createdAt as number) >= 0
    && recoveryActivities.some((item) => item.id === session.activity)
    && (session.durationMinutes === null || (Number.isInteger(session.durationMinutes) && (session.durationMinutes as number) >= 1 && (session.durationMinutes as number) <= 600))
    && typeof session.notes === 'string' && session.notes.length <= 500
}
