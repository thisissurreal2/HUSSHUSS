import { getPersonalRecords } from './strengthAnalytics'
import type { WorkoutRecord } from './workoutStorage'
import type { ExtraSessionRecord } from './extras'

export const XP_PER_SET = 10
export const XP_PER_WORKOUT = 50
export const XP_PER_PR = 25
const LEVEL_STEP = 250

const LEVEL_TITLES = [
  'Gym Newbie',
  'Warm-Up Warrior',
  'Gym Rat',
  'Iron Intern',
  'Pump Chaser',
  'Rep Machine',
  'Absolute Unit',
  'Gym Menace',
  'Barbell Beast',
  'Final Boss',
]

export type XpSummary = {
  totalXp: number
  level: number
  title: string
  levelStartXp: number
  nextLevelXp: number
  progress: number
  lastWorkoutXp: number | null
  leveledUpLastWorkout: boolean
}

function xpForLevel(level: number): number {
  return (LEVEL_STEP * (level - 1) * level) / 2
}

function levelForXp(xp: number): number {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level += 1
  return level
}

function titleForLevel(level: number): string {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1]
}

export function getXpSummary(history: WorkoutRecord[], extras: ExtraSessionRecord[] = []): XpSummary {
  const prCountByRecord = new Map<string, number>()
  for (const entry of getPersonalRecords(history)) {
    if (entry.firstBenchmark) continue
    prCountByRecord.set(entry.recordId, (prCountByRecord.get(entry.recordId) ?? 0) + 1)
  }

  let totalXp = 0
  let latest: { completedAt: number; xp: number } | null = null
  for (const record of history) {
    const completedSets = record.exercises.reduce((count, exercise) => (
      count + exercise.sets.filter((set) => set.completed && set.reps !== null && set.reps > 0).length
    ), 0)
    const recordXp = completedSets * XP_PER_SET + XP_PER_WORKOUT + (prCountByRecord.get(record.id) ?? 0) * XP_PER_PR
    totalXp += recordXp
    if (latest === null || record.completedAt > latest.completedAt) {
      latest = { completedAt: record.completedAt, xp: recordXp }
    }
  }

  const extraXp = extras.filter((session) => session.status === 'completed').reduce((sum, session) => sum + session.xpEarned, 0)
  totalXp += extraXp
  const latestExtra = extras.filter((session) => session.status === 'completed' && session.completedAt !== null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]
  if (latestExtra && (latest === null || (latestExtra.completedAt ?? 0) > latest.completedAt)) latest = { completedAt: latestExtra.completedAt ?? 0, xp: latestExtra.xpEarned }
  const level = levelForXp(totalXp)
  const levelStartXp = xpForLevel(level)
  const nextLevelXp = xpForLevel(level + 1)
  return {
    totalXp,
    level,
    title: titleForLevel(level),
    levelStartXp,
    nextLevelXp,
    progress: (totalXp - levelStartXp) / (nextLevelXp - levelStartXp),
    lastWorkoutXp: latest?.xp ?? null,
    leveledUpLastWorkout: latest !== null && levelForXp(totalXp - latest.xp) < level,
  }
}

export function didWorkoutLevelUp(history: WorkoutRecord[], record: WorkoutRecord, extras: ExtraSessionRecord[] = []): boolean {
  const previousLevel = getXpSummary(history, extras).level
  const updatedLevel = getXpSummary([record, ...history], extras).level
  return updatedLevel > previousLevel
}