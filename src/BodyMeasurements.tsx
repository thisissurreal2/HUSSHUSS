import { useEffect, useState, type FormEvent } from 'react'
import {
  createEmptyMeasurementValues,
  createMeasurementId,
  readMeasurementData,
  writeMeasurementData,
  type MeasurementData,
  type MeasurementSession,
  type MeasurementValues,
} from './measurementStorage'

type MeasurementKey = keyof MeasurementValues
type MeasurementView = 'log' | 'history' | 'trends'
type DateRange = '30d' | '90d' | '1y' | 'all'

type MeasurementField = {
  key: MeasurementKey
  label: string
  unit: 'cm' | 'kg'
  instructions: string
  maximum: number
}

const fields: MeasurementField[] = [
  { key: 'neckCm', label: 'Neck', unit: 'cm', instructions: 'Measure just below the larynx. Keep the tape level and comfortably snug without tightening it.', maximum: 300 },
  { key: 'chestCm', label: 'Chest', unit: 'cm', instructions: 'Measure around the fullest part of the chest, keeping the tape level and breathing normally.', maximum: 300 },
  { key: 'waistCm', label: 'Waist', unit: 'cm', instructions: 'Measure halfway between the lowest rib and the top of the hip bone, after a normal exhale.', maximum: 300 },
  { key: 'shouldersCm', label: 'Shoulders', unit: 'cm', instructions: 'Measure around the widest circumference of the shoulders and upper torso, keeping the tape level.', maximum: 300 },
  { key: 'bicepsRelaxedCm', label: 'Biceps · relaxed', unit: 'cm', instructions: 'Measure the midpoint between shoulder and elbow with the arm hanging relaxed at your side.', maximum: 300 },
  { key: 'bicepsFlexedCm', label: 'Biceps · flexed', unit: 'cm', instructions: 'Measure the same midpoint as the relaxed measurement, with the arm flexed consistently.', maximum: 300 },
  { key: 'forearmsRelaxedCm', label: 'Forearms · relaxed', unit: 'cm', instructions: 'Measure around the widest part of the forearm with the arm relaxed.', maximum: 300 },
  { key: 'forearmsFlexedCm', label: 'Forearms · flexed', unit: 'cm', instructions: 'Measure around the widest part of the forearm while flexing consistently.', maximum: 300 },
  { key: 'thighCm', label: 'Thigh', unit: 'cm', instructions: 'Measure around the midpoint between the hip crease and kneecap, standing in the same position each time.', maximum: 300 },
  { key: 'calfCm', label: 'Calf', unit: 'cm', instructions: 'Measure around the widest part of the calf while standing evenly.', maximum: 300 },
  { key: 'bodyWeightKg', label: 'Body weight', unit: 'kg', instructions: 'Use a consistent scale and similar conditions when possible. Enter the displayed weight; nothing is estimated.', maximum: 500 },
]

const rangeLabels: Record<DateRange, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  all: 'All time',
}

function localDateValue(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDate(date: string): Date {
  return new Date(`${date}T12:00:00`)
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = parseDate(date)
  return Number.isFinite(parsed.getTime()) && localDateValue(parsed) === date
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(parseDate(date))
}

function formatValue(value: number, unit: 'cm' | 'kg'): string {
  return `${value.toFixed(1).replace(/\.0$/, '')} ${unit}`
}

function toFormValues(values: MeasurementValues): Record<MeasurementKey, string> {
  return Object.fromEntries(fields.map(({ key }) => [
    key,
    values[key] === null ? '' : String(values[key]),
  ])) as Record<MeasurementKey, string>
}

function parseFormValues(formValues: Record<MeasurementKey, string>): {
  values: MeasurementValues
  error: string | null
} {
  const values = createEmptyMeasurementValues()
  let hasValue = false
  for (const field of fields) {
    const raw = formValues[field.key].trim()
    if (!raw) continue
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
      return { values, error: `${field.label} must be a positive number with up to two decimal places.` }
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0 || value > field.maximum) {
      return { values, error: `${field.label} must be greater than 0 and no more than ${field.maximum} ${field.unit}.` }
    }
    values[field.key] = value
    hasValue = true
  }
  return hasValue
    ? { values, error: null }
    : { values, error: 'Enter at least one measurement before saving.' }
}

