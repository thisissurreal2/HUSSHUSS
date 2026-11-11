import { useState } from 'react'
import type { ActiveExercise, RecordedExercise, WorkoutRecord } from './workoutStorage'
import {
  formatDate,
  formatKg,
  getExerciseOptions,
  getExercisePerformances,
  getHistoricalBestOneRepMax,
  getLiveEstimatedOneRepMax,
  getPersonalRecords,
  getProgressionRecommendation,
  getStalledExercises,
  type ExercisePerformance,
} from './strengthAnalytics'

type Metric = 'estimated1RM' | 'volume' | 'topWeight'

const metricLabels: Record<Metric, string> = {
  estimated1RM: 'Estimated 1RM',
  volume: 'Volume load',
  topWeight: 'Top weight',
}

function getMetricValue(performance: ExercisePerformance, metric: Metric): number | null {
  if (metric === 'estimated1RM') return performance.estimatedOneRepMaxKg
  if (metric === 'volume') return performance.volumeKg
  return performance.topWeightKg
}

function formatMetric(value: number, metric: Metric): string {
  return metric === 'volume'
    ? `${Math.round(value).toLocaleString()} kg × reps`
    : `${formatKg(value)} kg`
}

function ProgressChart({
  performances,
  metric,
}: {
  performances: ExercisePerformance[]
  metric: Metric
}) {
  const points = performances.flatMap((performance) => {
    const value = getMetricValue(performance, metric)
    return value === null ? [] : [{ performance, value }]
  }).slice(-12)

  if (points.length === 0) {
    return (
      <div className="strength-chart-empty">
        <strong>No chartable sets yet</strong>
        <span>Complete and log weighted working sets to see this trend. Estimates use completed sets of up to 12 reps with a logged weight.</span>
      </div>
    )
  }

  const chartWidth = 640
  const chartHeight = 228
  const left = 54
  const right = 618
  const top = 18
  const bottom = 178
  const values = points.map((point) => point.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const spread = maximum - minimum || Math.max(maximum * 0.12, 1)
  const minAxis = Math.max(0, minimum - spread * 0.18)
  const maxAxis = maximum + spread * 0.18
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left),
    y: bottom - ((point.value - minAxis) / (maxAxis - minAxis)) * (bottom - top),
  }))
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ')
  const dateLabels = coordinates.length <= 4
    ? coordinates
    : [coordinates[0], coordinates[Math.floor((coordinates.length - 1) / 2)], coordinates[coordinates.length - 1]]

  return (
    <div className="strength-chart-wrap">
      <svg
        className="strength-chart"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label={`${metricLabels[metric]} history with ${points.length} logged workout${points.length === 1 ? '' : 's'}`}
      >
        {[0, 1, 2, 3].map((step) => {
          const y = top + (step / 3) * (bottom - top)
          const value = maxAxis - (step / 3) * (maxAxis - minAxis)
          return (
            <g key={step}>
              <line className="strength-chart-grid" x1={left} x2={right} y1={y} y2={y} />
              <text className="strength-chart-axis" x={left - 8} y={y + 3} textAnchor="end">
                {Math.round(value)}
              </text>
            </g>
          )
        })}
        <polyline className="strength-chart-line" points={line} />
        {coordinates.map((point) => (
          <circle
            className="strength-chart-point"
            key={point.performance.record.id}
            cx={point.x}
            cy={point.y}
            r="5"
          >
            <title>{`${formatDate(point.performance.record.completedAt)} · ${formatMetric(point.value, metric)}`}</title>
          </circle>
        ))}
        {dateLabels.map((point) => (
          <text
            className="strength-chart-date"
            key={`date-${point.performance.record.id}`}
            x={point.x}
            y={bottom + 24}
            textAnchor="middle"
          >
            {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
              .format(new Date(point.performance.record.completedAt))}
          </text>
        ))}
      </svg>
    </div>
  )
}

