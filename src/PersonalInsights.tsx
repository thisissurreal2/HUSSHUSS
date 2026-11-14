import { useEffect, useMemo, useState } from 'react'
import { readAthleticData, athleticCategories, builtInAssessments, type AthleticData } from './athleticStorage'
import { readMeasurementData, type MeasurementData } from './measurementStorage'
import { getExercisePerformances, getPersonalRecords } from './strengthAnalytics'
import type { WorkoutRecord } from './workoutStorage'

type Period = '7d' | '30d' | '90d' | 'all'
type Change = { name: string; detail: string; direction: 'up' | 'down'; at: number }

const periodLabels: Record<Period, string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  all: 'All time',
}

function getCompletedSetCount(history: WorkoutRecord[]): number {
  return history.reduce((total, record) => total + record.exercises.reduce((count, exercise) => (
    count + exercise.sets.filter((set) => set.completed).length
  ), 0), 0)
}

function getVolume(history: WorkoutRecord[]): number {
  return history.reduce((total, record) => total + record.exercises.reduce((exerciseTotal, exercise) => (
    exerciseTotal + exercise.sets.reduce((setTotal, set) => (
      set.completed && set.weightKg !== null && set.reps !== null
        ? setTotal + set.weightKg * set.reps
        : setTotal
    ), 0)
  ), 0), 0)
}

function formatVolume(value: number): string {
  return `${Math.round(value).toLocaleString()} kg`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(timestamp))
}

