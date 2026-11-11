import { useState, type FormEvent } from 'react'
import {
  athleticCategories,
  athleticUnitLabel,
  builtInAssessments,
  createAthleticId,
  readAthleticData,
  writeAthleticData,
  type AssessmentDefinition,
  type AthleticCategoryId,
  type AthleticData,
  type AthleticMetric,
  type AthleticRecord,
  type AthleticUnit,
  type PerformanceDirection,
} from './athleticStorage'

type View = 'overview' | 'assessments' | 'log'
type CustomUnit = AthleticUnit

const customUnits: { value: CustomUnit; label: string; maximum: number }[] = [
  { value: 'reps', label: 'Repetitions', maximum: 10000 },
  { value: 'seconds', label: 'Seconds', maximum: 86400 },
  { value: 'kg', label: 'Kilograms', maximum: 1000 },
  { value: 'm', label: 'Metres', maximum: 100000 },
  { value: 'km', label: 'Kilometres', maximum: 1000 },
  { value: 'cm', label: 'Centimetres', maximum: 100000 },
  { value: 'score', label: 'Score', maximum: 1000000 },
]

const categoryEmptyCopy: Record<AthleticCategoryId, string> = {
  strength: 'Log a repetition test such as push-ups or pull-ups.',
  core: 'Record a plank or another core endurance test.',
  grip: 'Track a carry with any combination of load, time, or distance.',
  balance: 'Record left and right sides independently.',
  conditioning: 'Record a run distance and/or duration; pace appears when both are available.',
  agility: 'Log a timed drill when you choose to perform one.',
  power: 'Track jumps, sprints, or another explosive performance test.',
}

function localDateValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDate(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parseDate(date))
}

function formatValue(value: number, metric: AthleticMetric): string {
  if (metric.key === 'paceSecondsPerKm') {
    const minutes = Math.floor(value / 60)
    const seconds = Math.round(value % 60).toString().padStart(2, '0')
    return `${minutes}:${seconds} min/km`
  }
  const formatted = Number(value.toFixed(2)).toString()
  return `${formatted} ${athleticUnitLabel(metric.unit)}`
}

function formatDifference(value: number, metric: AthleticMetric): string {
  if (metric.key === 'paceSecondsPerKm') {
    const magnitude = Math.abs(value)
    const minutes = Math.floor(magnitude / 60)
    const seconds = Math.round(magnitude % 60).toString().padStart(2, '0')
    return `${value > 0 ? '+' : value < 0 ? '−' : ''}${minutes}:${seconds} min/km`
  }
  return `${value > 0 ? '+' : ''}${formatValue(value, metric)}`
}

function currentTimestamp(): number {
  return Date.now()
}

function metricValue(record: AthleticRecord, metric: AthleticMetric): number | null {
  if (metric.derived === 'pace' || metric.key === 'paceSecondsPerKm') {
    const distance = record.values.distanceKm
    const duration = record.values.durationSeconds
    return distance && duration ? duration / distance : null
  }
  return record.values[metric.key] ?? null
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = parseDate(date)
  return Number.isFinite(parsed.getTime()) && localDateValue(parsed) === date
}

function getBest(records: AthleticRecord[], metric: AthleticMetric): { record: AthleticRecord; value: number } | null {
  let best: { record: AthleticRecord; value: number } | null = null
  for (const record of records) {
    const value = metricValue(record, metric)
    if (value === null) continue
    if (!best || (metric.direction === 'higher' ? value > best.value : value < best.value)) {
      best = { record, value }
    }
  }
  return best
}

function getAssessmentMetrics(assessment: AssessmentDefinition, records: AthleticRecord[]): AthleticMetric[] {
  const metrics = [...assessment.metrics]
  if (assessment.id === 'timed-run'
    && records.some((record) => record.values.distanceKm && record.values.durationSeconds)) {
    metrics.push({
      key: 'paceSecondsPerKm',
      label: 'Average pace',
      unit: 'seconds',
      direction: 'lower',
      maximum: 86400,
      derived: 'pace',
    })
  }
  return metrics
}

