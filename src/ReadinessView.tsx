import { useMemo, useState, type FormEvent } from 'react'
import {
  calculateReadinessScore, getReadinessCategory, getReadinessFactors, getReadinessTrends,
  getLocalDateKey, isValidRatings, type ReadinessCheckIn, type ReadinessRatings,
} from './readiness'
import { getReadinessInsights, type RecoverySession } from './readinessTraining'
import type { WorkoutRecord } from './workoutStorage'
import { RecoveryHistory } from './ReadinessActions'

const metrics: { key: keyof ReadinessRatings; label: string; low: string; high: string }[] = [
  { key: 'sleep', label: 'Sleep quality', low: 'Terrible', high: 'Excellent' },
  { key: 'energy', label: 'Energy', low: 'Exhausted', high: 'Very energetic' },
  { key: 'soreness', label: 'Muscle soreness', low: 'None', high: 'Severe' },
  { key: 'motivation', label: 'Motivation', low: 'Very low', high: 'Very high' },
  { key: 'stress', label: 'Stress', low: 'Very relaxed', high: 'Extremely stressed' },
]

function title(category: ReturnType<typeof getReadinessCategory>) {
  return category === 'ready' ? 'Ready to train' : category === 'caution' ? 'Train with caution' : 'Prioritise recovery'
}

export function ReadinessPage({ history, workouts, recoverySessions, onSave }: { history: ReadinessCheckIn[]; workouts: WorkoutRecord[]; recoverySessions: RecoverySession[]; onSave: (ratings: ReadinessRatings) => Promise<boolean> }) {
  const today = getLocalDateKey()
  const existing = history.find((entry) => entry.date === today)
  const [ratings, setRatings] = useState<ReadinessRatings>(() => existing
    ? { sleep: existing.sleep, energy: existing.energy, soreness: existing.soreness, motivation: existing.motivation, stress: existing.stress }
    : { sleep: 3, energy: 3, soreness: 3, motivation: 3, stress: 3 })
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const trends = useMemo(() => getReadinessTrends(history, today), [history, today])
  const insights = useMemo(() => getReadinessInsights(history, workouts, today), [history, workouts, today])
  const score = isValidRatings(ratings) ? calculateReadinessScore(ratings) : 0
  const category = getReadinessCategory(score)
  const recommendation = category === 'ready'
    ? 'Follow today’s scheduled workout at planned intensity and keep normal rest periods.'
    : category === 'caution'
      ? 'Consider reducing working weight or total volume. Skip unnecessary failure sets and focus on technique.'
      : 'Choose gentle mobility, light activity, or a recovery day. Later sessions remain on their scheduled weekdays.'
  const factors = getReadinessFactors(ratings)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!isValidRatings(ratings) || saving) return
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      if (await onSave(ratings)) setSaved(true)
      else setSaveError('Check-in could not be saved. Your ratings are still here; please try again.')
    } catch {
      setSaveError('Check-in could not be saved. Your ratings are still here; please try again.')
    } finally { setSaving(false) }
  }

  return <section className="readiness-page">
    <div className="page-heading">
      <div><div className="eyebrow">DAILY READINESS · {today}</div><h1>Check in with yourself.</h1><p className="page-subtitle">A quick reflection to help shape today’s training.</p></div>
    </div>
    <div className={`readiness-result readiness-${category}`}>
      <div><span className="eyebrow">TODAY’S READINESS</span><strong>{score}<small>/100</small></strong><b>{title(category)}</b></div>
      <p>{recommendation}</p>
    </div>
    <form className="readiness-form" onSubmit={submit}>
      <div className="readiness-form-heading"><div><span className="eyebrow">FIVE QUICK RATINGS</span><h2>{existing ? 'Update today’s check-in' : 'How are you feeling?'}</h2></div><span>1 LOW · 5 HIGH</span></div>
      {metrics.map((metric) => <fieldset className="readiness-metric" key={metric.key}>
        <legend>{metric.label}</legend>
        <div className="readiness-scale" role="group" aria-label={metric.label}>
          {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-pressed={ratings[metric.key] === value} className={ratings[metric.key] === value ? 'selected' : ''} onClick={() => setRatings((current) => ({ ...current, [metric.key]: value }))}>{value}</button>)}
        </div>
        <div className="readiness-range"><span>{metric.low}</span><span>{metric.high}</span></div>
      </fieldset>)}
      <button className="button-primary" type="submit" disabled={saving}>{saving ? 'SAVING…' : existing ? 'UPDATE CHECK-IN' : 'SAVE CHECK-IN'} <span aria-hidden="true">→</span></button>
      {saved && <span className="readiness-saved" role="status">Saved for today. You can update it any time.</span>}
      {saveError && <span className="recovery-form-error" role="alert">{saveError}</span>}
    </form>
    <section className="readiness-history">
      <div className="readiness-history-heading"><div><span className="eyebrow">YOUR RECOVERY PATTERN</span><h2>Readiness history</h2></div><span>{trends.completedDays} check-in{trends.completedDays === 1 ? '' : 's'}</span></div>
      {history.length === 0 ? <p className="readiness-empty">Your trend and averages will appear after your first check-in.</p> : <>
        <div className="readiness-stats">{[['7-day average', trends.average7], ['30-day average', trends.average30], ['All-time average', trends.average], ['Highest', trends.highest], ['Lowest', trends.lowest]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}{value !== null && <small>/100</small>}</strong></div>)}</div>
        {[['7-day trend', trends.days7], ['30-day trend', trends.days30]].map(([label, entries]) => <div className="readiness-trend" key={label as string}><div className="readiness-trend-title"><strong>{label as string}</strong><span>{(entries as ReadinessCheckIn[]).length} days logged</span></div>{(entries as ReadinessCheckIn[]).length < 2 ? <p>{(entries as ReadinessCheckIn[]).length === 0 ? 'No check-ins in this window.' : 'Log another day to see a trend.'}</p> : <div className="readiness-bars" role="img" aria-label={`${label as string} readiness scores`}>
          {(entries as ReadinessCheckIn[]).map((entry) => <div className="readiness-bar-item" key={entry.date} title={`${entry.date}: ${entry.score}`}><span>{entry.score}</span><i style={{ height: `${Math.max(6, entry.score)}%` }} /><small>{entry.date.slice(5)}</small></div>)}
        </div>}</div>)}
        <div className="readiness-records"><h3>Previous check-ins</h3>{history.slice(0, 30).map((entry) => <div className="readiness-record" key={entry.date}><strong>{entry.date}</strong><b>{entry.score}<small>/100</small></b><span>Sleep {entry.sleep} · Energy {entry.energy} · Soreness {entry.soreness} · Motivation {entry.motivation} · Stress {entry.stress}</span></div>)}</div>
      </>}
      <div className="readiness-insights"><h3>Patterns from your check-ins</h3>{insights.length
        ? insights.map((insight) => <p key={insight.id}>{insight.text}</p>)
        : <p>More check-ins and completed workouts are needed before patterns can be shown. No conclusions are drawn from sparse data.</p>}</div>
      <div className="readiness-recovery-history"><h3>Recovery days · separate from workouts</h3><RecoveryHistory sessions={recoverySessions} /></div>
      <p className="readiness-disclaimer">A personal training guide, not a medical assessment or diagnosis.</p>
    </section>
    <div className="readiness-factor-note"><span className="eyebrow">SCORE FACTORS · FROM A NEUTRAL 50</span>{factors.map((factor) => <span key={factor.label}>{factor.label} {factor.weight} <b>{factor.contribution >= 0 ? '+' : ''}{factor.contribution}</b></span>)}</div>
  </section>
}