function PerformanceSummary({
  performances,
  metric,
}: {
  performances: ExercisePerformance[]
  metric: Metric
}) {
  const values = performances
    .map((performance) => getMetricValue(performance, metric))
    .filter((value): value is number => value !== null)
  const latest = values.at(-1)
  const previous = values.at(-2)
  const change = latest !== undefined && previous !== undefined ? latest - previous : null

  return (
    <div className="strength-summary">
      <div>
        <span className="eyebrow">LATEST</span>
        <strong>{latest === undefined ? '—' : formatMetric(latest, metric)}</strong>
      </div>
      <div>
        <span className="eyebrow">CHANGE VS PREVIOUS</span>
        <strong className={change !== null && change > 0 ? 'strength-positive' : ''}>
          {change === null ? '—' : `${change > 0 ? '+' : ''}${formatMetric(change, metric)}`}
        </strong>
      </div>
      <div>
        <span className="eyebrow">LOGGED SESSIONS</span>
        <strong>{values.length}</strong>
      </div>
    </div>
  )
}

function formatSet(set: ExercisePerformance['sets'][number]): string {
  const weight = set.weightKg === null ? 'Bodyweight / unweighted' : `${formatKg(set.weightKg)} kg`
  return `${weight} × ${set.reps} reps`
}

