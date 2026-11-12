import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { WorkoutRecord } from './workoutStorage'
import {
  analyzeMuscleBalance,
  musclePeriodLabels,
  type MuscleBalanceResult,
  type MusclePeriod,
  type MuscleStat,
} from './muscleBalance'
import type { MuscleId } from './muscleMap'

const periods = Object.keys(musclePeriodLabels) as MusclePeriod[]

const WIDTH = 360
const TOP = 36
const HEIGHT = 258
const CENTER_X = 180
const CENTER_Y = 165
const RADIUS = 92
const LABEL_RADIUS = 113
const RINGS = [0.25, 0.5, 0.75, 1]

function formatNumber(value: number): string {
  return Number(value.toFixed(1)).toString()
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function formatChange(fraction: number | null): string {
  if (fraction === null) return '—'
  const rounded = Math.round(fraction * 100)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

function polar(index: number, count: number, distance: number): { x: number; y: number; cos: number; sin: number } {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: CENTER_X + distance * cos, y: CENTER_Y + distance * sin, cos, sin }
}

function MuscleRadar({
  stats,
  selected,
  onSelect,
}: {
  stats: MuscleStat[]
  selected: MuscleId
  onSelect: (muscle: MuscleId) => void
}) {
  const count = stats.length
  const ringPoints = (fraction: number) => stats
    .map((_, index) => {
      const point = polar(index, count, RADIUS * fraction)
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
    })
    .join(' ')
  const areaPoints = stats
    .map((stat, index) => {
      const point = polar(index, count, RADIUS * stat.relative)
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
    })
    .join(' ')

  function onKeyDown(event: KeyboardEvent<SVGGElement>, muscle: MuscleId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(muscle)
    }
  }

  return (
    <svg
      className="muscle-radar"
      viewBox={`0 ${TOP} ${WIDTH} ${HEIGHT}`}
      role="group"
      aria-label="Muscle balance radar. Each axis shows weighted training sets for a muscle group relative to the highest group."
    >
      {RINGS.map((fraction) => (
        <polygon className="muscle-radar-ring" key={fraction} points={ringPoints(fraction)} />
      ))}
      {stats.map((stat, index) => {
        const end = polar(index, count, RADIUS)
        return (
          <line
            className="muscle-radar-axis"
            key={stat.muscle}
            x1={CENTER_X}
            y1={CENTER_Y}
            x2={end.x}
            y2={end.y}
          />
        )
      })}
      <polygon className="muscle-radar-area" points={areaPoints} />
      {stats.map((stat, index) => {
        const vertex = polar(index, count, RADIUS * stat.relative)
        const label = polar(index, count, LABEL_RADIUS)
        const anchor = label.cos > 0.3 ? 'start' : label.cos < -0.3 ? 'end' : 'middle'
        const isSelected = stat.muscle === selected
        return (
          <g
            className={`muscle-radar-node ${isSelected ? 'selected' : ''}`}
            key={stat.muscle}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`${stat.label}: ${formatNumber(stat.setsPerWeek)} weighted sets per week, ${formatPercent(stat.share)} of total exposure`}
            onClick={() => onSelect(stat.muscle)}
            onKeyDown={(event: KeyboardEvent<SVGGElement>) => onKeyDown(event, stat.muscle)}
          >
            <circle className="muscle-radar-hit" cx={vertex.x} cy={vertex.y} r={18} />
            <circle className="muscle-radar-point" cx={vertex.x} cy={vertex.y} r={isSelected ? 5 : 3.5} />
            <text
              className="muscle-radar-label"
              x={label.x}
              y={label.y}
              textAnchor={anchor}
              dominantBaseline="central"
            >
              {stat.shortLabel}
            </text>
            <rect
              className="muscle-radar-label-hit"
              x={anchor === 'start' ? label.x - 4 : anchor === 'end' ? label.x - 56 : label.x - 30}
              y={label.y - 14}
              width={60}
              height={28}
            />
          </g>
        )
      })}
    </svg>
  )
}

