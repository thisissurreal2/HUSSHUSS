export type ReadinessRatings = {
  sleep: number
  energy: number
  soreness: number
  motivation: number
  stress: number
}

export type ReadinessCheckIn = ReadinessRatings & {
  date: string
  score: number
  createdAt: string
  updatedAt: string
}

export type ReadinessCategory = 'ready' | 'caution' | 'recovery'

export function getLocalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function isValidRatings(value: unknown): value is ReadinessRatings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const ratings = value as Record<string, unknown>
  return ['sleep', 'energy', 'soreness', 'motivation', 'stress'].every((key) =>
    Number.isInteger(ratings[key]) && (ratings[key] as number) >= 1 && (ratings[key] as number) <= 5)
}

export function isReadinessCheckIn(value: unknown): value is ReadinessCheckIn {
  if (!isValidRatings(value)) return false
  const entry = value as unknown as Record<string, unknown>
  if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false
  const parsedDate = new Date(`${entry.date}T00:00:00Z`)
  return Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === entry.date
    && Number.isInteger(entry.score) && (entry.score as number) >= 0 && (entry.score as number) <= 100
    && typeof entry.createdAt === 'string' && Number.isFinite(Date.parse(entry.createdAt))
    && typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))
    && entry.score === calculateReadinessScore(entry as unknown as ReadinessRatings)
}

export function calculateReadinessScore(ratings: ReadinessRatings): number {
  if (!isValidRatings(ratings)) throw new Error('Each readiness rating must be a whole number from 1 to 5.')
  const normalized = (value: number) => (value - 1) * 25
  return Math.round(
    normalized(ratings.sleep) * 0.25
    + normalized(ratings.energy) * 0.25
    + (100 - normalized(ratings.soreness)) * 0.2
    + normalized(ratings.motivation) * 0.1
    + (100 - normalized(ratings.stress)) * 0.2,
  )
}

export function getReadinessCategory(score: number): ReadinessCategory {
  if (!Number.isInteger(score) || score < 0 || score > 100) throw new Error('Readiness score must be a whole number from 0 to 100.')
  return score >= 80 ? 'ready' : score >= 60 ? 'caution' : 'recovery'
}

export function upsertReadinessCheckIn(
  history: ReadinessCheckIn[], ratings: ReadinessRatings, date: string, now = new Date().toISOString(),
): ReadinessCheckIn[] {
  if (!isValidRatings(ratings)) throw new Error('Each readiness rating must be a whole number from 1 to 5.')
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Check-in date is invalid.')
  const prior = history.find((entry) => entry.date === date)
  const record: ReadinessCheckIn = { ...ratings, date, score: calculateReadinessScore(ratings), createdAt: prior?.createdAt ?? now, updatedAt: now }
  return [...history.filter((entry) => entry.date !== date), record].sort((a, b) => b.date.localeCompare(a.date))
}

export function getReadinessTrends(history: ReadinessCheckIn[], today: string) {
  const result = (days: number) => {
    const start = new Date(`${today}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - days + 1)
    const from = start.toISOString().slice(0, 10)
    return history.filter((entry) => entry.date >= from && entry.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  }
  const days7 = result(7)
  const days30 = result(30)
  const scores = history.map((entry) => entry.score)
  const mean = (entries: ReadinessCheckIn[]) => entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length) : null
  return {
    days7, days30, average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    average7: mean(days7), average30: mean(days30),
    highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null,
    completedDays: history.length,
  }
}

export function getReadinessFactors(ratings: ReadinessRatings) {
  return [
    { label: 'Sleep', weight: '25%', contribution: (ratings.sleep - 3) * 6.25 },
    { label: 'Energy', weight: '25%', contribution: (ratings.energy - 3) * 6.25 },
    { label: 'Soreness · inverse', weight: '20%', contribution: (3 - ratings.soreness) * 5 },
    { label: 'Motivation', weight: '10%', contribution: (ratings.motivation - 3) * 2.5 },
    { label: 'Stress · inverse', weight: '20%', contribution: (3 - ratings.stress) * 5 },
  ]
}
