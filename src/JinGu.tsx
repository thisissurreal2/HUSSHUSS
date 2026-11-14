import { useEffect, useState, type FormEvent } from 'react'
import {
  createJinGuSessionRecord,
  getJinGuRoutine,
  getJinGuTarget,
  getJinGuTargetLabel,
  getJinGuTimerSeconds,
  getNextHorseStanceTarget,
  jinGuSections,
  moveToJinGuExercise,
  pauseJinGuTimer,
  setJinGuExerciseStatus,
  startJinGuTimer,
  type ActiveJinGuSession,
  type JinGuSession,
} from './jinGuData'

type View = 'practice' | 'history'

export function JinGuPage({ history, activeSession, horseStanceTargetSeconds, horseStanceTargetChangedAt, readinessCategory, onStart, onUpdate, onFinish, onSetHorseStanceTarget }: {
  history: JinGuSession[]
  activeSession: ActiveJinGuSession | null
  horseStanceTargetSeconds: number
  horseStanceTargetChangedAt: number | null
  readinessCategory?: 'ready' | 'caution' | 'recovery' | 'missing'
  onStart: (lightPractice: boolean) => Promise<boolean>
  onUpdate: (session: ActiveJinGuSession) => Promise<boolean>
  onFinish: (session: JinGuSession) => Promise<boolean>
  onSetHorseStanceTarget: (seconds: number) => Promise<boolean>
}) {
  const [view, setView] = useState<View>('practice')
  const [finishedSession, setFinishedSession] = useState<JinGuSession | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(0)
  const [difficulty, setDifficulty] = useState<number | null>(null)
  const [discomfort, setDiscomfort] = useState(false)
  const [notes, setNotes] = useState('')
  const progressionReadiness = readinessCategory === 'missing' ? undefined : readinessCategory
  const nextTarget = getNextHorseStanceTarget(horseStanceTargetSeconds, history, now, horseStanceTargetChangedAt, progressionReadiness)

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => { window.clearTimeout(initial); window.clearInterval(interval) }
  }, [])

  async function guarded(action: () => Promise<boolean>, failureMessage: string) {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      const saved = await action()
      if (!saved) setError(failureMessage)
      return saved
    } catch {
      setError(failureMessage)
      return false
    } finally { setBusy(false) }
  }

  async function start(light: boolean) {
    await guarded(() => onStart(light), 'The Jin Gu session could not be saved. Please try again.')
  }

  async function applyTarget() {
    if (nextTarget === null) return
    await guarded(() => onSetHorseStanceTarget(nextTarget), 'The new stance target could not be saved.')
  }

  async function finish(session: ActiveJinGuSession) {
    const record = createJinGuSessionRecord(session, Date.now(), { difficulty, discomfortReported: discomfort, notes })
    if (await guarded(() => onFinish(record), 'The session could not be saved. Your in-progress session is still available.')) {
      setFinishedSession(record)
      setDifficulty(null)
      setDiscomfort(false)
      setNotes('')
    }
  }

  return <section className="jingu-page">
    <header className="jingu-heading">
      <div><span className="eyebrow">DAILY PRACTICE · 筋骨</span><h1>Jin Gu</h1><p className="page-subtitle">A steady 25–30 minute home practice for movement, balance and quiet standing.</p></div>
      <div className="jingu-title-mark" aria-hidden="true"><span>筋</span><i /><span>骨</span></div>
    </header>

    <div className="jingu-view-tabs" role="group" aria-label="Jin Gu views">
      <button type="button" className={view === 'practice' ? 'selected' : ''} aria-pressed={view === 'practice'} onClick={() => { setView('practice'); setFinishedSession(null) }}>Today’s practice</button>
      <button type="button" className={view === 'history' ? 'selected' : ''} aria-pressed={view === 'history'} onClick={() => { setView('history'); setFinishedSession(null) }}>History & progress</button>
    </div>

    {view === 'history' ? <JinGuHistory history={history} now={now} currentTarget={horseStanceTargetSeconds} nextTarget={nextTarget} onApplyTarget={applyTarget} busy={busy} />
      : finishedSession ? <JinGuFinishSummary session={finishedSession} onReturn={() => setFinishedSession(null)} />
        : activeSession ? <JinGuSessionRunner key={activeSession.id} session={activeSession} onUpdate={onUpdate} onFinish={finish} busy={busy} />
          : <>
            <section className="jingu-start-brief">
              <div><span className="eyebrow">CURRENT MA BU TARGET</span><strong>{horseStanceTargetSeconds}<small>sec · 2 holds</small></strong></div>
              <p>This beginner routine uses only the agreed standing preparation, stances, Yi Jin Jing-inspired movements, balance practice and Wuji standing. It does not replace or change your gym programme.</p>
            </section>
            {readinessCategory && readinessCategory !== 'ready' && readinessCategory !== 'missing' && <p className="jingu-light-note" role="status">Today’s readiness suggests a lighter approach. Choose light practice or rest; neither option changes your gym rotation.</p>}
            <div className="jingu-start-actions">
              <button className="button-primary" type="button" disabled={busy} onClick={() => void start(false)}>Start full practice <span aria-hidden="true">→</span></button>
              <button className="button-secondary" type="button" disabled={busy} onClick={() => void start(true)}>Start light practice</button>
            </div>
            <div className="jingu-routine-map">
              {jinGuSections.map((section, sectionIndex) => {
                const exercises = getJinGuRoutine(horseStanceTargetSeconds).filter((item) => item.section === section.id)
                return <section className="jingu-routine-section" key={section.id}>
                  <div className="jingu-section-heading"><span>0{sectionIndex + 1}</span><div><h2>{section.title}</h2><small>{section.estimate}</small></div></div>
                  <ol>{exercises.map((exercise) => <li key={exercise.id}><span>{exercise.name}</span><b>{getJinGuTargetLabel(exercise.target)}</b></li>)}</ol>
                </section>
              })}
            </div>
            <p className="jingu-safety-footnote">Keep the movements comfortable and controlled. Do not force deep stances or push through pain. This traditional-inspired practice is not medical rehabilitation.</p>
          </>}
    {error && <p className="jingu-error" role="alert">{error}</p>}
  </section>
}

