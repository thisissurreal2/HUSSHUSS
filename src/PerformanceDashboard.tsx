import { useState } from 'react'
import type { WorkoutRecord } from './workoutStorage'
import {
  formatDate,
  formatKg,
  getExercisePerformances,
  getPersonalRecords,
  type ExercisePerformance,
  type PersonalRecord,
} from './strengthAnalytics'

type Period = '7d' | '30d' | '90d' | 'all'
type DashboardMetric = 'estimated1RM' | 'volumeKg'

const periodLabels: Record<Period, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function mondayOf(date: Date): Date {
  const monday = startOfDay(date)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function startForPeriod(period: Period, now: Date): Date | null {
  if (period === 'all') return null
  const start = startOfDay(now)
  start.setDate(start.getDate() - (Number.parseInt(period, 10) - 1))
  return start
}

function filterByPeriod(history: WorkoutRecord[], period: Period, now: Date): WorkoutRecord[] {
  const start = startForPeriod(period, now)
  return history.filter((record) => record.completedAt <= now.getTime()
    && (start === null || record.completedAt >= start.getTime()))
}

function countCompletedSets(history: WorkoutRecord[]): number {
  return history.reduce((total, record) => total + record.exercises.reduce(
    (exerciseTotal, exercise) => exerciseTotal + exercise.sets.filter((set) => set.completed).length,
    0,
  ), 0)
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) return `${minutes} min`
  return remainingMinutes === 0 ? `${hours} hr` : `${hours} hr ${remainingMinutes} min`
}

function getWeekBuckets(history: WorkoutRecord[], period: Period, now: Date) {
  const currentWeek = mondayOf(now)
  const starts: Date[] = []
  for (let offset = 11; offset >= 0; offset -= 1) {
    const start = new Date(currentWeek)
    start.setDate(start.getDate() - (offset * 7))
    starts.push(start)
  }
  const periodStart = startForPeriod(period, now)
  const buckets = starts.map((start) => ({
    key: localDayKey(start),
    label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(start),
    count: history.filter((record) => {
      const completed = new Date(record.completedAt)
      const weekStart = mondayOf(completed)
      return localDayKey(weekStart) === localDayKey(start)
        && (periodStart === null || record.completedAt >= periodStart.getTime())
    }).length,
    hiddenByPeriod: periodStart !== null && addCalendarDays(start, 7).getTime() <= periodStart.getTime(),
  }))
  const available = buckets.filter((bucket) => !bucket.hiddenByPeriod)
  return available.slice(-Math.min(12, Math.max(1, available.length)))
}

function getMonthBuckets(history: WorkoutRecord[], period: Period, now: Date) {
  const periodStart = startForPeriod(period, now)
  const starts: Date[] = []
  for (let offset = 11; offset >= 0; offset -= 1) {
    starts.push(new Date(now.getFullYear(), now.getMonth() - offset, 1))
  }
  const buckets = starts.map((start) => ({
    key: `${start.getFullYear()}-${start.getMonth()}`,
    label: new Intl.DateTimeFormat('en', { month: 'short' }).format(start),
    count: history.filter((record) => {
      const completed = new Date(record.completedAt)
      return completed.getFullYear() === start.getFullYear()
        && completed.getMonth() === start.getMonth()
        && (periodStart === null || record.completedAt >= periodStart.getTime())
    }).length,
    hiddenByPeriod: periodStart !== null
      && new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime() <= periodStart.getTime(),
  }))
  return buckets.filter((bucket) => !bucket.hiddenByPeriod)
}