function MeasurementChart({
  values,
  range,
}: {
  values: { date: string; value: number }[]
  range: DateRange
}) {
  const [now] = useState(() => Date.now())
  const cutoff = range === 'all'
    ? null
    : new Date(now - Number.parseInt(range, 10) * (range === '1y' ? 365 : 1) * 24 * 60 * 60 * 1000)
  const points = values.filter((item) => cutoff === null || parseDate(item.date) >= cutoff)
  if (points.length === 0) {
    return <div className="measurement-chart-empty">No recorded values in this date range.</div>
  }

  const width = 640
  const height = 220
  const left = 52
  const right = 620
  const top = 18
  const bottom = 170
  const measurements = points.map((point) => point.value)
  const minimum = Math.min(...measurements)
  const maximum = Math.max(...measurements)
  const spread = maximum - minimum || Math.max(maximum * 0.1, 1)
  const minAxis = Math.max(0, minimum - spread * 0.18)
  const maxAxis = maximum + spread * 0.18
  const firstTime = parseDate(points[0].date).getTime()
  const lastTime = parseDate(points.at(-1)!.date).getTime()
  const coordinates = points.map((point) => ({
    ...point,
    x: firstTime === lastTime
      ? (left + right) / 2
      : left + ((parseDate(point.date).getTime() - firstTime) / (lastTime - firstTime)) * (right - left),
    y: bottom - ((point.value - minAxis) / (maxAxis - minAxis)) * (bottom - top),
  }))
  const labels = coordinates.length <= 3
    ? coordinates
    : [coordinates[0], coordinates[Math.floor((coordinates.length - 1) / 2)], coordinates.at(-1)!]

  return (
    <div className="measurement-chart-wrap">
      <svg
        className="measurement-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Recorded measurement chart with ${points.length} entries`}
      >
        {[0, 1, 2, 3].map((step) => {
          const y = top + (step / 3) * (bottom - top)
          const value = maxAxis - (step / 3) * (maxAxis - minAxis)
          return (
            <g key={step}>
              <line className="measurement-chart-grid" x1={left} x2={right} y1={y} y2={y} />
              <text className="measurement-chart-axis" x={left - 8} y={y + 3} textAnchor="end">
                {value.toFixed(1)}
              </text>
            </g>
          )
        })}
        {coordinates.length > 1 && (
          <polyline
            className="measurement-chart-line"
            points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')}
          />
        )}
        {coordinates.map((point) => (
          <circle className="measurement-chart-point" key={point.date} cx={point.x} cy={point.y} r="5">
            <title>{`${formatDate(point.date)} · ${point.value}`}</title>
          </circle>
        ))}
        {labels.map((point) => (
          <text className="measurement-chart-date" key={`date-${point.date}`} x={point.x} y={bottom + 24} textAnchor="middle">
            {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parseDate(point.date))}
          </text>
        ))}
      </svg>
    </div>
  )
}