function MuscleDetail({ stat, result }: { stat: MuscleStat; result: MuscleBalanceResult }) {
  const change = result.changeFraction[stat.muscle]
  return (
    <div className="muscle-detail" aria-live="polite">
      <div className="muscle-detail-heading">
        <strong>{stat.label}</strong>
        <span>{formatNumber(stat.weightedSets)} weighted sets in {musclePeriodLabels[result.period].toLowerCase()}</span>
      </div>
      <div className="muscle-detail-grid">
        <div><span>Per week</span><strong>{formatNumber(stat.setsPerWeek)}</strong></div>
        <div><span>Share</span><strong>{formatPercent(stat.share)}</strong></div>
        <div><span>Trained days</span><strong>{stat.trainedDays}</strong></div>
        <div><span>vs previous {result.days} days</span><strong>{formatChange(change)}</strong></div>
      </div>
      {stat.contributions.length > 0 ? (
        <div className="muscle-detail-sources">
          <span className="performance-chart-title">Main contributors</span>
          {stat.contributions.map((item) => (
            <div key={item.exerciseId}>
              <span>{item.name}</span>
              <b>{formatNumber(item.weightedSets)}</b>
            </div>
          ))}
        </div>
      ) : (
        <p className="performance-note">No completed sets counted toward this muscle in this period.</p>
      )}
      {stat.volumeLoadKg > 0 && (
        <p className="performance-note">
          Mapped volume load: {Math.round(stat.volumeLoadKg).toLocaleString()} kg × reps (loaded rep-range sets only).
          Compare it with this muscle in other periods, not with other muscles.
        </p>
      )}
    </div>
  )
}