function ResultChart({
  records,
  metric,
}: {
  records: AthleticRecord[]
  metric: AthleticMetric
}) {
  const points = [...records]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .flatMap((record) => {
      const value = metricValue(record, metric)
      return value === null ? [] : [{ record, value }]
    })
  if (points.length === 0) {
    return <div className="athletic-chart-empty">No recorded results for this metric yet.</div>
  }

  const left = 54
  const right = 618
  const top = 18
  const bottom = 170
  const values = points.map((point) => point.value)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const spread = maximum - minimum || Math.max(maximum * 0.1, 1)
  const minAxis = Math.max(0, minimum - spread * 0.18)
  const maxAxis = maximum + spread * 0.18
  const firstTime = parseDate(points[0].record.date).getTime()
  const lastTime = parseDate(points.at(-1)!.record.date).getTime()
  const coordinates = points.map((point, index) => ({
    ...point,
    x: firstTime === lastTime
      ? points.length === 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left)
      : left + ((parseDate(point.record.date).getTime() - firstTime) / (lastTime - firstTime)) * (right - left),
    y: bottom - ((point.value - minAxis) / (maxAxis - minAxis)) * (bottom - top),
  }))
  const labels = coordinates.length <= 3
    ? coordinates
    : [coordinates[0], coordinates[Math.floor((coordinates.length - 1) / 2)], coordinates.at(-1)!]

  return (
    <div className="athletic-chart-wrap">
      <svg className="athletic-chart" viewBox="0 0 640 220" role="img" aria-label={`${metric.label} chart with ${points.length} recorded results`}>
        {[0, 1, 2, 3].map((step) => {
          const y = top + (step / 3) * (bottom - top)
          const value = maxAxis - (step / 3) * (maxAxis - minAxis)
          return (
            <g key={step}>
              <line className="athletic-chart-grid" x1={left} x2={right} y1={y} y2={y} />
              <text className="athletic-chart-axis" x={left - 8} y={y + 3} textAnchor="end">
                {Number(value.toFixed(2)).toString()}
              </text>
            </g>
          )
        })}
        {coordinates.length > 1 && (
          <polyline className="athletic-chart-line" points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')} />
        )}
        {coordinates.map((point) => (
          <circle className="athletic-chart-point" key={point.record.id} cx={point.x} cy={point.y} r="5">
            <title>{`${formatDate(point.record.date)} · ${formatValue(point.value, metric)}`}</title>
          </circle>
        ))}
        {labels.map((point) => (
          <text className="athletic-chart-date" key={`date-${point.record.id}`} x={point.x} y={bottom + 24} textAnchor="middle">
            {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parseDate(point.record.date))}
          </text>
        ))}
      </svg>
    </div>
  )
}

function ResultSummary({
  records,
  metric,
}: {
  records: AthleticRecord[]
  metric: AthleticMetric
}) {
  const measured = [...records]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .flatMap((record) => {
      const value = metricValue(record, metric)
      return value === null ? [] : [{ record, value }]
    })
  const latest = measured.at(-1)?.value ?? null
  const previous = measured.at(-2)?.value ?? null
  const best = getBest(records, metric)
  const difference = latest !== null && previous !== null ? latest - previous : null
  const improved = difference !== null && (metric.direction === 'higher' ? difference > 0 : difference < 0)

  return (
    <div className="athletic-summary-grid">
      <div><span className="eyebrow">LATEST</span><strong>{latest === null ? '—' : formatValue(latest, metric)}</strong></div>
      <div><span className="eyebrow">PREVIOUS</span><strong>{previous === null ? '—' : formatValue(previous, metric)}</strong></div>
      <div><span className="eyebrow">BEST RECORDED</span><strong>{best ? formatValue(best.value, metric) : '—'}</strong></div>
      <div>
        <span className="eyebrow">CHANGE VS PREVIOUS</span>
        <strong className={improved ? 'athletic-improvement' : ''}>
          {difference === null ? '—' : formatDifference(difference, metric)}
          {improved && <small> · improvement</small>}
        </strong>
      </div>
    </div>
  )
}