export function PersonalInsights({ history }: { history: WorkoutRecord[] }) {
  const [period, setPeriod] = useState<Period>('30d')
  const [athletic, setAthletic] = useState<AthleticData>(() => ({
    version: 1,
    customAssessments: [],
    records: [],
  }))
  const [measurements, setMeasurements] = useState<MeasurementData>(() => ({ version: 1, sessions: [] }))
  const [storageError, setStorageError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    const refresh = () => {
      void Promise.all([readAthleticData(), readMeasurementData()])
        .then(([athleticResult, measurementResult]) => {
          if (!active) return
          setAthletic(athleticResult.data)
          setMeasurements(measurementResult.data)
          setStorageError(athleticResult.error || measurementResult.error)
        })
        .catch((error: unknown) => {
          if (active) {
            setStorageError(error instanceof Error ? error.message : 'Local progress data could not be read.')
          }
        })
    }
    refresh()
    window.addEventListener('husshuss:local-data-changed', refresh)
    return () => {
      active = false
      window.removeEventListener('husshuss:local-data-changed', refresh)
    }
  }, [])

  const { current, previous, currentStart } = useMemo(() => {
    const duration = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null
    const start = duration === null ? null : now - duration * 24 * 60 * 60 * 1000
    const prevStart = duration === null ? null : now - 2 * duration * 24 * 60 * 60 * 1000
    return {
      currentStart: start,
      current: history.filter((record) => record.completedAt <= now && (start === null || record.completedAt >= start)),
      previous: duration === null
        ? []
        : history.filter((record) => record.completedAt >= (prevStart ?? 0)
          && record.completedAt < (start ?? now)
          && record.completedAt <= now),
    }
  }, [history, now, period])

  const currentVolume = getVolume(current)
  const previousVolume = getVolume(previous)
  const completedSets = getCompletedSetCount(current)
  const weeklyRate = current.length === 0
    ? null
    : period === 'all'
      ? current.length / Math.max(1, (now - Math.min(...current.map((record) => record.completedAt))) / (7 * 24 * 60 * 60 * 1000))
      : current.length / (period === '7d' ? 1 : period === '30d' ? 30 / 7 : 90 / 7)
  const previousRate = period === 'all' || previous.length === 0
    ? null
    : previous.length / (period === '7d' ? 1 : period === '30d' ? 30 / 7 : 90 / 7)

  const strengthChanges: Change[] = []
  for (const record of current) {
    for (const exercise of record.exercises) {
      const performances = getExercisePerformances(history, exercise.exerciseId)
      const index = performances.findIndex((performance) => performance.record.id === record.id)
      if (index <= 0) continue
      const latest = performances[index]
      const before = performances[index - 1]
      if (latest.estimatedOneRepMaxKg === null || before.estimatedOneRepMaxKg === null) continue
      const changePercent = ((latest.estimatedOneRepMaxKg - before.estimatedOneRepMaxKg) / before.estimatedOneRepMaxKg) * 100
      if (Math.abs(changePercent) < 1) continue
      strengthChanges.push({
        name: exercise.name,
        detail: `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}% estimated 1RM · ${formatDate(record.completedAt)}`,
        direction: changePercent > 0 ? 'up' : 'down',
        at: record.completedAt,
      })
    }
  }
  const seenStrengthNames = new Set<string>()
  const uniqueStrengthChanges = strengthChanges
    .sort((a, b) => b.at - a.at)
    .filter((item) => {
      if (seenStrengthNames.has(item.name)) return false
      seenStrengthNames.add(item.name)
      return true
    })
    .slice(0, 4)

  const recentPRs = getPersonalRecords(current).slice(0, 4)
  const definitions = [...builtInAssessments, ...athletic.customAssessments]
  const athleticChanges: Change[] = []
  for (const record of athletic.records) {
    const inPeriod = period === 'all'
      || (new Date(`${record.date}T12:00:00`).getTime() >= (currentStart ?? 0)
        && new Date(`${record.date}T12:00:00`).getTime() <= now)
    if (!inPeriod) continue
    const definition = definitions.find((item) => item.id === record.assessmentId)
    if (!definition) continue
    for (const [key, value] of Object.entries(record.values)) {
      const metric = definition.metrics.find((item) => item.key === key)
      if (!metric) continue
      const earlier = athletic.records
        .filter((item) => item.assessmentId === record.assessmentId
          && item.date <= record.date
          && (item.date < record.date || item.createdAt < record.createdAt)
          && typeof item.values[key] === 'number')
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0]
      if (!earlier) continue
      const previousValue = earlier.values[key]
      const delta = value - previousValue
      if (delta === 0) continue
      const improved = metric.direction === 'higher' ? delta > 0 : delta < 0
      athleticChanges.push({
        name: `${record.assessmentName} · ${metric.label}`,
        detail: `${delta > 0 ? '+' : ''}${Number(delta.toFixed(2))} ${metric.unit} vs ${earlier.date}`,
        direction: improved ? 'up' : 'down',
        at: new Date(`${record.date}T12:00:00`).getTime(),
      })
    }
  }
  const recentAthleticChanges = athleticChanges.sort((a, b) => b.at - a.at).slice(0, 4)

  const workoutTypes = current.reduce<Record<string, number>>((totals, record) => {
    totals[record.workoutName] = (totals[record.workoutName] ?? 0) + 1
    return totals
  }, {})
  const maximumTypeCount = Math.max(0, ...Object.values(workoutTypes))
  const mostFrequentTypes = Object.entries(workoutTypes).filter(([, count]) => count === maximumTypeCount)
  const latestMeasurement = [...measurements.sessions].sort((a, b) => b.date.localeCompare(a.date))[0]
  const recordedCategories = new Set(athletic.records.map((record) => record.category))
  const completedThisPeriod = current.length
  const consistencyChange = previousRate === null
    ? null
    : completedThisPeriod === 0 && previous.length === 0
      ? 'No completed workouts in either period'
      : `${weeklyRate?.toFixed(1) ?? '0.0'} vs ${previousRate.toFixed(1)} / week`
  const loadChange = previousVolume <= 0
    ? null
    : `${currentVolume > previousVolume ? '+' : ''}${((currentVolume - previousVolume) / previousVolume * 100).toFixed(0)}% logged volume`

  return (
    <div className="personal-insights">
      {storageError && <div className="athletic-alert" role="alert">{storageError}</div>}
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PROGRESS · PERSONAL INSIGHTS</div>
          <h1>Patterns, not pressure.</h1>
          <p className="page-subtitle">Observations from records you entered. No readiness score or coaching claims.</p>
        </div>
        <div className="weekly-chip">PERSONAL</div>
      </div>

      <section className="performance-period-panel panel" aria-label="Insights time period">
        <div>
          <div className="eyebrow">TIME PERIOD</div>
          <p>Compare recent records</p>
        </div>
        <div className="performance-period-tabs">
          {(Object.keys(periodLabels) as Period[]).map((value) => (
            <button type="button" className={period === value ? 'selected' : ''} aria-pressed={period === value} key={value} onClick={() => setPeriod(value)}>
              {periodLabels[value]}
            </button>
          ))}
        </div>
      </section>

      <section className="performance-stat-grid" aria-label={`${periodLabels[period]} personal summary`}>
        <article className="performance-stat panel"><span>Completed workouts</span><strong>{current.length}</strong><small>{previous.length ? `${previous.length} in the previous period` : 'completed records only'}</small></article>
        <article className="performance-stat panel"><span>Average / week</span><strong>{weeklyRate === null ? '—' : weeklyRate.toFixed(1)}</strong><small>{consistencyChange ?? 'calculated from recorded dates'}</small></article>
        <article className="performance-stat panel"><span>Completed sets</span><strong>{completedSets}</strong><small>{periodLabels[period]}</small></article>
        <article className="performance-stat panel"><span>Logged volume-load</span><strong>{currentVolume > 0 ? formatVolume(currentVolume) : '—'}</strong><small>{loadChange ?? 'weighted completed sets only'}</small></article>
        <article className="performance-stat panel"><span>Strength records</span><strong>{recentPRs.length}</strong><small>PRs and first benchmarks in this period</small></article>
        <article className="performance-stat panel"><span>Athletic categories</span><strong>{recordedCategories.size} / {athleticCategories.length}</strong><small>with at least one saved assessment</small></article>
      </section>

      <div className="insight-card-grid">
        <section className="backup-panel panel">
          <div className="eyebrow">TRAINING RHYTHM</div>
          <h2>Frequency and mix</h2>
          {current.length === 0 ? (
            <p className="insight-empty">No completed workouts in this period yet. Active, cancelled, and unfinished sessions are excluded.</p>
          ) : (
            <>
              {mostFrequentTypes.length > 0 && (
                <p className="insight-lead">
                  {mostFrequentTypes.length > 1 ? 'Tied most frequent:' : 'Most frequent:'}{' '}
                  <strong>{mostFrequentTypes.map(([name]) => name).join(', ')}</strong>
                  {' '}· {maximumTypeCount} of {current.length} sessions.
                </p>
              )}
              <div className="insight-bars">
                {Object.entries(workoutTypes).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                  <div className="insight-bar-row" key={name}>
                    <span>{name}</span>
                    <div className="insight-bar-track"><i style={{ width: `${Math.max(4, count / current.length * 100)}%` }} /></div>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
              {previousRate !== null && <p className="insight-footnote">Recorded frequency: {consistencyChange}. Recovery and non-training days are not classified as missed.</p>}
            </>
          )}
        </section>

        <section className="backup-panel panel">
          <div className="eyebrow">STRENGTH DEVELOPMENT</div>
          <h2>Recent exercise signals</h2>
          {uniqueStrengthChanges.length === 0 ? (
            <p className="insight-empty">No comparable estimated 1RM changes in this period. Estimates use completed weighted sets.</p>
          ) : (
            <ul className="insight-list">
              {uniqueStrengthChanges.map((change) => <li key={change.name}><strong>{change.name}</strong><span>{change.detail}</span></li>)}
            </ul>
          )}
          <p className="insight-footnote">Uses the estimated 1RM calculation; changes under 1% are omitted.</p>
          {recentPRs.length > 0 && (
            <div className="insight-subsection">
              <div className="micro-label">RECENT ESTIMATED 1RM HIGHS</div>
              <ul className="insight-list compact">
                {recentPRs.map((record) => <li key={`${record.exerciseId}-${record.recordId}`}><strong>{record.exerciseName}</strong><span>{formatDate(record.completedAt)} · {record.firstBenchmark ? 'first benchmark' : 'new PR'} · {record.estimatedOneRepMaxKg.toFixed(1)} kg</span></li>)}
              </ul>
            </div>
          )}
        </section>

        <section className="backup-panel panel">
          <div className="eyebrow">ATHLETIC ASSESSMENTS</div>
          <h2>Development you chose to test</h2>
          <div className="insight-category-list">
            {athleticCategories.map((category) => {
              const latest = athletic.records
                .filter((record) => record.category === category.id)
                .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0]
              return (
                <div className="insight-category-row" key={category.id}>
                  <span className={latest ? 'insight-category-dot recorded' : 'insight-category-dot'} />
                  <strong>{category.label}</strong>
                  <span>{latest ? latest.date : 'Not assessed'}</span>
                </div>
              )
            })}
          </div>
          {recentAthleticChanges.length > 0 && (
            <div className="insight-subsection">
              <div className="micro-label">RECENT COMPARISONS · DIRECTION-AWARE</div>
              <ul className="insight-list compact">
                {recentAthleticChanges.map((change, index) => <li key={`${change.name}-${index}`}><strong>{change.name}</strong><span>{change.direction === 'up' ? 'Improved' : 'Declined'} · {change.detail}</span></li>)}
              </ul>
            </div>
          )}
        </section>

        <section className="backup-panel panel">
          <div className="eyebrow">BODY TRACKING</div>
          <h2>Measurements, neutrally</h2>
          {latestMeasurement ? (
            <p className="insight-lead">{measurements.sessions.length} manually recorded session{measurements.sessions.length === 1 ? '' : 's'} · latest on <strong>{latestMeasurement.date}</strong>. Measurements are not classified as better or worse.</p>
          ) : (
            <p className="insight-empty">No body measurements recorded yet. This section does not estimate values.</p>
          )}
        </section>
      </div>

      <p className="insight-disclaimer">Period comparisons use rolling windows relative to when this page was opened. Training volume includes only completed sets with both weight and repetitions logged. These summaries describe recorded data; they do not assess fatigue, recovery, health, or training quality.</p>
    </div>
  )
}