export function MuscleBalance({ history }: { history: WorkoutRecord[] }) {
  const [period, setPeriod] = useState<MusclePeriod>('30d')
  const [selectedId, setSelectedId] = useState<MuscleId | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const result = useMemo(() => analyzeMuscleBalance(history, period, now), [history, period, now])
  const { current } = result
  const ranked = [...current.muscles].sort((a, b) => b.weightedSets - a.weightedSets)
  const selected = current.muscles.find((stat) => stat.muscle === selectedId) ?? ranked[0]
  const excludedNotes = [
    current.setsWithoutReps > 0
      ? `${current.setsWithoutReps} ticked ${current.setsWithoutReps === 1 ? 'set' : 'sets'} without reps ${current.setsWithoutReps === 1 ? 'was' : 'were'} not counted.`
      : null,
    current.designExcludedSets > 0
      ? `${current.designExcludedSets} ${current.designExcludedSets === 1 ? 'set' : 'sets'} from farmer carries or single-leg balance ${current.designExcludedSets === 1 ? 'is' : 'are'} left out by design.`
      : null,
    current.unmappedSets > 0
      ? `${current.unmappedSets} ${current.unmappedSets === 1 ? 'set' : 'sets'} from exercises without a muscle mapping (${current.unmappedExerciseNames.join(', ')}) ${current.unmappedSets === 1 ? 'was' : 'were'} not counted.`
      : null,
  ].filter((note): note is string => note !== null)

  return (
    <div className="performance-dashboard muscle-balance">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR PROGRESS · BALANCE</div>
          <h1>Muscle balance.</h1>
          <p className="page-subtitle">How your completed sets are spread across muscle groups.</p>
        </div>
        <div className="weekly-chip">TRAINING EXPOSURE</div>
      </div>

      <section className="performance-period-panel panel" aria-label="Muscle balance time period">
        <div>
          <div className="eyebrow">TIME PERIOD</div>
          <p>Choose the window to analyse</p>
        </div>
        <div className="performance-period-tabs">
          {periods.map((value) => (
            <button
              className={period === value ? 'selected' : ''}
              type="button"
              key={value}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {musclePeriodLabels[value]}
            </button>
          ))}
        </div>
      </section>

      {current.workoutCount === 0 ? (
        <section className="performance-panel panel">
          <div className="performance-empty">
            No completed workouts in this period. Muscle balance is built from completed sets saved on this device;
            cancelled and unfinished sessions are not included.
          </div>
        </section>
      ) : (
        <>
          <section className="performance-stat-grid" aria-label={`${musclePeriodLabels[period]} summary`}>
            <div className="performance-stat panel"><span>Workouts</span><strong>{current.workoutCount}</strong></div>
            <div className="performance-stat panel"><span>Counted sets</span><strong>{current.countedSets}</strong></div>
            <div className="performance-stat panel"><span>Training days</span><strong>{current.trainingDays}</strong></div>
          </section>

          <section className="performance-panel panel">
            <div className="performance-section-heading">
              <div>
                <div className="eyebrow">MUSCLE BALANCE RADAR</div>
                <h2>Where your sets went.</h2>
              </div>
            </div>
            <MuscleRadar stats={current.muscles} selected={selected.muscle} onSelect={setSelectedId} />
            <p className="performance-note">
              Each axis is weighted sets for that muscle relative to your highest muscle group in the period.
              Tap a point or label for details.
            </p>
            {result.lowConfidence && (
              <p className="performance-note muscle-caution">
                This view is based on {current.workoutCount} {current.workoutCount === 1 ? 'session' : 'sessions'}.
                Treat the shape as a rough guide.
              </p>
            )}
            <MuscleDetail stat={selected} result={result} />
          </section>

          <section className="performance-panel panel">
            <div className="performance-section-heading">
              <div>
                <div className="eyebrow">TRAINING DISTRIBUTION</div>
                <h2>Most to least exposure.</h2>
              </div>
            </div>
            <div className="muscle-rows">
              {ranked.map((stat) => {
                const none = stat.weightedSets === 0
                const low = result.lowMuscles.includes(stat.muscle)
                return (
                  <button
                    type="button"
                    key={stat.muscle}
                    className={`muscle-row ${stat.muscle === selected.muscle ? 'selected' : ''} ${none ? 'none' : low ? 'low' : ''}`}
                    aria-pressed={stat.muscle === selected.muscle}
                    onClick={() => setSelectedId(stat.muscle)}
                  >
                    <span className="muscle-row-name">
                      {stat.label}
                      {none && <em>None counted</em>}
                      {low && <em>Lower exposure</em>}
                    </span>
                    <span className="muscle-row-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(stat.relative * 100, none ? 0 : 3)}%` }} />
                    </span>
                    <span className="muscle-row-value">
                      {formatNumber(stat.setsPerWeek)} / wk · {formatPercent(stat.share)}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="performance-note">
              Weekly values are weighted sets divided by the number of weeks in the period. Shares add up to 100% across the ten groups.
              A trained day is a day when a muscle received at least 1 weighted set.
            </p>
          </section>

          <section className="performance-panel panel">
            <div className="performance-section-heading">
              <div>
                <div className="eyebrow">TRAINING INSIGHTS</div>
                <h2>What your records show.</h2>
              </div>
            </div>
            {result.insights.length === 0 ? (
              <div className="performance-empty">No notable patterns in this period.</div>
            ) : (
              <ul className="muscle-insights">
                {result.insights.map((insight) => (
                  <li key={insight.id} className={`muscle-insight muscle-insight-${insight.kind}`}>{insight.text}</li>
                ))}
              </ul>
            )}
            <p className="performance-note">
              Insights come only from completed sets in your saved history. They describe training exposure, not muscle size,
              strength or development. A lower score can reflect your programme, not a weakness.
            </p>
          </section>

          <section className="performance-panel panel">
            <div className="eyebrow">HOW THIS IS CALCULATED</div>
            <p className="performance-note muscle-method">
              Each completed set with reps counts toward every muscle the exercise works, scaled by how much it works that muscle
              (for example, a bench press set counts 1 for chest and 0.5 each for triceps and shoulders). Sets count equally
              regardless of load, so different muscles stay comparable. Effort, rest and technique are not recorded, and the
              contribution weights are estimates, not measurements.
            </p>
            {excludedNotes.length > 0 && (
              <ul className="muscle-exclusions">
                {excludedNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