function AssessmentHistory({
  records,
  definition,
  onEdit,
  onDelete,
}: {
  records: AthleticRecord[]
  definition: AssessmentDefinition
  onEdit: (record: AthleticRecord) => void
  onDelete: (record: AthleticRecord) => void
}) {
  const metrics = definition.metrics.filter((metric) => metric.derived !== 'pace')
  const ordered = [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  return (
    <div className="athletic-history-list">
      {ordered.map((record) => (
        <article className="athletic-history-card" key={record.id}>
          <div className="athletic-history-head">
            <div><span className="eyebrow">ASSESSMENT</span><h3>{formatDate(record.date)}</h3></div>
            <div className="athletic-history-actions">
              <button type="button" onClick={() => onEdit(record)}>Edit</button>
              <button type="button" className="athletic-delete-button" onClick={() => onDelete(record)}>Delete</button>
            </div>
          </div>
          <dl className="athletic-result-list">
            {metrics.flatMap((metric) => {
              const value = record.values[metric.key]
              return value === undefined ? [] : (
                <div key={metric.key}><dt>{metric.label}</dt><dd>{formatValue(value, metric)}</dd></div>
              )
            })}
          </dl>
          {record.notes && <p className="athletic-record-notes">{record.notes}</p>}
        </article>
      ))}
    </div>
  )
}

export function AthleticDevelopment() {
  const [loaded] = useState(readAthleticData)
  const [athleticData, setAthleticData] = useState(loaded.data)
  const [storageError, setStorageError] = useState<string | null>(loaded.error)
  const [view, setView] = useState<View>('overview')
  const [category, setCategory] = useState<AthleticCategoryId>('strength')
  const [assessmentId, setAssessmentId] = useState('max-push-ups')
  const [selectedMetricKey, setSelectedMetricKey] = useState('reps')
  const [date, setDate] = useState(localDateValue)
  const [notes, setNotes] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [creatingCustom, setCreatingCustom] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customUnit, setCustomUnit] = useState<CustomUnit>('reps')
  const [customDirection, setCustomDirection] = useState<PerformanceDirection>('higher')

  const definitions = [...builtInAssessments, ...athleticData.customAssessments]
  const categoryDefinitions = definitions.filter((definition) => definition.category === category)
  const selectedAssessment = categoryDefinitions.find((definition) => definition.id === assessmentId)
    ?? categoryDefinitions[0]
  const assessmentRecords = selectedAssessment
    ? athleticData.records.filter((record) => record.assessmentId === selectedAssessment.id)
    : []
  const chartMetrics = selectedAssessment ? getAssessmentMetrics(selectedAssessment, assessmentRecords) : []
  const metricForChart = chartMetrics.find((metric) => metric.key === selectedMetricKey) ?? chartMetrics[0]

  function persist(next: AthleticData): boolean {
    try {
      writeAthleticData(next)
      setAthleticData(next)
      setStorageError(null)
      return true
    } catch {
      setStorageError('Athletic assessment data could not be saved to this browser. Check available storage and try again.')
      return false
    }
  }

  function changeCategory(next: AthleticCategoryId) {
    setCategory(next)
    const first = definitions.find((definition) => definition.category === next)
    setAssessmentId(first?.id ?? '')
    setSelectedMetricKey(first?.metrics[0]?.key ?? '')
    setCreatingCustom(false)
  }

  function resetForm() {
    setEditingId(null)
    setValues({})
    setDate(localDateValue())
    setNotes('')
    setFormError(null)
    setCreatingCustom(false)
    setCustomName('')
    setCustomUnit('reps')
    setCustomDirection('higher')
  }

  function editRecord(record: AthleticRecord) {
    setCategory(record.category)
    setAssessmentId(record.assessmentId)
    setSelectedMetricKey(Object.keys(record.values)[0] ?? '')
    setValues(Object.fromEntries(Object.entries(record.values).map(([key, value]) => [key, String(value)])))
    setDate(record.date)
    setNotes(record.notes)
    setEditingId(record.id)
    setCreatingCustom(false)
    setFormError(null)
    setView('log')
  }

  function deleteRecord(record: AthleticRecord) {
    if (!window.confirm(`Delete the ${record.assessmentName} result from ${formatDate(record.date)}? This cannot be undone.`)) return
    persist({ ...athleticData, records: athleticData.records.filter((item) => item.id !== record.id) })
  }

  function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (storageError) return
    if (!isValidDate(date) || date > localDateValue()) {
      setFormError('Choose a valid date that is today or earlier.')
      return
    }

    let definition = selectedAssessment
    let customAssessment: AssessmentDefinition | null = null
    if (creatingCustom) {
      const name = customName.trim()
      if (!name || name.length > 80) {
        setFormError('Enter a custom assessment name of 1–80 characters.')
        return
      }
      if (definitions.some((item) => item.category === category && item.name.toLowerCase() === name.toLowerCase())) {
        setFormError('An assessment with that name already exists in this category.')
        return
      }
      const unit = customUnits.find((item) => item.value === customUnit)
      if (!unit) {
        setFormError('Choose a valid unit for the custom assessment.')
        return
      }
      customAssessment = {
        id: createAthleticId(),
        category,
        name,
        custom: true,
        metrics: [{
          key: 'result',
          label: 'Result',
          unit: customUnit,
          direction: customDirection,
          maximum: unit.maximum,
        }],
      }
      definition = customAssessment
    }
    if (!definition) {
      setFormError('Choose or create an assessment before saving.')
      return
    }

    const nextValues: Record<string, number> = {}
    for (const item of definition.metrics.filter((metric) => !metric.derived)) {
      const raw = values[item.key]?.trim() ?? ''
      if (!raw) continue
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw)
        || (item.unit === 'reps' && !/^\d+$/.test(raw))) {
        setFormError(item.unit === 'reps'
          ? `${item.label} must be a positive whole number.`
          : `${item.label} must be a positive number with up to two decimal places.`)
        return
      }
      const result = Number(raw)
      if (!Number.isFinite(result) || result <= 0 || result > item.maximum) {
        setFormError(`${item.label} must be greater than 0 and no more than ${item.maximum} ${athleticUnitLabel(item.unit)}.`)
        return
      }
      nextValues[item.key] = result
    }
    if (Object.keys(nextValues).length === 0) {
      setFormError('Enter at least one result before saving.')
      return
    }
    if (definition.id === 'timed-run'
      && nextValues.distanceKm !== undefined
      && nextValues.durationSeconds !== undefined
      && nextValues.distanceKm <= 0) {
      setFormError('Running distance must be greater than zero to calculate pace.')
      return
    }

    const duplicate = athleticData.records.find((record) => (
      record.id !== editingId
      && record.assessmentId === definition?.id
      && record.date === date
      && JSON.stringify(record.values) === JSON.stringify(nextValues)
    ))
    if (duplicate) {
      setFormError('An identical result for this assessment and date already exists.')
      return
    }
    const timestamp = currentTimestamp()
    const existing = athleticData.records.find((record) => record.id === editingId)
    const nextRecord: AthleticRecord = {
      id: existing?.id ?? createAthleticId(),
      assessmentId: definition.id,
      assessmentName: definition.name,
      category,
      date,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      values: nextValues,
      notes: notes.trim(),
    }
    const next: AthleticData = {
      ...athleticData,
      customAssessments: customAssessment
        ? [...athleticData.customAssessments, customAssessment]
        : athleticData.customAssessments,
      records: existing
        ? athleticData.records.map((record) => record.id === existing.id ? nextRecord : record)
        : [nextRecord, ...athleticData.records],
    }
    if (persist(next)) {
      setAssessmentId(definition.id)
      setCreatingCustom(false)
      setView('assessments')
      resetForm()
    }
  }

  function recordsForCategory(categoryId: AthleticCategoryId): AthleticRecord[] {
    return athleticData.records.filter((record) => record.category === categoryId)
  }

  function getRecentImprovement(categoryId: AthleticCategoryId): string | null {
    const categoryRecords = recordsForCategory(categoryId)
    const categoryAssessments = definitions.filter((definition) => definition.category === categoryId)
    for (const definition of categoryAssessments) {
      const records = categoryRecords
        .filter((record) => record.assessmentId === definition.id)
        .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
      for (const item of getAssessmentMetrics(definition, records)) {
        const measured = records.flatMap((record) => {
          const value = metricValue(record, item)
          return value === null ? [] : [value]
        })
        if (measured.length < 2) continue
        const latest = measured.at(-1)!
        const previous = measured.at(-2)!
        if (latest === null || previous === null) continue
        if (item.direction === 'higher' ? latest > previous : latest < previous) {
          return `${definition.name}: ${item.label} improved`
        }
      }
    }
    return null
  }

  const displayedRecords = [...assessmentRecords]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  const logDefinition = creatingCustom
    ? null
    : definitions.find((definition) => definition.id === assessmentId && definition.category === category)
  const customUnitConfig = customUnits.find((item) => item.value === customUnit) ?? customUnits[0]

  return (
    <div className="athletic-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ATHLETIC DEVELOPMENT</div>
          <h1>Track your capabilities.</h1>
          <p className="page-subtitle">Personal performance indicators, not a single score or a required training plan.</p>
        </div>
      </div>
      <div className="athletic-view-tabs" role="group" aria-label="Athletic development sections">
        {([
          ['overview', 'Overview'],
          ['assessments', 'Assessments'],
          ['log', 'Log result'],
        ] as const).map(([id, label]) => (
          <button type="button" aria-pressed={view === id} className={view === id ? 'selected' : ''} key={id} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>
      {storageError && <div className="athletic-alert" role="alert">{storageError}</div>}

      {view === 'overview' && (
        <>
          <section className="athletic-panel">
            <div className="athletic-section-heading">
              <div><span className="eyebrow">SEVEN PERFORMANCE AREAS</span><h2>Your assessment map</h2></div>
              <button className="athletic-text-button" type="button" onClick={() => setView('log')}>Log an assessment</button>
            </div>
            <div className="athletic-category-grid">
              {athleticCategories.map((item) => {
                const records = recordsForCategory(item.id)
                const latest = [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0]
                const improvement = getRecentImprovement(item.id)
                return (
                  <button
                    className={`athletic-category-card ${records.length ? 'has-records' : ''}`}
                    type="button"
                    key={item.id}
                    onClick={() => {
                      changeCategory(item.id)
                      setView(records.length ? 'assessments' : 'log')
                    }}
                  >
                    <span className="eyebrow">{records.length ? 'RECORDED' : 'NOT ASSESSED'}</span>
                    <strong>{item.label}</strong>
                    <span>{latest ? `Last assessment · ${formatDate(latest.date)}` : categoryEmptyCopy[item.id]}</span>
                    {improvement && <small>{improvement}</small>}
                  </button>
                )
              })}
            </div>
            <p className="athletic-muted">Categories summarize recorded tests only. No overall athletic score is calculated.</p>
          </section>
          <section className="athletic-panel">
            <div className="athletic-section-heading">
              <div><span className="eyebrow">RECENT ACTIVITY</span><h2>Latest assessments</h2></div>
            </div>
            {athleticData.records.length === 0 ? (
              <div className="athletic-empty"><strong>No assessment results yet</strong><span>Choose any test that suits you; assessments are optional and independent.</span></div>
            ) : (
              <div className="athletic-recent-list">
                {[...athleticData.records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 6).map((record) => (
                  <button
                    type="button"
                    className="athletic-recent-row"
                    key={record.id}
                    onClick={() => {
                      setCategory(record.category)
                      setAssessmentId(record.assessmentId)
                      setView('assessments')
                    }}
                  >
                    <span><strong>{record.assessmentName}</strong><small>{athleticCategories.find((item) => item.id === record.category)?.label}</small></span>
                    <time>{formatDate(record.date)}</time>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {view === 'assessments' && (
        <>
          <section className="athletic-panel">
            <div className="athletic-section-heading">
              <div><span className="eyebrow">ASSESSMENT HISTORY</span><h2>Explore a test</h2></div>
            </div>
            <div className="athletic-select-grid">
              <label><span>Category</span>
                <select value={category} onChange={(event) => changeCategory(event.target.value as AthleticCategoryId)}>
                  {athleticCategories.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label><span>Assessment</span>
                <select value={selectedAssessment?.id ?? ''} onChange={(event) => {
                  setAssessmentId(event.target.value)
                  const selected = categoryDefinitions.find((item) => item.id === event.target.value)
                  setSelectedMetricKey(selected?.metrics[0]?.key ?? '')
                }}>
                  {categoryDefinitions.map((definition) => <option value={definition.id} key={definition.id}>{definition.name}</option>)}
                </select>
              </label>
            </div>
            {selectedAssessment && assessmentRecords.length > 0 && (
              <>
                <div className="athletic-chart-controls">
                  <label><span>Result metric</span>
                    <select value={metricForChart?.key ?? ''} onChange={(event) => setSelectedMetricKey(event.target.value)}>
                      {chartMetrics.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
                    </select>
                  </label>
                </div>
                {metricForChart && <ResultSummary records={assessmentRecords} metric={metricForChart} />}
                {metricForChart && <ResultChart records={assessmentRecords} metric={metricForChart} />}
                <div className="athletic-section-heading athletic-history-title">
                  <div><span className="eyebrow">SAVED RESULTS</span><h2>History</h2></div>
                  <button type="button" className="athletic-text-button" onClick={() => setView('log')}>Add result</button>
                </div>
                <AssessmentHistory records={displayedRecords} definition={selectedAssessment} onEdit={editRecord} onDelete={deleteRecord} />
              </>
            )}
            {selectedAssessment && assessmentRecords.length === 0 && (
              <div className="athletic-empty">
                <strong>No results for {selectedAssessment.name}</strong>
                <span>{categoryEmptyCopy[category]}</span>
                <button className="athletic-primary-button" type="button" onClick={() => setView('log')}>Log first result</button>
              </div>
            )}
          </section>
        </>
      )}

      {view === 'log' && (
        <section className="athletic-panel">
          <div className="athletic-section-heading">
            <div><span className="eyebrow">{editingId ? 'EDIT RESULT' : 'OPTIONAL TEST'}</span><h2>{editingId ? 'Update assessment' : 'Log an assessment'}</h2></div>
            {editingId && <button className="athletic-text-button" type="button" onClick={resetForm}>Cancel edit</button>}
          </div>
          <form onSubmit={saveRecord} noValidate>
            <div className="athletic-select-grid">
              <label><span>Category</span>
                <select value={category} onChange={(event) => changeCategory(event.target.value as AthleticCategoryId)} disabled={Boolean(editingId)}>
                  {athleticCategories.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label><span>Assessment</span>
                <select value={creatingCustom ? '__custom__' : logDefinition?.id ?? ''} onChange={(event) => {
                  setFormError(null)
                  setCreatingCustom(event.target.value === '__custom__')
                  if (event.target.value !== '__custom__') setAssessmentId(event.target.value)
                  setValues({})
                  setCustomName('')
                }} disabled={Boolean(editingId)}>
                  {categoryDefinitions.map((definition) => <option value={definition.id} key={definition.id}>{definition.name}</option>)}
                  <option value="__custom__">Create custom assessment…</option>
                </select>
              </label>
            </div>
            {creatingCustom && (
              <div className="athletic-custom-fields">
                <label><span>Assessment name</span><input value={customName} maxLength={80} onChange={(event) => setCustomName(event.target.value)} placeholder="e.g. Standing broad jump" /></label>
                <label><span>Result unit</span><select value={customUnit} onChange={(event) => setCustomUnit(event.target.value as CustomUnit)}>{customUnits.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
                <label><span>Better result</span><select value={customDirection} onChange={(event) => setCustomDirection(event.target.value as PerformanceDirection)}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label>
              </div>
            )}
            <label className="athletic-date-field"><span>Assessment date</span><input type="date" value={date} max={localDateValue()} onChange={(event) => setDate(event.target.value)} required /></label>
            <div className="athletic-result-fields">
              {(creatingCustom ? [{
                key: 'result',
                label: 'Result',
                unit: customUnit,
                direction: customDirection,
                maximum: customUnitConfig.maximum,
              } satisfies AthleticMetric] : (logDefinition?.metrics ?? []).filter((item) => !item.derived)).map((item) => (
                <label className="athletic-result-field" key={item.key}>
                  <span>{item.label} <small>{athleticUnitLabel(item.unit)}</small></span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max={item.maximum}
                    step={item.unit === 'reps' ? '1' : '0.01'}
                    placeholder="—"
                    value={values[item.key] ?? ''}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [item.key]: event.target.value }))
                      setFormError(null)
                    }}
                    aria-label={`${item.label} in ${athleticUnitLabel(item.unit)}`}
                  />
                </label>
              ))}
            </div>
            {logDefinition?.id === 'timed-run' && <p className="athletic-muted">Average pace is calculated only when both distance and duration are recorded for the same run.</p>}
            <label className="athletic-notes-field"><span>Notes <small>Optional</small></span><textarea rows={3} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Conditions, route, technique, or other context" /></label>
            <p className="athletic-muted">You can leave any metric blank. Record assessments independently; there is no schedule or target to complete.</p>
            {formError && <div className="athletic-form-error" role="alert">{formError}</div>}
            <div className="athletic-form-actions">
              <button type="submit" className="athletic-primary-button" disabled={Boolean(storageError)}>{editingId ? 'Save changes' : 'Save result'}</button>
              {!editingId && <button type="button" className="athletic-secondary-button" onClick={resetForm}>Clear</button>}
            </div>
          </form>
        </section>
      )}
    </div>
  )
}