export function StrengthProgressPage({ history }: { history: WorkoutRecord[] }) {
  const exerciseOptions = getExerciseOptions(history)
  const [requestedExerciseId, setRequestedExerciseId] = useState('')
  const [metric, setMetric] = useState<Metric>('estimated1RM')
  const selectedExerciseId = exerciseOptions.some((exercise) => exercise.id === requestedExerciseId)
    ? requestedExerciseId
    : exerciseOptions[0]?.id ?? ''

  const selectedExercise = exerciseOptions.find((exercise) => exercise.id === selectedExerciseId)
  const performances = selectedExerciseId
    ? getExercisePerformances(history, selectedExerciseId)
    : []
  const relevantPerformances = performances.filter((performance) => performance.sets.length > 0)
  const personalRecords = getPersonalRecords(history).slice(0, 8)
  const stalledExercises = getStalledExercises(history)

  return (
    <div className="strength-progress-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PROGRESS · PHASE 3.1</div>
          <h1>Strength, over time.</h1>
          <p className="page-subtitle">A clear view of completed, logged working sets. Nothing is estimated from missing data.</p>
        </div>
        <div className="weekly-chip">ON THIS DEVICE</div>
      </div>

      <section className="strength-progress-panel panel">
        <div className="strength-panel-heading">
          <div>
            <div className="eyebrow">EXERCISE TREND</div>
            <h2>{selectedExercise?.name ?? 'Choose an exercise'}</h2>
          </div>
          <label className="strength-select-label">
            <span className="visually-hidden">Select exercise</span>
            <select
              className="strength-exercise-select"
              value={selectedExerciseId}
              onChange={(event) => setRequestedExerciseId(event.currentTarget.value)}
            >
              {exerciseOptions.map((exercise) => (
                <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="strength-metric-tabs" aria-label="Chart metric">
          {(Object.keys(metricLabels) as Metric[]).map((metricId) => (
            <button
              className={metric === metricId ? 'selected' : ''}
              key={metricId}
              type="button"
              aria-pressed={metric === metricId}
              onClick={() => setMetric(metricId)}
            >
              {metricLabels[metricId]}
            </button>
          ))}
        </div>
        <PerformanceSummary performances={relevantPerformances} metric={metric} />
        <ProgressChart performances={relevantPerformances} metric={metric} />
        <p className="strength-method-note">
          Charts show the 12 most recent logged exposures. Estimated 1RM uses the Epley formula (weight × (1 + reps ÷ 30)) for completed, weighted sets of 2–12 reps; a single completed rep uses the logged weight. It is an estimate, not a tested maximum. Volume load is logged weight × reps (kg × reps).
        </p>
      </section>

      <div className="strength-secondary-grid">
        <section className="strength-progress-panel panel">
          <div className="eyebrow">PERSONAL RECORDS</div>
          <h2>Estimated 1RM bests</h2>
          <p className="strength-panel-intro">Only new best estimates from completed, weighted sets are shown.</p>
          {personalRecords.length === 0 ? (
            <div className="strength-empty">Complete and log a weighted set of up to 12 reps to establish a benchmark.</div>
          ) : (
            <div className="strength-record-list">
              {personalRecords.map((record) => (
                <div className="strength-record-row" key={record.recordId}>
                  <div>
                    <strong>{record.exerciseName}</strong>
                    <span>{formatDate(record.completedAt)} · {record.workoutName}</span>
                  </div>
                  <div className="strength-record-value">
                    <strong>{formatKg(record.estimatedOneRepMaxKg)} kg</strong>
                    <span>{record.firstBenchmark ? 'FIRST BENCHMARK' : 'NEW PR'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="strength-progress-panel panel">
          <div className="eyebrow">POTENTIAL PLATEAUS</div>
          <h2>Three-exposure check</h2>
          <p className="strength-panel-intro">Flags exercises with no more than 1% estimated 1RM growth over the last three logged exposures.</p>
          {stalledExercises.length === 0 ? (
            <div className="strength-empty">Not enough comparable logged weighted sets to flag a plateau yet.</div>
          ) : (
            <div className="strength-record-list">
              {stalledExercises.map((item) => (
                <div className="strength-stall-row" key={item.exerciseId}>
                  <strong>{item.exerciseName}</strong>
                  <span>{formatKg(item.sessions[0].estimatedOneRepMaxKg ?? 0)} → {formatKg(item.sessions[2].estimatedOneRepMaxKg ?? 0)} kg estimated 1RM across three exposures</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="strength-progress-panel panel">
        <div className="eyebrow">EXERCISE HISTORY</div>
        <h2>{selectedExercise?.name ?? 'Selected exercise'}</h2>
        {relevantPerformances.length === 0 ? (
          <div className="strength-empty">No completed sets for this exercise are recorded yet.</div>
        ) : (
          <div className="strength-history-list">
            {[...relevantPerformances].reverse().map((performance) => (
              <article className="strength-history-row" key={performance.record.id}>
                <div className="strength-history-date">
                  <strong>{formatDate(performance.record.completedAt)}</strong>
                  <span>{performance.record.workoutName}</span>
                </div>
                <div className="strength-history-sets">
                  {performance.sets.length === 0
                    ? <span>No completed sets logged</span>
                    : performance.sets.map((set) => <span key={set.id}>{formatSet(set)}</span>)}
                </div>
                <div className="strength-history-estimate">
                  {performance.estimatedOneRepMaxKg === null
                    ? '—'
                    : `${formatKg(performance.estimatedOneRepMaxKg)} kg est. 1RM`}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <p className="strength-disclaimer">Progression notes are based only on completed sets with saved weights and reps. They are suggestions, not instructions; prioritize comfortable technique and recovery.</p>
    </div>
  )
}

export function PreviousPerformance({
  history,
  exercise,
  activeExercise,
}: {
  history: WorkoutRecord[]
  exercise: Pick<RecordedExercise, 'exerciseId' | 'targetReps'>
  activeExercise: ActiveExercise
}) {
  const previous = getExercisePerformances(history, exercise.exerciseId)
    .filter((performance) => performance.sets.length > 0)
    .at(-1) ?? null
  const estimate = previous?.estimatedOneRepMaxKg ?? null
  const historicalBest = getHistoricalBestOneRepMax(
    getExercisePerformances(history, exercise.exerciseId),
  )
  const liveEstimate = getLiveEstimatedOneRepMax(exercise, activeExercise)
  const isNewRecord = liveEstimate !== null
    && (historicalBest === null || liveEstimate > historicalBest)
  const recommendation = previous ? getProgressionRecommendation(previous) : null

  return (
    <div className="exercise-performance-note">
      {previous ? (
        <>
          <strong>Previous · {formatDate(previous.record.completedAt)}</strong>
          <span>
            {previous.sets.map((set) => formatSet(set)).join(' · ')}
            {estimate === null ? '' : ` · ${formatKg(estimate)} kg estimated 1RM`}
          </span>
          {recommendation && <span className="exercise-recommendation">{recommendation}</span>}
        </>
      ) : (
        <span>No previous completed, logged sets for this exercise.</span>
      )}
      {isNewRecord && (
        <span className="exercise-pr-badge">
          {historicalBest === null ? 'First estimated 1RM benchmark' : 'New estimated 1RM PR'}
          {' · '}{formatKg(liveEstimate)} kg
        </span>
      )}
    </div>
  )
}