function MeasurementComparison({
  sessions,
}: {
  sessions: MeasurementSession[]
}) {
  const ordered = [...sessions].sort((a, b) => b.date.localeCompare(a.date))
  const [requestedCurrentId, setCurrentId] = useState('')
  const [requestedPreviousId, setPreviousId] = useState('')
  const current = ordered.find((session) => session.id === requestedCurrentId) ?? ordered[0]
  const previous = ordered.find((session) => session.id === requestedPreviousId && session.id !== current?.id)
    ?? ordered.find((session) => session.id !== current?.id)

  return (
    <section className="measurement-panel">
      <div className="measurement-section-heading">
        <div><span className="eyebrow">DATE COMPARISON</span><h2>Compare entries</h2></div>
      </div>
      {ordered.length < 2 ? (
        <p className="measurement-muted">Record measurements on at least two dates to compare changes.</p>
      ) : (
        <>
          <div className="measurement-compare-selectors">
            <label>
              <span>Current entry</span>
              <select value={current?.id ?? ''} onChange={(event) => setCurrentId(event.target.value)}>
                {ordered.map((session) => <option key={session.id} value={session.id}>{formatDate(session.date)}</option>)}
              </select>
            </label>
            <label>
              <span>Compare with</span>
              <select value={previous?.id ?? ''} onChange={(event) => setPreviousId(event.target.value)}>
                {ordered.filter((session) => session.id !== current?.id).map((session) => (
                  <option key={session.id} value={session.id}>{formatDate(session.date)}</option>
                ))}
              </select>
            </label>
          </div>
          {current && previous && (
            <div className="measurement-compare-table-wrap">
              <table className="measurement-compare-table">
                <thead><tr><th>Measurement</th><th>{formatDate(previous.date)}</th><th>{formatDate(current.date)}</th><th>Difference</th></tr></thead>
                <tbody>
                  {fields.map((field) => {
                    const earlier = previous.values[field.key]
                    const later = current.values[field.key]
                    const difference = earlier !== null && later !== null ? later - earlier : null
                    return (
                      <tr key={field.key}>
                        <th scope="row">{field.label}</th>
                        <td>{earlier === null ? '—' : formatValue(earlier, field.unit)}</td>
                        <td>{later === null ? '—' : formatValue(later, field.unit)}</td>
                        <td>{difference === null ? '—' : `${difference > 0 ? '+' : ''}${formatValue(difference, field.unit)}`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="measurement-muted">A difference is shown only when both dates have a recorded value. Changes are presented neutrally.</p>
        </>
      )}
    </section>
  )
}

export function BodyMeasurements() {
  const [sessions, setSessions] = useState<MeasurementSession[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)
  const [dataReady, setDataReady] = useState(false)
  const [writeAvailable, setWriteAvailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<MeasurementView>('log')
  const [formValues, setFormValues] = useState<Record<MeasurementKey, string>>(() => (
    toFormValues(createEmptyMeasurementValues())
  ))
  const [date, setDate] = useState(localDateValue)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedMetric, setSelectedMetric] = useState<MeasurementKey>('waistCm')
  const [range, setRange] = useState<DateRange>('1y')

  useEffect(() => {
    let active = true
    void readMeasurementData().then((loaded) => {
      if (!active) return
      setSessions(loaded.data.sessions)
      setStorageError(loaded.error)
      setWriteAvailable(loaded.usable)
      setDataReady(true)
    })
    return () => { active = false }
  }, [])

  const sortedSessions = [...sessions].sort((a, b) => b.date.localeCompare(a.date))
  const selectedField = fields.find((field) => field.key === selectedMetric) ?? fields[0]
  const chartValues = [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((session) => {
      const value = session.values[selectedMetric]
      return value === null ? [] : [{ date: session.date, value }]
    })

  async function persist(next: MeasurementSession[]): Promise<boolean> {
    if (!dataReady || !writeAvailable || saving) return false
    const nextData: MeasurementData = { version: 1, sessions: next }
    setSaving(true)
    try {
      await writeMeasurementData(nextData)
      setSessions(next)
      setStorageError(null)
      return true
    } catch (error) {
      setStorageError(error instanceof Error
        ? `Measurements could not be saved to IndexedDB: ${error.message}`
        : 'Measurements could not be saved to IndexedDB.')
      return false
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setEditingId(null)
    setFormValues(toFormValues(createEmptyMeasurementValues()))
    setDate(localDateValue())
    setFormError(null)
  }

  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dataReady || !writeAvailable) return
    if (!isValidDate(date) || date > localDateValue()) {
      setFormError('Choose a valid date that is today or earlier.')
      return
    }
    const parsed = parseFormValues(formValues)
    if (parsed.error) {
      setFormError(parsed.error)
      return
    }
    const existingDate = sessions.find((session) => session.date === date && session.id !== editingId)
    if (existingDate) {
      setFormError(`An entry already exists for ${formatDate(date)}. Edit that entry to avoid duplicates.`)
      return
    }
    const timestamp = Date.now()
    const editing = sessions.find((session) => session.id === editingId)
    const nextSession: MeasurementSession = {
      id: editing?.id ?? createMeasurementId(),
      date,
      createdAt: editing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      values: parsed.values,
    }
    const next = editing
      ? sessions.map((session) => session.id === editing.id ? nextSession : session)
      : [nextSession, ...sessions]
    if (await persist(next)) resetForm()
  }

  function editSession(session: MeasurementSession) {
    setEditingId(session.id)
    setDate(session.date)
    setFormValues(toFormValues(session.values))
    setFormError(null)
    setView('log')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteSession(session: MeasurementSession) {
    if (!window.confirm(`Delete the measurement entry from ${formatDate(session.date)}? This cannot be undone.`)) return
    await persist(sessions.filter((item) => item.id !== session.id))
  }

  return (
    <div className="body-measurements-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">BODY MEASUREMENTS</div>
          <h1>Track your own numbers.</h1>
          <p className="page-subtitle">Manual measurements, kept privately on this device. No estimates.</p>
        </div>
      </div>

      <div className="measurement-view-tabs" role="group" aria-label="Measurement sections">
        {([
          ['log', 'Log measurements'],
          ['history', 'History & compare'],
          ['trends', 'Progress charts'],
        ] as const).map(([id, label]) => (
          <button type="button" aria-pressed={view === id} className={view === id ? 'selected' : ''} key={id} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      {storageError && <div className="measurement-alert" role="alert">{storageError}</div>}
      {!dataReady && <p className="measurement-muted" role="status">Loading measurements…</p>}

      {view === 'log' && (
        <section className="measurement-panel">
          <div className="measurement-section-heading">
            <div><span className="eyebrow">{editingId ? 'UPDATE ENTRY' : 'NEW ENTRY'}</span><h2>{editingId ? 'Edit measurements' : 'Measurement session'}</h2></div>
            {editingId && <button className="measurement-secondary-button" type="button" onClick={resetForm}>Cancel edit</button>}
          </div>
          <form onSubmit={(event) => { void saveSession(event) }} noValidate>
            <label className="measurement-date-field">
              <span>Measurement date</span>
              <input type="date" value={date} max={localDateValue()} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <div className="measurement-fields">
              {fields.map((field) => (
                <label className="measurement-field" key={field.key}>
                  <span>{field.label} <small>{field.unit}</small></span>
                  <div className="measurement-input-row">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.1"
                      max={field.maximum}
                      step="0.1"
                      placeholder="—"
                      value={formValues[field.key]}
                      onChange={(event) => {
                        setFormValues((current) => ({ ...current, [field.key]: event.target.value }))
                        setFormError(null)
                      }}
                      aria-label={`${field.label} in ${field.unit}`}
                    />
                    <span>{field.unit}</span>
                  </div>
                  <details className="measurement-help">
                    <summary>How to measure</summary>
                    <p>{field.instructions}</p>
                  </details>
                </label>
              ))}
            </div>
            <p className="measurement-muted">All fields are optional. Leave a field blank if you did not measure it. Circumferences use centimetres; body weight uses kilograms.</p>
            {formError && <div className="measurement-form-error" role="alert">{formError}</div>}
            <div className="measurement-form-actions">
              <button className="measurement-primary-button" type="submit" disabled={!dataReady || !writeAvailable || saving}>
                {editingId ? 'Save changes' : 'Save measurement session'}
              </button>
              {!editingId && <button className="measurement-secondary-button" type="button" onClick={resetForm}>Clear</button>}
            </div>
          </form>
        </section>
      )}

      {view === 'history' && (
        <div className="measurement-history-layout">
          <section className="measurement-panel">
            <div className="measurement-section-heading">
              <div><span className="eyebrow">SAVED ENTRIES</span><h2>Measurement history</h2></div>
              <span className="measurement-count">{sessions.length} {sessions.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            {sortedSessions.length === 0 ? (
              <div className="measurement-empty"><strong>No measurements saved yet</strong><span>Log a session whenever you choose; partial entries are welcome.</span></div>
            ) : (
              <div className="measurement-history-list">
                {sortedSessions.map((session) => (
                  <article className="measurement-history-card" key={session.id}>
                    <div className="measurement-history-top">
                      <div><span className="eyebrow">MEASUREMENT SESSION</span><h3>{formatDate(session.date)}</h3></div>
                      <div className="measurement-history-actions">
                        <button type="button" onClick={() => editSession(session)}>Edit</button>
                        <button type="button" className="measurement-delete-button" disabled={saving} onClick={() => { void deleteSession(session) }}>Delete</button>
                      </div>
                    </div>
                    <dl className="measurement-values-list">
                      {fields.map((field) => {
                        const value = session.values[field.key]
                        return value === null ? null : (
                          <div key={field.key}><dt>{field.label}</dt><dd>{formatValue(value, field.unit)}</dd></div>
                        )
                      })}
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
          <MeasurementComparison sessions={sessions} />
        </div>
      )}

      {view === 'trends' && (
        <section className="measurement-panel measurement-trends-panel">
          <div className="measurement-section-heading">
            <div><span className="eyebrow">RECORDED VALUES ONLY</span><h2>Progress over time</h2></div>
          </div>
          <div className="measurement-chart-controls">
            <label><span>Measurement</span>
              <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value as MeasurementKey)}>
                {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
              </select>
            </label>
            <label><span>Date range</span>
              <select value={range} onChange={(event) => setRange(event.target.value as DateRange)}>
                {(Object.keys(rangeLabels) as DateRange[]).map((key) => <option key={key} value={key}>{rangeLabels[key]}</option>)}
              </select>
            </label>
          </div>
          <div className="measurement-chart-heading">
            <strong>{selectedField.label}</strong><span>{selectedField.unit} · {chartValues.length} recorded {chartValues.length === 1 ? 'value' : 'values'}</span>
          </div>
          <MeasurementChart values={chartValues} range={range} />
          <div className="measurement-chart-summary">
            {chartValues.length > 0 && (
              <>
                <span>First recorded <strong>{formatValue(chartValues[0].value, selectedField.unit)}</strong></span>
                <span>Latest recorded <strong>{formatValue(chartValues.at(-1)!.value, selectedField.unit)}</strong></span>
              </>
            )}
          </div>
          <p className="measurement-muted">Only dates with an actual recorded value are plotted. Lines connect recorded entries; missing dates are not filled or estimated.</p>
        </section>
      )}
    </div>
  )
}
