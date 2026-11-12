import { useMemo, useState } from 'react'
import { RestTimer, type RestTimerProps } from './WorkoutFeatures'
import { completeExtraSession, createExtraSession, extraCategories, getCategoryExercises, getExtraExercise, type ExtraCategoryId, type ExtraSessionRecord } from './extras'
import { mascots } from './mascots'

export function ExtrasPage({ sessions, onSave, onBack, timer, favourites, onToggleFavourite, initialCategory }: { sessions: ExtraSessionRecord[]; onSave: (session: ExtraSessionRecord) => Promise<void>; onBack: () => void; timer: RestTimerProps; favourites: string[]; onToggleFavourite: (id: string) => void; initialCategory?: ExtraCategoryId | null }) {
  const [category, setCategory] = useState<ExtraCategoryId | null>(initialCategory ?? null)
  const [selected, setSelected] = useState<string[]>(() => initialCategory ? getCategoryExercises(initialCategory).map((item) => item.id) : [])
  const [active, setActive] = useState<ExtraSessionRecord | null>(() => initialCategory ? createExtraSession(getCategoryExercises(initialCategory).map((item) => item.id)) : null)
  const [exerciseIndex, setExerciseIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [done, setDone] = useState<ExtraSessionRecord | null>(null)
  const [showPicker, setShowPicker] = useState<string | null>(null)

  const activeExercise = active?.exercises[exerciseIndex]
  const detail = activeExercise ? getExtraExercise(activeExercise.exerciseId) : undefined
  const completedUnits = active?.exercises.reduce((sum, item) => sum + item.units.filter((unit) => unit.completed).length, 0) ?? 0
  const totalUnits = active?.exercises.reduce((sum, item) => sum + item.units.length, 0) ?? 0
  const history = useMemo(() => sessions.filter((session) => session.status === 'completed').sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)), [sessions])

  function begin(ids: string[]) {
    if (ids.length === 0) return
    setActive(createExtraSession(ids))
    setExerciseIndex(0)
    setPaused(false)
    setDone(null)
    setShowPicker(null)
  }
  function markUnit() {
    if (!active || !activeExercise) return
    const next = { ...active, exercises: active.exercises.map((item, index) => index !== exerciseIndex ? item : { ...item, units: item.units.map((unit, unitIndex) => unitIndex === item.units.findIndex((entry) => !entry.completed) ? { ...unit, completed: true } : unit) }) }
    setActive(next)
    if (completedUnits + 1 < totalUnits) timer.onStart()
    const updated = next.exercises[exerciseIndex]
    if (updated.units.every((unit) => unit.completed) && exerciseIndex < next.exercises.length - 1) setExerciseIndex(exerciseIndex + 1)
  }
  async function finish() {
    if (!active) return
    timer.onPause()
    const record = completeExtraSession(active)
    if (record.status === 'completed') {
      try { await onSave(record); setDone(record) } catch { window.alert('This extra session could not be saved. Your completed work is still on this screen; please try again.') }
    } else {
      setActive(null)
    }
  }
  function discard() {
    if (!active) return
    if (!window.confirm('Discard this unfinished extra session? It will not be saved or award XP.')) return
    timer.onPause()
    setActive(null)
    setExerciseIndex(0)
  }

  if (done) return <section className="extras-completion panel">
    <div className="eyebrow">HUSHHUSS // EXTRA SESSION CLEARED</div>
    <img src={mascots.workout} alt="SpongeBob celebrating a completed session" />
    <h1>EXTRA WORK<br/>DONE.</h1>
    <p>{done.xpEarned} XP earned · {done.exercises.reduce((sum, item) => sum + item.units.filter((unit) => unit.completed).length, 0)} work units completed.</p>
    <button className="button-primary" onClick={() => { setDone(null); setActive(null); setCategory(null) }}>Back to EXTRAS</button>
    <button className="button-secondary" onClick={onBack}>Back to Plan</button>
  </section>

  if (active && detail && activeExercise) {
    const nextUnit = activeExercise.units.findIndex((unit) => !unit.completed)
    return <div className="extras-page">
      <div className="page-heading"><div><div className="eyebrow">HUSHHUSS // OPTIONAL TRAINING</div><h1>Extra session.</h1><p className="page-subtitle">One movement at a time. Take your time.</p></div><button className="button-secondary" onClick={discard}>Exit</button></div>
      <section className="extras-session-panel panel">
        <div className="extras-session-progress"><span>{completedUnits} / {totalUnits} WORK UNITS</span><span>{Math.round((completedUnits / Math.max(1,totalUnits))*100)}%</span></div>
        <div className="extras-progress-track"><span style={{ width: `${(completedUnits / Math.max(1,totalUnits))*100}%` }}/></div>
        <div className="eyebrow">EXERCISE {exerciseIndex + 1} / {active.exercises.length}</div>
        <h2>{detail.name}</h2><p>{detail.purpose}</p>
        <ol>{detail.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
        <div className="extras-prescription"><strong>{detail.prescription}</strong><span>{detail.restSeconds}s rest · {detail.difficulty}</span></div>
        <p className="performance-note">Equipment: {detail.equipment} · Muscles: {Object.keys(detail.muscles).join(', ')}</p>
        <p className="performance-note">Safety: {detail.safety}</p>
        <div className="extras-work-units">{activeExercise.units.map((unit, index) => <span key={unit.id} className={unit.completed ? 'complete' : ''}>{unit.completed ? '✓' : `0${index + 1}`}</span>)}</div>
        {paused ? <p className="extras-paused">SESSION PAUSED</p> : <p className="performance-note">Complete one prescribed set, interval, round or hold at a time. Rest as needed.</p>}
        <RestTimer {...timer} />
        <div className="extras-actions">
          <button className="button-secondary" onClick={() => { if (paused) timer.onStart(); else timer.onPause(); setPaused(!paused) }}>{paused ? 'Resume' : 'Pause'}</button>
          <button className="button-secondary" onClick={() => setExerciseIndex((index) => Math.min(index + 1, active.exercises.length - 1))}>Skip exercise</button>
          <button className="button-primary" disabled={paused || nextUnit < 0} onClick={markUnit}>Complete work unit</button>
        </div>
        <button className="extras-finish-link" onClick={finish}>Finish and save completed work</button>
      </section>
    </div>
  }

  return <div className="extras-page">
    <div className="page-heading"><div><div className="eyebrow">HUSHHUSS // ATHLETIC UNDERGROUND</div><h1>EXTRAS.</h1><p className="page-subtitle">Optional supplementary work. Your main rotation never depends on this.</p></div><button className="button-secondary" onClick={onBack}>Back to Plan</button></div>
    <section className="extras-intro panel"><div><div className="eyebrow">SIDE QUESTS · ZERO PRESSURE</div><h2>Train what you want.<br/>Skip what you don't.</h2><p>EXTRAS never changes your Push / Pull / Core rotation. Skipping has no downside.</p></div><span>OPTIONAL<br/>BY DESIGN</span></section>
    {!category ? <>
      <div className="extras-category-grid">{extraCategories.map((item, index) => <button className="extras-category panel" key={item.id} onClick={() => { setCategory(item.id); setSelected(getCategoryExercises(item.id).map((exercise) => exercise.id)) }}><span className="extras-index">0{index + 1}</span><h2>{item.name}</h2><p>{item.description}</p><span className="extras-duration">{item.duration} <b>→</b></span></button>)}</div>
      <section className="performance-panel panel"><div className="eyebrow">FAVOURITES</div><div className="extras-favourite-list">{favourites.length ? favourites.map((id) => { const item = getExtraExercise(id)!; return <button key={id} onClick={() => begin([id])}>{item.name} →</button> }) : <p className="performance-note">Favourite exercises to build a quick-start list.</p>}</div></section>
      <section className="performance-panel panel"><div className="eyebrow">PREVIOUS EXTRA SESSIONS</div>{history.length ? history.slice(0,8).map((session) => <div className="extras-history-row" key={session.id}><span>{new Date(session.completedAt ?? session.startedAt).toLocaleDateString()}</span><strong>{session.exercises.length} exercises</strong><b>+{session.xpEarned} XP</b></div>) : <p className="performance-note">No completed extra sessions yet. That's completely fine.</p>}</section>
    </> : <>
      <button className="extras-back-link" onClick={() => setCategory(null)}>← ALL CATEGORIES</button>
      <section className="performance-panel panel"><div className="eyebrow">CATEGORY ROUTINE</div><h2>{extraCategories.find((item) => item.id === category)?.name}</h2><p className="performance-note">Choose the full suggested routine or select just one or two exercises.</p>
        {getCategoryExercises(category).map((item) => <div className="extras-exercise-row" key={item.id}><label><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current,item.id] : current.filter((id) => id !== item.id))}/><span><strong>{item.name}</strong><small>{item.prescription} · {item.equipment}</small></span></label><button aria-label={`${favourites.includes(item.id) ? 'Remove' : 'Add'} ${item.name} ${favourites.includes(item.id) ? 'from' : 'to'} favourites`} onClick={() => onToggleFavourite(item.id)}>{favourites.includes(item.id) ? '★' : '☆'}</button><button onClick={() => setShowPicker(showPicker === item.id ? null : item.id)}>Details</button>{showPicker === item.id && <p className="extras-detail-copy">{item.purpose} {item.instructions.join(' ')} Prescription: {item.prescription}. Rest: {item.restSeconds}s. Difficulty: {item.difficulty}. Equipment: {item.equipment}. Muscles: {Object.keys(item.muscles).join(', ')}. Safety: {item.safety}</p>}</div>)}
        <div className="extras-actions"><button className="button-secondary" onClick={() => setSelected(getCategoryExercises(category).map((item) => item.id))}>Select all</button><button className="button-primary" disabled={selected.length === 0} onClick={() => begin(selected)}>Start selected ({selected.length})</button></div>
      </section>
    </>}
  </div>
}