function getHeatmapDays(history: WorkoutRecord[], period: Period, now: Date) {
  const periodStart = startForPeriod(period, now)
  const firstDay = periodStart ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364)
  const days: { key: string; date: Date; count: number }[] = []
  const cursor = startOfDay(firstDay)
  const today = startOfDay(now)
  const counts = new Map<string, number>()
  for (const record of history) {
    const key = localDayKey(new Date(record.completedAt))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  while (cursor <= today) {
    const date = new Date(cursor)
    const key = localDayKey(date)
    days.push({ key, date, count: counts.get(key) ?? 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function getWeekStreaks(history: WorkoutRecord[], now: Date) {
  const activeWeeks = new Set(history
    .filter((record) => record.completedAt <= now.getTime())
    .map((record) => localDayKey(mondayOf(new Date(record.completedAt)))))
  const sortedWeeks = [...activeWeeks].sort()
  let longest = 0
  let run = 0
  let previous: Date | null = null
  for (const week of sortedWeeks) {
    const current = new Date(`${week}T00:00:00`)
    if (previous && localDayKey(current) === localDayKey(addCalendarDays(previous, 7))) {
      run += 1
    } else {
      run = 1
    }
    longest = Math.max(longest, run)
    previous = current
  }
  const thisWeek = localDayKey(mondayOf(now))
  let current = 0
  let cursor = new Date(`${thisWeek}T00:00:00`)
  while (activeWeeks.has(localDayKey(cursor))) {
    current += 1
    cursor = addCalendarDays(cursor, -7)
  }
  return { current, longest }
}

function findMostFrequentWorkout(history: WorkoutRecord[]): { name: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const record of history) counts.set(record.workoutName, (counts.get(record.workoutName) ?? 0) + 1)
  const sorted = [...counts].sort((a, b) => b[1] - a[1])
  if (!sorted.length) return null
  return { name: sorted[0][0], count: sorted[0][1] }
}

function getImprovedExercises(history: WorkoutRecord[]): {
  name: string
  from: number
  to: number
  change: number
}[] {
  const exerciseIds = new Set(history.flatMap((record) => record.exercises.map((exercise) => exercise.exerciseId)))
  return [...exerciseIds].flatMap((exerciseId) => {
    const performances = getExercisePerformances(history, exerciseId)
      .filter((performance) => performance.estimatedOneRepMaxKg !== null)
    if (performances.length < 2) return []
    const first = performances[0]
    const latest = performances.at(-1)
    if (!latest || first.estimatedOneRepMaxKg === null || latest.estimatedOneRepMaxKg === null
      || latest.estimatedOneRepMaxKg <= first.estimatedOneRepMaxKg) return []
    return [{
      name: latest.exercise.name,
      from: first.estimatedOneRepMaxKg,
      to: latest.estimatedOneRepMaxKg,
      change: ((latest.estimatedOneRepMaxKg - first.estimatedOneRepMaxKg) / first.estimatedOneRepMaxKg) * 100,
    }]
  }).sort((a, b) => b.change - a.change).slice(0, 3)
}

function getRecordedVolume(record: WorkoutRecord): number {
  return record.exercises.reduce((total, exercise) => (
    total + (getExercisePerformances([record], exercise.exerciseId)[0]?.volumeKg ?? 0)
  ), 0)
}

function getHighestVolumeWorkout(history: WorkoutRecord[]): { name: string; date: number; volume: number } | null {
  let highest: { name: string; date: number; volume: number } | null = null
  for (const record of history) {
    const volume = getRecordedVolume(record)
    if (volume > 0 && (!highest || volume > highest.volume)) {
      highest = { name: record.workoutName, date: record.completedAt, volume }
    }
  }
  return highest
}

function getWorkoutVolume(history: WorkoutRecord[]): number {
  return history.reduce((total, record) => total + getRecordedVolume(record), 0)
}

function getWeeklyAverage(history: WorkoutRecord[], period: Period, now: Date): number | null {
  if (history.length === 0) return 0
  if (period === 'all') {
    const earliest = history.reduce((first, record) => Math.min(first, record.completedAt), Number.POSITIVE_INFINITY)
    const firstDate = startOfDay(new Date(earliest))
    const days = Math.max(1, Math.ceil((startOfDay(now).getTime() - firstDate.getTime()) / 86400000) + 1)
    return history.length / (days / 7)
  }
  const days = Number.parseInt(period, 10)
  return history.length / (days / 7)
}

function getPeriodChange(history: WorkoutRecord[], period: Period, now: Date): string | null {
  if (period === 'all') return null
  const days = Number.parseInt(period, 10)
  const currentStart = startOfDay(now)
  currentStart.setDate(currentStart.getDate() - (days - 1))
  const previousStart = new Date(currentStart)
  previousStart.setDate(previousStart.getDate() - days)
  const previousEnd = currentStart.getTime() - 1
  const currentCount = history.filter((record) => record.completedAt >= currentStart.getTime()
    && record.completedAt <= now.getTime()).length
  const previousCount = history.filter((record) => record.completedAt >= previousStart.getTime()
    && record.completedAt <= previousEnd).length
  if (previousCount === 0) return currentCount > 0 ? 'Training recorded; previous period had none' : null
  const difference = ((currentCount - previousCount) / previousCount) * 100
  return `${difference > 0 ? '+' : ''}${Math.round(difference)}% vs previous ${days} days`
}

function getCompletedSetCount(history: WorkoutRecord): number {
  return history.exercises.reduce((total, exercise) => (
    total + exercise.sets.filter((set) => set.completed).length
  ), 0)
}

function getValidElapsedSeconds(record: WorkoutRecord): number | null {
  return Number.isFinite(record.durationSeconds) && record.durationSeconds > 0
    ? record.durationSeconds
    : null
}

function getStrengthOverview(history: WorkoutRecord[]) {
  const ids = new Set(history.flatMap((record) => record.exercises.map((exercise) => exercise.exerciseId)))
  const bests: { name: string; estimatedOneRepMaxKg: number }[] = []
  for (const exerciseId of ids) {
    const performances = getExercisePerformances(history, exerciseId)
    const estimates = performances.flatMap((performance) => (
      performance.estimatedOneRepMaxKg === null ? [] : [performance.estimatedOneRepMaxKg]
    ))
    if (estimates.length > 0) {
      const exercise = performances.at(-1)?.exercise
      if (exercise) bests.push({ name: exercise.name, estimatedOneRepMaxKg: Math.max(...estimates) })
    }
  }
  return bests.sort((a, b) => b.estimatedOneRepMaxKg - a.estimatedOneRepMaxKg).slice(0, 3)
}

function getExerciseNameFromHistory(history: WorkoutRecord[], exerciseId: string): string {
  return history.flatMap((record) => record.exercises)
    .find((exercise) => exercise.exerciseId === exerciseId)?.name ?? exerciseId
}

function TrendChart({
  performances,
  metric,
}: {
  performances: ExercisePerformance[]
  metric: DashboardMetric
}) {
  const points = performances.flatMap((performance) => {
    const value = metric === 'estimated1RM'
      ? performance.estimatedOneRepMaxKg
      : performance.volumeKg
    return value === null ? [] : [{ value, date: performance.record.completedAt, id: performance.record.id }]
  }).slice(-8)
  if (points.length === 0) {
    return <div className="performance-empty">No completed weighted sets are available for this trend.</div>
  }
  const min = Math.min(...points.map((point) => point.value))
  const max = Math.max(...points.map((point) => point.value))
  const range = max - min || Math.max(max * 0.1, 1)
  const coords = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 10 : 10 + (index / (points.length - 1)) * 280,
    y: 82 - ((point.value - (min - range * 0.1)) / (range * 1.2)) * 68,
  }))
  return (
    <svg className="performance-trend-chart" viewBox="0 0 300 108" role="img"
      aria-label={`${metric === 'estimated1RM' ? 'Estimated 1RM' : 'Volume load'} trend over ${points.length} logged sessions`}>
      <line className="performance-chart-grid" x1="8" x2="292" y1="82" y2="82" />
      <polyline className="performance-chart-line" points={coords.map((point) => `${point.x},${point.y}`).join(' ')} />
      {coords.map((point) => (
        <circle className="performance-chart-point" key={point.id} cx={point.x} cy={point.y} r="3.5">
          <title>{`${formatDate(point.date)} · ${metric === 'estimated1RM' ? `${formatKg(point.value)} kg e1RM` : `${Math.round(point.value)} kg × reps`}`}</title>
        </circle>
      ))}
      <text className="performance-chart-label" x="8" y="103">
        {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(coords[0].date))}
      </text>
      <text className="performance-chart-label" x="292" y="103" textAnchor="end">
        {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(coords.at(-1)!.date))}
      </text>
    </svg>
  )
}