function JinGuSessionRunner({ session, onUpdate, onFinish, busy }: { session: ActiveJinGuSession; onUpdate: (session: ActiveJinGuSession) => Promise<boolean>; onFinish: (session: ActiveJinGuSession) => Promise<void>; busy: boolean }) {
  const routine = getJinGuRoutine(session.horseStanceTargetSeconds)
  const [now, setNow] = useState(0)
  const [error, setError] = useState('')
  const [difficulty, setDifficulty] = useState<number | null>(null)
  const [discomfort, setDiscomfort] = useState(false)
  const [notes, setNotes] = useState('')
  const exercise = routine[session.currentExerciseIndex]
  const target = getJinGuTarget(exercise, session.lightPractice)
  const timerTarget = getJinGuTimerSeconds(target)
  const remaining = session.timerDeadline === null
    ? session.timerRemainingSeconds
    : Math.max(0, Math.ceil((session.timerDeadline - now) / 1000))
  const doneCount = session.completedExerciseIds.length

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    if (session.timerDeadline === null) return () => window.clearTimeout(initial)
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => { window.clearTimeout(initial); window.clearInterval(interval) }
  }, [session.timerDeadline])

  async function save(next: ActiveJinGuSession) {
    setError('')
    try { if (!await onUpdate(next)) setError('This session update could not be saved. Please try again.') }
    catch { setError('This session update could not be saved. Please try again.') }
  }

  function move(index: number) {
    if (index < 0 || index >= routine.length || index === session.currentExerciseIndex) return
    void save(moveToJinGuExercise(session, index))
  }

  function markSkipped() {
    const skipped = setJinGuExerciseStatus(session, exercise.id, 'skipped')
    void save(moveToJinGuExercise({ ...skipped, timerDeadline: null, timerRemainingSeconds: 0 }, Math.min(session.currentExerciseIndex + 1, routine.length - 1)))
  }

  function markCompleted() {
    const completed = setJinGuExerciseStatus(session, exercise.id, 'completed')
    void save({ ...completed, timerDeadline: null, timerRemainingSeconds: 0 })
  }

  function startTimer() {
    if (timerTarget === null) return
    void save(startJinGuTimer(session, timerTarget))
  }

  function pauseTimer() {
    void save(pauseJinGuTimer(session, now))
  }

  function resetTimer() {
    void save({ ...session, timerDeadline: null, timerRemainingSeconds: 0 })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void onFinish(session).catch(() => setError('The session could not be saved. Your in-progress session is still available.'))
  }

  return <div className="jingu-session">
    <div className="jingu-session-progress"><div><span>DAILY SEQUENCE</span><b>{session.currentExerciseIndex + 1} / {routine.length}</b></div><div className="jingu-progress-track"><i style={{ width: `${Math.round(doneCount / routine.length * 100)}%` }} /></div><small>{doneCount} movements completed{session.skippedExerciseIds.length ? ` · ${session.skippedExerciseIds.length} skipped` : ''}{session.lightPractice ? ' · light practice' : ''}</small></div>
    <div className="jingu-session-layout">
      <article className="jingu-current-movement">
        <span className="eyebrow">{jinGuSections.find((item) => item.id === exercise.section)?.title}</span>
        <h2>{exercise.name}</h2>
        <p className="jingu-movement-description">{exercise.description}</p>
        <div className="jingu-movement-target"><span>TODAY’S TARGET</span><strong>{getJinGuTargetLabel(target)}</strong></div>
        <ol className="jingu-instructions">{exercise.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
        <details className="jingu-safety"><summary>Technique and safety</summary><p>{exercise.safety}</p>{exercise.restSeconds > 0 && <p>Rest about {exercise.restSeconds} seconds between efforts, or longer until comfortable.</p>}</details>
        {timerTarget !== null && <div className="jingu-timer" aria-live="polite"><div><span>{session.timerDeadline === null ? 'OPTIONAL HOLD TIMER' : remaining === 0 ? 'TIMER COMPLETE' : 'TIME REMAINING'}</span><strong>{formatClock(session.timerDeadline !== null || session.timerRemainingSeconds > 0 ? remaining : timerTarget)}</strong></div><button className="button-secondary" type="button" disabled={busy} onClick={session.timerDeadline === null ? startTimer : remaining === 0 ? resetTimer : pauseTimer}>{session.timerDeadline !== null ? remaining === 0 ? 'Reset timer' : 'Pause' : session.timerRemainingSeconds > 0 ? 'Resume' : 'Start timer'}</button>{timerTarget === 180 && <small>You can finish the quiet standing period whenever you are ready.</small>}</div>}
        {error && <p className="jingu-error" role="alert">{error}</p>}
        <div className="jingu-movement-actions"><button className="button-secondary" type="button" disabled={busy || session.currentExerciseIndex === 0} onClick={() => move(session.currentExerciseIndex - 1)}>← Previous</button><button className="button-text" type="button" disabled={busy} onClick={markSkipped}>Skip movement</button><button className="button-primary" type="button" disabled={busy} onClick={markCompleted}>{session.completedExerciseIds.includes(exercise.id) ? 'Completed ✓' : 'Mark complete'}</button><button className="button-secondary" type="button" disabled={busy || session.currentExerciseIndex === routine.length - 1} onClick={() => move(session.currentExerciseIndex + 1)}>Next →</button></div>
      </article>
      <aside className="jingu-session-rail"><span className="eyebrow">ROUTINE</span>{jinGuSections.map((section) => <div key={section.id} className="jingu-rail-section"><b>{section.title}</b>{routine.filter((item) => item.section === section.id).map((item) => <button type="button" key={item.id} className={`${routine[session.currentExerciseIndex].id === item.id ? 'current' : ''} ${session.completedExerciseIds.includes(item.id) ? 'done' : ''} ${session.skippedExerciseIds.includes(item.id) ? 'skipped' : ''}`} onClick={() => move(routine.indexOf(item))}><i />{item.name}</button>)}</div>)}</aside>
    </div>
    <form className="jingu-finish-form" onSubmit={submit}>
      <div><span className="eyebrow">FINISH WHEN YOU NEED TO</span><h3>Log this practice</h3><p>Partial sessions are saved too. You can stop without completing the sequence.</p></div>
      <label>How did it feel? · optional<select value={difficulty ?? ''} onChange={(event) => setDifficulty(event.target.value ? Number(event.target.value) : null)}><option value="">No rating</option><option value="1">Very easy</option><option value="2">Easy</option><option value="3">Steady</option><option value="4">Hard</option><option value="5">Very hard</option></select></label>
      <label className="jingu-discomfort"><input type="checkbox" checked={discomfort} onChange={(event) => setDiscomfort(event.target.checked)} /> I felt discomfort during practice</label>
      <label>Notes · optional<textarea maxLength={1000} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything you want to remember" /></label>
      <button className="button-primary" type="submit" disabled={busy}>Finish and save session</button>
    </form>
    <div className="jingu-exercise-strip" aria-label="Move through the routine">{routine.map((item, index) => <button key={item.id} type="button" aria-label={`Go to ${item.name}`} aria-current={session.currentExerciseIndex === index ? 'step' : undefined} className={session.currentExerciseIndex === index ? 'current' : session.completedExerciseIds.includes(item.id) ? 'done' : ''} onClick={() => move(index)} />)}</div>
  </div>
}

