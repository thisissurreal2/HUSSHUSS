import { useState, type FormEvent } from 'react'
import type { Workout } from './workouts'
import type { ActiveWorkout } from './workoutStorage'
import { getTrainingRecommendation, createScaledWorkout, recoveryActivities, type RecoveryActivity, type RecoverySession } from './readinessTraining'
import type { ReadinessCheckIn } from './readiness'

export function ReadinessDecisionPanel({ checkIn, workout, activeWorkout, onOpenCheckIn, onStartScaled, onSaveRecovery }: {
  checkIn?: ReadinessCheckIn
  workout: Workout
  activeWorkout: ActiveWorkout | null
  onOpenCheckIn: () => void
  onStartScaled: () => void
  onSaveRecovery: (activity: RecoveryActivity, duration: number | null, notes: string) => Promise<boolean>
}) {
  const recommendation = getTrainingRecommendation(checkIn)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoverySaved, setRecoverySaved] = useState(false)
  const scaled = recommendation.category === 'caution' ? createScaledWorkout(workout) : null
  const originalSets = workout.exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0)
  const scaledSets = scaled?.exercises.reduce((sum, exercise) => sum + exercise.targetSets, 0) ?? originalSets

  return <section className={`readiness-decision readiness-decision-${recommendation.category}`} aria-labelledby="readiness-recommendation-title">
    <div className="readiness-decision-top">
      <div><span className="eyebrow">TODAY’S TRAINING CALL</span><h2 id="readiness-recommendation-title">{recommendation.label}</h2><p>{recommendation.explanation}</p></div>
      <strong className="readiness-decision-score">{checkIn ? checkIn.score : '—'}<small>{checkIn ? '/100' : 'NO CHECK-IN'}</small></strong>
    </div>
    {checkIn ? <div className="readiness-decision-meta"><b>{recommendation.category === 'ready' ? 'READY TO TRAIN' : recommendation.category === 'caution' ? 'TRAIN WITH CAUTION' : 'RECOVERY RANGE'}</b><span>{recommendation.factors.join(' · ')}</span></div> : null}
    <button className="button-text readiness-checkin-link" type="button" onClick={onOpenCheckIn}>{checkIn ? 'View / edit today’s check-in' : 'Complete today’s check-in'} <span aria-hidden="true">→</span></button>
    {recommendation.category === 'caution' && scaled && <div className="readiness-adjustment">
      <div className="readiness-adjustment-heading"><div><span className="eyebrow">OPTIONAL · YOU CHOOSE</span><h3>Scale back today’s session</h3></div><span>{originalSets} → {scaledSets} working sets</span></div>
      <p>Trim accessory volume first and keep every movement. Weights stay unchanged; your last logged performance is shown when available. Skip failure sets and adjust the load yourself if needed.</p>
      <div className="readiness-compare"><div><b>PLANNED · {originalSets} SETS</b>{workout.exercises.map((exercise) => <span key={exercise.id}>{exercise.name}<strong>{exercise.targetSets} sets</strong></span>)}</div><div><b>SCALED · {scaledSets} SETS</b>{scaled.exercises.map((exercise) => <span key={exercise.id}>{exercise.name}<strong>{exercise.targetSets} sets</strong></span>)}</div></div>
      {activeWorkout ? <p className="readiness-action-note">Your in-progress workout is unchanged. The scaled plan is only available before starting a session.</p>
        : <button className="button-primary readiness-apply-button" type="button" onClick={onStartScaled}>Use scaled plan for this session</button>}
    </div>}
    {recommendation.category === 'recovery' && <div className="readiness-recovery-action">
      {activeWorkout ? <p className="readiness-action-note">Your in-progress workout is unchanged. Finish or cancel it yourself before choosing something else.</p>
        : <button className="button-secondary" type="button" onClick={() => setRecoveryOpen((open) => !open)}>{recoveryOpen ? 'Close recovery options' : 'Choose a recovery day'}</button>}
      {recoveryOpen && !activeWorkout && <RecoveryEntryForm onSave={async (activity, duration, notes) => { const saved = await onSaveRecovery(activity, duration, notes); if (saved) { setRecoveryOpen(false); setRecoverySaved(true) } return saved }} />}
    </div>}
    {recommendation.category !== 'recovery' && <div className="readiness-recovery-action">
      {activeWorkout ? null : <button className="button-text" type="button" onClick={() => setRecoveryOpen((open) => !open)}>{recoveryOpen ? 'Close recovery options' : 'Prefer a recovery day? Log rest or gentle activity'}</button>}
      {recoveryOpen && !activeWorkout && <RecoveryEntryForm onSave={async (activity, duration, notes) => { const saved = await onSaveRecovery(activity, duration, notes); if (saved) { setRecoveryOpen(false); setRecoverySaved(true) } return saved }} />}
    </div>}
    {recoverySaved && <p className="recovery-saved-note" role="status">Recovery day saved to your separate recovery history. Rotation and XP are unchanged.</p>}
    {activeWorkout && recommendation.category !== 'recovery' && recommendation.category !== 'caution' && <p className="readiness-action-note">Your current workout stays unchanged. Adjust your effort by feel.</p>}
  </section>
}

function RecoveryEntryForm({ onSave }: { onSave: (activity: RecoveryActivity, duration: number | null, notes: string) => Promise<boolean> }) {
  const [activity, setActivity] = useState<RecoveryActivity>('rest')
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const minutes = duration.trim() ? Number(duration) : null
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) { setError('Enter a duration from 1 to 600 minutes.'); return }
    setError('')
    setSaving(true)
    try {
      if (!await onSave(activity, minutes, notes)) setError('Recovery day could not be saved. Your entries are still here; please try again.')
    } catch {
      setError('Recovery day could not be saved. Your entries are still here; please try again.')
    } finally { setSaving(false) }
  }
  return <form className="recovery-entry-form" onSubmit={submit}>
    <label>What feels right today?<select value={activity} onChange={(event) => setActivity(event.target.value as RecoveryActivity)}>{recoveryActivities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="recovery-entry-fields"><label>Duration · optional<input type="number" min="1" max="600" inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Minutes" /></label><label>Note · optional<input maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="How it felt" /></label></div>
    {error && <p role="alert" className="recovery-form-error">{error}</p>}
    <div className="recovery-entry-actions"><button className="button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save recovery day'}</button><small>Does not affect your workout rotation or XP.</small></div>
  </form>
}

export function RecoveryHistory({ sessions }: { sessions: RecoverySession[] }) {
  if (!sessions?.length) return <p className="readiness-empty">Recovery days you log will appear here. Rest without a log is always okay.</p>
  return <div className="recovery-history-list">{sessions.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map((session: RecoverySession) => <div key={session.id}><strong>{session.date} · {recoveryActivities.find((item) => item.id === session.activity)?.label}</strong><span>{session.durationMinutes ? `${session.durationMinutes} min` : 'No duration'}{session.notes ? ` · ${session.notes}` : ''}</span></div>)}</div>
}