function FrequencyBars({
  title,
  buckets,
  emptyText,
}: {
  title: string
  buckets: { key: string; label: string; count: number }[]
  emptyText: string
}) {
  const maximum = Math.max(...buckets.map((bucket) => bucket.count), 1)
  return (
    <div className="frequency-chart">
      <div className="performance-chart-title">{title}</div>
      {buckets.some((bucket) => bucket.count > 0) ? (
        <div className="frequency-bars">
          {buckets.map((bucket) => (
            <div className="frequency-bar-item" key={bucket.key} title={`${bucket.label}: ${bucket.count} workouts`}>
              <span className="frequency-bar-count">{bucket.count || ''}</span>
              <span className="frequency-bar-track">
                <span style={{ height: `${bucket.count === 0 ? 0 : Math.max(8, (bucket.count / maximum) * 100)}%` }} />
              </span>
              <span className="frequency-bar-label">{bucket.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="performance-empty">{emptyText}</div>
      )}
    </div>
  )
}

function ActivityHeatmap({ days }: { days: { key: string; date: Date; count: number }[] }) {
  const maxCount = Math.max(...days.map((day) => day.count), 1)
  const firstDayOffset = days.length > 0 ? (days[0].date.getDay() + 6) % 7 : 0
  return (
    <div className="activity-heatmap" role="img" aria-label="Completed workout activity calendar">
      {Array.from({ length: firstDayOffset }, (_, index) => (
        <span className="activity-day activity-day-empty" key={`pad-${index}`} aria-hidden="true" />
      ))}
      {days.map((day) => (
        <span
          className={`activity-day ${day.count > 0 ? `activity-level-${Math.min(4, Math.ceil((day.count / maxCount) * 4))}` : ''}`}
          key={day.key}
          title={`${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(day.date)} · ${day.count} completed workouts`}
          aria-label={`${day.key}: ${day.count} completed workouts`}
        />
      ))}
    </div>
  )
}

function RecentActivity({
  history,
  onOpenHistory,
}: {
  history: WorkoutRecord[]
  onOpenHistory: () => void
}) {
  const recent = [...history].sort((a, b) => b.completedAt - a.completedAt).slice(0, 5)
  return (
    <section className="performance-panel panel">
      <div className="performance-section-heading">
        <div>
          <div className="eyebrow">RECENT ACTIVITY</div>
          <h2>Completed workouts</h2>
        </div>
        <button className="text-link" type="button" onClick={onOpenHistory}>Workout history →</button>
      </div>
      {recent.length === 0 ? (
        <div className="performance-empty">Completed sessions will appear here. Unfinished and cancelled sessions are not included.</div>
      ) : (
        <div className="recent-workout-list">
          {recent.map((record) => {
            const elapsed = getValidElapsedSeconds(record)
            return (
              <article className="recent-workout-row" key={record.id}>
                <div className="recent-workout-main">
                  <strong>{record.workoutName}</strong>
                  <span>{formatDate(record.completedAt)}</span>
                </div>
                <div className="recent-workout-stats">
                  <span>{getCompletedSetCount(record)} sets</span>
                  {elapsed !== null && <span>{formatDuration(elapsed)} elapsed</span>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function PerformanceDashboard({
  history,
  onOpenHistory,
  onOpenStrengthProgress,
}: {
  history: WorkoutRecord[]
  onOpenHistory: () => void
  onOpenStrengthProgress: () => void
}) {
  const [period, setPeriod] = useState<Period>('30d')
  const [trendExerciseId, setTrendExerciseId] = useState('')
  const [trendMetric, setTrendMetric] = useState<DashboardMetric>('estimated1RM')
  const [now] = useState(() => new Date())
  const periodHistory = filterByPeriod(history, period, now)
  const periodWorkouts = [...periodHistory].sort((a, b) => a.completedAt - b.completedAt)
  const currentWeekHistory = filterByPeriod(history, '7d', now).filter((record) => (
    record.completedAt >= mondayOf(now).getTime()
  ))
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const currentMonthHistory = history.filter((record) => record.completedAt >= monthStart
    && record.completedAt <= now.getTime())
  const weeklyAverage = getWeeklyAverage(periodWorkouts, period, now)
  const validDurations = periodHistory.flatMap((record) => {
    const seconds = getValidElapsedSeconds(record)
    return seconds === null ? [] : [seconds]
  })
  const totalElapsed = validDurations.reduce((total, seconds) => total + seconds, 0)
  const setCount = countCompletedSets(periodHistory)
  const totalVolume = getWorkoutVolume(periodHistory)
  const weekBuckets = getWeekBuckets(history, period, now)
  const monthBuckets = getMonthBuckets(history, period, now)
  const heatmapDays = getHeatmapDays(history, period, now)
  const streaks = getWeekStreaks(history, now)
  const mostFrequent = findMostFrequentWorkout(periodHistory)
  const improvements = getImprovedExercises(periodHistory)
  const periodPRs = getPersonalRecords(history).filter((record) => (
    record.completedAt >= (startForPeriod(period, now)?.getTime() ?? 0)
      && record.completedAt <= now.getTime()
  )).slice(0, 3)
  const recentPR = periodPRs[0] ?? null
  const highestVolume = getHighestVolumeWorkout(periodHistory)
  const periodChange = getPeriodChange(history, period, now)
  const strongest = getStrengthOverview(periodHistory)
  const exerciseOptions = [...new Set(periodHistory.flatMap((record) => (
    record.exercises.map((exercise) => exercise.exerciseId)
  )))]
  const selectedTrendExerciseId = exerciseOptions.includes(trendExerciseId)
    ? trendExerciseId
    : exerciseOptions[0] ?? ''
  const trendPerformances = selectedTrendExerciseId
    ? getExercisePerformances(periodHistory, selectedTrendExerciseId)
    : []

  return (
    <div className="performance-dashboard">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PROGRESS · PHASE 3.2</div>
          <h1>Performance, at a glance.</h1>
          <p className="page-subtitle">A personal overview based on completed workouts saved on this device.</p>
        </div>
        <div className="weekly-chip">ON THIS DEVICE</div>
      </div>

      <section className="performance-period-panel panel" aria-label="Performance time period">
        <div>
          <div className="eyebrow">TIME PERIOD</div>
          <p>Update your dashboard summaries</p>
        </div>
        <div className="performance-period-tabs">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button
              className={period === value ? 'selected' : ''}
              type="button"
              key={value}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {periodLabels[value]}
            </button>
          ))}
        </div>
      </section>

      <section className="performance-stat-grid" aria-label={`${periodLabels[period]} training overview`}>
        <StatCard label="Workouts · period" value={periodHistory.length.toString()} />
        <StatCard label="This week" value={currentWeekHistory.length.toString()} />
        <StatCard label="This month" value={currentMonthHistory.length.toString()} />
        <StatCard label="Average / week" value={weeklyAverage === null ? '—' : weeklyAverage.toFixed(1)} />
        <StatCard label="Completed sets" value={setCount.toString()} />
        <StatCard
          label="Recorded elapsed time"
          value={validDurations.length === 0 ? '—' : formatDuration(totalElapsed)}
          note="Includes time between starting and finishing; not active lifting time."
        />
      </section>

      <section className="performance-panel panel">
        <div className="performance-section-heading">
          <div>
            <div className="eyebrow">TRAINING CONSISTENCY</div>
            <h2>Show up when it works for you.</h2>
          </div>
          <div className="performance-streaks">
            <span><strong>{streaks.current}</strong> current active weeks</span>
            <span><strong>{streaks.longest}</strong> longest active weeks</span>
          </div>
        </div>
        <div className="consistency-summary">
          <span>{currentWeekHistory.length} completed this week</span>
          <span>{currentMonthHistory.length} completed this month</span>
          <span>{new Set(periodHistory.map((record) => localDayKey(new Date(record.completedAt)))).size} distinct training days in period</span>
        </div>
        <div className="heatmap-scroll">
          <ActivityHeatmap days={heatmapDays} />
        </div>
        <div className="heatmap-legend"><span>Less</span><i /><i /><i /><i /><span>More</span></div>
        <p className="performance-note">{period === 'all'
          ? 'Activity heatmap shows the last 12 months; all-time totals and summaries still use the full saved history.'
          : `Activity heatmap shows ${periodLabels[period].toLowerCase()}.`}</p>
        <div className="frequency-grid">
          <FrequencyBars title="Weekly workout frequency · recent 12 weeks" buckets={weekBuckets}
            emptyText="No completed workouts in the selected period." />
          <FrequencyBars title={`Monthly workout frequency · ${periodLabels[period].toLowerCase()}`}
            buckets={monthBuckets} emptyText="No completed workouts in the selected period." />
        </div>
        <p className="performance-note">An active week means at least one completed workout; there is no weekly target. Recovery days are not stored in history, so days without training are not labeled missed or recovered.</p>
      </section>

      <section className="performance-panel panel">
        <div className="performance-section-heading">
          <div>
            <div className="eyebrow">STRENGTH OVERVIEW</div>
            <h2>Progress from logged performance.</h2>
          </div>
          <button className="text-link" type="button" onClick={onOpenStrengthProgress}>Exercise progression →</button>
        </div>
        <div className="strength-overview-grid">
          <div className="strength-overview-column">
            <div className="performance-chart-title">Strongest recorded estimates</div>
            {strongest.length === 0 ? (
              <div className="performance-empty">Log completed weighted working sets to compare estimated 1RM.</div>
            ) : strongest.map((item, index) => (
              <div className="strong-exercise-row" key={item.name}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{item.name}</strong>
                <b>{formatKg(item.estimatedOneRepMaxKg)} kg</b>
              </div>
            ))}
            <div className="performance-chart-title improved-title">Improving exercises · period</div>
            {improvements.length === 0 ? (
              <div className="performance-empty">More than one comparable exposure is needed to show improvement.</div>
            ) : improvements.map((item) => (
              <div className="improved-exercise-row" key={item.name}>
                <strong>{item.name}</strong>
                <span>{formatKg(item.from)} → {formatKg(item.to)} kg e1RM · +{item.change.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="strength-overview-column">
            <div className="trend-controls">
              <label>
                <span className="visually-hidden">Trend exercise</span>
                <select
                  aria-label="Trend exercise"
                  value={selectedTrendExerciseId}
                  onChange={(event) => setTrendExerciseId(event.currentTarget.value)}
                >
                  {exerciseOptions.map((exerciseId) => (
                    <option key={exerciseId} value={exerciseId}>{getExerciseNameFromHistory(periodHistory, exerciseId)}</option>
                  ))}
                </select>
              </label>
              <div className="trend-metric-tabs">
                <button type="button" className={trendMetric === 'estimated1RM' ? 'selected' : ''}
                  aria-pressed={trendMetric === 'estimated1RM'} onClick={() => setTrendMetric('estimated1RM')}>e1RM</button>
                <button type="button" className={trendMetric === 'volumeKg' ? 'selected' : ''}
                  aria-pressed={trendMetric === 'volumeKg'} onClick={() => setTrendMetric('volumeKg')}>Volume load</button>
              </div>
            </div>
            <div className="performance-chart-title">
              {trendMetric === 'estimated1RM' ? 'Estimated 1RM trend' : 'Volume-load trend'}
            </div>
            {selectedTrendExerciseId
              ? <TrendChart performances={trendPerformances} metric={trendMetric} />
              : <div className="performance-empty">No exercise history in this period.</div>}
            <p className="performance-note">Only completed, logged sets are analyzed. These estimates and trends are personal indicators, not tested maximums.</p>
          </div>
        </div>
        <div className="dashboard-recent-prs">
          <div className="performance-chart-title">Recent personal records · period</div>
          {periodPRs.length === 0 ? (
            <div className="performance-empty">No new estimated 1RM records in this period.</div>
          ) : periodPRs.map((record: PersonalRecord) => (
            <div className="dashboard-pr-row" key={`${record.exerciseId}-${record.recordId}`}>
              <strong>{record.exerciseName}</strong>
              <span>{formatDate(record.completedAt)} · {record.firstBenchmark ? 'first benchmark' : 'new PR'}</span>
              <b>{formatKg(record.estimatedOneRepMaxKg)} kg</b>
            </div>
          ))}
        </div>
      </section>

      <section className="performance-panel panel">
        <div className="performance-section-heading">
          <div>
            <div className="eyebrow">PERSONAL HIGHLIGHTS</div>
            <h2>Patterns in your selected period.</h2>
          </div>
        </div>
        <div className="performance-highlights-grid">
          <Highlight label="Most frequent workout" value={mostFrequent
            ? `${mostFrequent.name} · ${mostFrequent.count} sessions`
            : null} />
          <Highlight label="Most improved" value={improvements[0]
            ? `${improvements[0].name} · +${improvements[0].change.toFixed(1)}% e1RM`
            : null} />
          <Highlight label="Most recent PR" value={recentPR
            ? `${recentPR.exerciseName} · ${formatKg(recentPR.estimatedOneRepMaxKg)} kg`
            : null} />
          <Highlight label="Highest workout volume" value={highestVolume
            ? `${highestVolume.name} · ${Math.round(highestVolume.volume).toLocaleString()} kg × reps`
            : null}
            detail={highestVolume ? formatDate(highestVolume.date) : undefined} />
          <Highlight label="Consistency vs previous period" value={periodChange}
            detail={period === 'all' ? 'Not comparable for all-time view.' : 'Based on completed session counts; a zero baseline is not converted to a percentage.'} />
          <Highlight label="Volume load · period" value={totalVolume > 0
            ? `${Math.round(totalVolume).toLocaleString()} kg × reps`
            : null}
            detail="Sum of logged weight × reps for completed, weighted sets." />
        </div>
      </section>

      <RecentActivity history={periodHistory} onOpenHistory={onOpenHistory} />
    </div>
  )
}

function StatCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="performance-stat panel">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

function Highlight({ label, value, detail }: { label: string; value: string | null; detail?: string }) {
  return (
    <div className="performance-highlight">
      <span className="eyebrow">{label}</span>
      {value ? <strong>{value}</strong> : <span className="highlight-empty">Not enough recorded data yet.</span>}
      {detail && <small>{detail}</small>}
    </div>
  )
}