function JinGuHistory({ history, now, currentTarget, nextTarget, onApplyTarget, busy }: { history: JinGuSession[]; now: number; currentTarget: number; nextTarget: number | null; onApplyTarget: () => void; busy: boolean }) {
  const sorted = [...history].sort((a, b) => b.completedAt - a.completedAt)
  const sevenDaysAgo = now - 7 * 86_400_000
  const recentCount = history.filter((session) => session.completedAt >= sevenDaysAgo).length
  const fullCount = history.filter((session) => session.status === 'completed').length
  const averageMinutes = history.length ? Math.round(history.reduce((sum, item) => sum + item.durationSeconds, 0) / history.length / 60) : null
  const exerciseMap = new Map(getJinGuRoutine(35).map((exercise) => [exercise.id, exercise.name]))
  return <div className="jingu-history-view">
    <div className="jingu-history-stats"><div><span>SESSIONS LOGGED</span><strong>{history.length}</strong></div><div><span>LAST 7 DAYS</span><strong>{recentCount}</strong></div><div><span>FULL ROUTINES</span><strong>{fullCount}</strong></div><div><span>AVERAGE TIME</span><strong>{averageMinutes === null ? '—' : `${averageMinutes}`}<small>{averageMinutes === null ? '' : ' min'}</small></strong></div></div>
    <section className="jingu-progression-panel"><div><span className="eyebrow">CONSERVATIVE DEVELOPMENT</span><h2>Ma Bu · horse stance</h2><p>Current target: <strong>{currentTarget} seconds × 2</strong>. Targets only change when you choose to apply a suggestion.</p>{nextTarget !== null ? <p>At least a week of practice and four recent full, comfortable sessions support a small +5 second step.</p> : <p>Keep the current target. A suggestion appears after a week of practice and four recent full sessions rated steady or easier, with no reported discomfort or light sessions.</p>}</div>{nextTarget !== null && <button className="button-primary" type="button" disabled={busy} onClick={onApplyTarget}>Use {nextTarget} sec target</button>}</section>
    <div className="jingu-history-list"><h2>Practice record</h2>{sorted.length === 0 ? <p className="jingu-empty">Your Jin Gu sessions will appear here after you log a practice.</p> : sorted.slice(0, 60).map((session) => <article className="jingu-history-row" key={session.id}><div className="jingu-history-row-heading"><div><span>{formatDate(session.date)}</span><h3>{session.status === 'completed' ? 'Full practice' : 'Partial practice'}{session.lightPractice ? ' · Light' : ''}</h3></div><strong>{Math.floor(session.durationSeconds / 60)}<small> min</small></strong></div><p>{session.completedExerciseIds.length} completed · {session.skippedExerciseIds.length} skipped · Ma Bu {session.horseStanceTargetSeconds}s{session.difficulty !== null ? ` · Feel ${session.difficulty}/5` : ''}{session.discomfortReported ? ' · discomfort reported' : ''}</p>{session.completedExerciseIds.length > 0 && <div className="jingu-history-movements"><span>Completed: {session.completedExerciseIds.map((id) => exerciseMap.get(id) ?? 'Movement').join(' · ')}</span>{session.skippedExerciseIds.length > 0 && <span>Skipped: {session.skippedExerciseIds.map((id) => exerciseMap.get(id) ?? 'Movement').join(' · ')}</span>}</div>}{session.notes && <p className="jingu-history-notes">{session.notes}</p>}</article>)}</div>
    <p className="jingu-progress-note">These counts describe your logged sessions; they are not a measure of health or proof of training effect.</p>
  </div>
}

function JinGuFinishSummary({ session, onReturn }: { session: JinGuSession; onReturn: () => void }) {
  return <section className="jingu-finish-summary"><span className="eyebrow">PRACTICE SAVED · {formatDate(session.date)}</span><h2>{session.status === 'completed' ? 'A complete practice.' : 'Practice recorded.'}</h2><p>{session.completedExerciseIds.length} movements completed · {session.skippedExerciseIds.length} skipped · {Math.floor(session.durationSeconds / 60)} minutes{session.lightPractice ? ' · light practice' : ''}</p><button className="button-primary" type="button" onClick={onReturn}>Back to Jin Gu</button></section>
}

function formatClock(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
function formatDate(date: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${date}T12:00:00`)) }
