import { Fragment, useState } from 'react'
import { playSound } from './sound'
import { SoundToggle } from './soundToggle'
import { restPresets, type ActiveWorkout, type SetEntry, type WorkoutRecord } from './workoutStorage'
import { PreviousPerformance } from './StrengthProgress'
import { getWorkout, type ChecklistItem, type Exercise, type Workout } from './workouts'
import { formatKg, getExerciseMetricType, getExercisePerformances } from './strengthAnalytics'
import {
  applySessionSubstitution,
  equipmentChoices,
  getMuscleNames,
  getSubstitutionCandidates,
  getSubstitutionDefinition,
  type Equipment,
  type SubstitutionReason,
} from './exerciseSubstitutions'

function Icon({
  name,
  size = 17,
}: {
  name: 'arrow' | 'check' | 'clock' | 'moon' | 'pause' | 'play' | 'plus' | 'reset' | 'trash'
  size?: number
}) {
  const paths = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    pause: <><path d="M9 5v14" /><path d="M15 5v14" /></>,
    play: <path d="m8 5 12 7-12 7V5Z" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    reset: <><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" /><path d="M3 3v5h5" /></>,
    trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5m4-5v5" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function updateSet(
  workout: ActiveWorkout,
  exerciseId: string,
  setId: string,
  change: (set: SetEntry) => SetEntry,
): ActiveWorkout {
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) => exercise.exerciseId !== exerciseId
      ? exercise
      : {
          ...exercise,
          sets: exercise.sets.map((set) => set.id === setId ? change(set) : set),
        }),
  }
}

function updateSideQuantity(
  workout: ActiveWorkout,
  exerciseId: string,
  setId: string,
  side: 'leftReps' | 'rightReps',
  value: string,
): ActiveWorkout {
  return updateSet(workout, exerciseId, setId, (current) => {
    const next = { ...current, [side]: value }
    const left = side === 'leftReps' ? value : current.leftReps ?? ''
    const right = side === 'rightReps' ? value : current.rightReps ?? ''
    const bothValid = /^\d+$/.test(left) && Number(left) > 0 && /^\d+$/.test(right) && Number(right) > 0
    return { ...next, reps: bothValid ? String(Math.min(Number(left), Number(right))) : '' }
  })
}

function ChecklistSection({
  title,
  label,
  items,
  completedIds,
  onToggle,
  initiallyExpanded,
}: {
  title: string
  label: string
  items: ChecklistItem[]
  completedIds: string[]
  onToggle: (itemId: string) => void
  initiallyExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const progress = items.length === 0 ? 0 : completedIds.length

  return (
    <section className="session-checklist panel">
      <div className="checklist-heading">
        <div>
          <div className="eyebrow">{label}</div>
          <h3>{title}</h3>
        </div>
        <span className="checklist-progress-count">{progress} / {items.length} done</span>
        <button
          className="checklist-expand-button"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>
      <div className="checklist-progress-track" aria-hidden="true">
        <span style={{ width: `${items.length === 0 ? 0 : (progress / items.length) * 100}%` }} />
      </div>
      {expanded && (
        <div className="checklist-items">
          {items.map((item) => {
            const completed = completedIds.includes(item.id)
            return (
              <button
                className={`checklist-item ${completed ? 'selected' : ''}`}
                key={item.id}
                type="button"
                aria-pressed={completed}
                onClick={() => onToggle(item.id)}
              >
                <span className="checklist-check"><Icon name="check" size={15} /></span>
                <span className="checklist-item-copy">
                  <strong>{item.name}</strong>
                  <span>{item.instructions}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function SubstitutionPicker({
  index,
  exercise,
  activeWorkout,
  history,
  preferredSubstitutions,
  onChange,
  onSavePreferred,
  onRemovePreferred,
}: {
  index: number
  exercise: Exercise
  activeWorkout: ActiveWorkout
  history: WorkoutRecord[]
  preferredSubstitutions: Record<string, string>
  onChange: (change: (current: ActiveWorkout) => ActiveWorkout) => void
  onSavePreferred: (sourceId: string, candidateId: string) => void
  onRemovePreferred: (sourceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<SubstitutionReason>('equipment-unavailable')
  const state = activeWorkout.exercises[index]
  const sourceId = state.substitution?.originalExerciseId ?? exercise.id
  const sourceProfile = getSubstitutionDefinition(sourceId)
  const [unavailable, setUnavailable] = useState<Equipment[]>(() => sourceProfile?.equipment ?? [])
  const candidates = getSubstitutionCandidates(sourceId, reason, unavailable, preferredSubstitutions[sourceId])
    .filter((candidate) => candidate.id !== exercise.id)
  const currentProfile = getSubstitutionDefinition(sourceId)

  function select(candidateId: string) {
    const hasEnteredWork = state.completed || state.sets.some((set) => set.completed || set.weightKg !== '' || set.reps !== '' || Boolean(set.leftReps) || Boolean(set.rightReps))
    if (hasEnteredWork && !window.confirm('Changing this exercise clears its current unsaved set entries. Continue?')) return
    onChange((current) => applySessionSubstitution(current, index, candidateId, reason, history))
    setOpen(false)
  }

  return <div className="substitution-control">
    <button type="button" className="substitution-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? 'Close alternatives' : state.substitution ? 'Choose another exercise' : 'Substitute exercise'}
    </button>
    {state.substitution && <span className="substitution-origin">Substituted for {getSubstitutionDefinition(state.substitution.originalExerciseId)?.name ?? state.substitution.originalExerciseId}</span>}
    {open && <section className="substitution-picker" aria-label={`Alternatives for ${exercise.name}`}>
      <div className="substitution-picker-head"><div><span className="eyebrow">KEEP THE SESSION ON TRACK</span><h4>Alternatives for {getSubstitutionDefinition(sourceId)?.name ?? exercise.name}</h4></div></div>
      <label className="substitution-reason-label">Why are you switching?
        <select value={reason} onChange={(event) => {
          const value = event.currentTarget.value as SubstitutionReason
          setReason(value)
          setUnavailable(value === 'equipment-unavailable' ? sourceProfile?.equipment ?? [] : [])
        }}>
          <option value="equipment-unavailable">Equipment unavailable</option>
          <option value="machine-occupied">Machine occupied</option>
          <option value="uncomfortable">Exercise uncomfortable</option>
          <option value="variation">Want a different variation</option>
          <option value="pain">Pain or physical limitation</option>
        </select>
      </label>
      {reason === 'pain' && <p className="substitution-pain-note">Stop the painful movement. These options are not medically assessed; only choose an alternative if it feels comfortable, or stop and seek appropriate care.</p>}
      {preferredSubstitutions[sourceId] && <button type="button" className="substitution-remove-preference" onClick={() => onRemovePreferred(sourceId)}>Remove saved preference</button>}
      {(reason === 'equipment-unavailable' || reason === 'machine-occupied') && <fieldset className="substitution-equipment-filter">
        <legend>Also unavailable</legend>
        {equipmentChoices.map((item) => <label key={item.id}><input type="checkbox" checked={unavailable.includes(item.id)} onChange={(event) => {
          const checked = event.currentTarget.checked
          setUnavailable((current) => checked
            ? current.includes(item.id) ? current : [...current, item.id]
            : current.filter((id) => id !== item.id))
        }} />{item.label}</label>)}
      </fieldset>}
      {currentProfile && <p className="substitution-current-target">Original target: {exercise.targetSets} × {currentProfile.targetReps}. Alternatives keep this session’s set count and use their own rep target.</p>}
      <div className="substitution-candidate-list">{candidates.length ? candidates.slice(0, 6).map((candidate) => {
        const muscles = getMuscleNames(candidate)
        return <article className="substitution-candidate" key={candidate.id}>
          <div className="substitution-candidate-title"><div><h5>{candidate.name}</h5><span>{candidate.equipment.map((item) => equipmentChoices.find((choice) => choice.id === item)?.label ?? item).join(' · ')}</span></div>{preferredSubstitutions[sourceId] === candidate.id && <b>Preferred</b>}</div>
          <p><strong>Primary:</strong> {muscles.primary.join(', ') || 'Grip / balance'}{muscles.secondary.length ? <> · <strong>Also:</strong> {muscles.secondary.join(', ')}</> : null}</p>
          <p><strong>Pattern:</strong> {candidate.pattern.replaceAll('-', ' ')} · <strong>Type:</strong> {candidate.type}</p>
          <p>{candidate.reason} {candidate.difficulty}</p>
          <div className="substitution-candidate-actions"><button type="button" className="button button-primary" onClick={() => select(candidate.id)}>Use this exercise</button><button type="button" className="substitution-prefer-button" onClick={() => onSavePreferred(sourceId, candidate.id)}>{preferredSubstitutions[sourceId] === candidate.id ? 'Preferred' : 'Save preference'}</button></div>
        </article>
      }) : <p className="substitution-empty">No close match with those filters. Clear an equipment filter or pick another reason.</p>}</div>
    </section>}
  </div>
}

export function WorkoutSession({
  workout,
  activeWorkout,
  history,
  preferredSubstitutions,
  onSavePreferredSubstitution,
  onRemovePreferredSubstitution,
  onChange,
  onFinish,
  onCancel,
  ...timerProps
}: {
  workout: Workout
  activeWorkout: ActiveWorkout
  history: WorkoutRecord[]
  preferredSubstitutions: Record<string, string>
  onSavePreferredSubstitution: (sourceId: string, candidateId: string) => void
  onRemovePreferredSubstitution: (sourceId: string) => void
  onChange: (change: (current: ActiveWorkout) => ActiveWorkout) => void
  onFinish: () => void
  onCancel: () => void
} & RestTimerProps) {
  const completedExercises = activeWorkout.exercises.filter((exercise) => exercise.completed).length
  const allExercisesComplete = completedExercises === workout.exercises.length
  const fieldWorkout = workout.id === 'pull' || workout.id === 'core'

  return (
    <section className={`workout-session panel ${fieldWorkout ? 'field-workout' : ''}`} aria-label={`${workout.name} workout session`}>
      <header className="workout-session-header">
        <div>
          <div className="eyebrow">WORKOUT IN PROGRESS</div>
          <h2>{workout.name} day</h2>
          <p>Move at your pace. Your work is saved on this device.</p>
        </div>
        <button className="quiet-button" onClick={onCancel}>Cancel workout</button>
      </header>

      <div className="session-progress">
        <div className="session-progress-copy">
          <span>{completedExercises} of {workout.exercises.length} exercises complete</span>
          <span>{workout.exercises.length - completedExercises} remaining</span>
        </div>
        <div className="session-progress-track">
          <span style={{ width: `${(completedExercises / workout.exercises.length) * 100}%` }} />
        </div>
      </div>

      <ChecklistSection
        title="Warm-up"
        label="PREPARE"
        items={workout.warmup}
        completedIds={activeWorkout.warmupCompletedIds}
        initiallyExpanded
        onToggle={(itemId) => onChange((current) => ({
          ...current,
          warmupCompletedIds: current.warmupCompletedIds.includes(itemId)
            ? current.warmupCompletedIds.filter((id) => id !== itemId)
            : [...current.warmupCompletedIds, itemId],
        }))}
      />

      <section className="session-main-workout" aria-labelledby="main-workout-heading">
        <div className="session-section-heading">
          <div className="eyebrow">WORKING SETS</div>
          <h3 id="main-workout-heading">Main workout</h3>
        </div>
        <RestTimer {...timerProps} />

        <div className="session-exercises">
        {workout.exercises.map((exercise, index) => {
          const state = activeWorkout.exercises[index]
          const isCurrentCoreTemplate = activeWorkout.workoutId === 'core'
            && workout.exercises[0]?.id === 'hanging-knee-raises'
            && workout.exercises[4]?.id === 'romanian-deadlift'
            && workout.exercises[7]?.id === 'farmer-carries'
          const programmeSection = isCurrentCoreTemplate
            ? ({ 0: 'CORE', 4: 'LEGS', 7: 'ATHLETICISM' } as Record<number, string>)[index]
            : undefined
          const metricType = getExerciseMetricType(exercise.id, exercise.name, exercise.targetReps)
          const isSideSpecific = metricType === 'per-side' || metricType === 'per-side-time'
          const distanceUnit = /\bkm\b/i.test(exercise.targetReps) ? 'km' : 'metres'
          const distanceHeading = distanceUnit === 'km' ? 'KM' : 'M'
          const quantityLabel = metricType === 'timed' || metricType === 'per-side-time' ? 'seconds' : metricType === 'distance' ? `distance in ${distanceUnit}` : 'repetitions'
          const sideLabel = /per\s+arm/i.test(exercise.targetReps) ? 'ARM' : /per\s+leg/i.test(exercise.targetReps) ? 'LEG' : 'SIDE'
          const quantityHeading = metricType === 'timed' ? 'SEC' : metricType === 'per-side-time' ? `SEC / ${sideLabel}` : metricType === 'distance' ? distanceHeading : metricType === 'per-side' ? `REPS / ${sideLabel}` : 'REPS'
          const sourceExerciseId = state.substitution?.originalExerciseId ?? exercise.id
          const previousPerformance = fieldWorkout
            ? getExercisePerformances(history, sourceExerciseId).filter((performance) => performance.sets.length > 0).at(-1)
            : undefined
          const currentExerciseIndex = activeWorkout.exercises.findIndex((item) => !item.completed)
          const currentSetIndex = index === currentExerciseIndex ? state.sets.findIndex((set) => !set.completed) : -1
          const previousSetLabel = (setIndex: number) => {
            const previousSet = previousPerformance?.sets[setIndex]
            if (!previousSet) return '—'
            if (isSideSpecific && previousSet.leftReps != null && previousSet.rightReps != null) return `${previousSet.leftReps}/${previousSet.rightReps}`
            if (previousSet.reps == null) return '—'
            if (metricType === 'timed' || metricType === 'per-side-time') return `${previousSet.reps} s`
            if (metricType === 'distance') return `${previousSet.reps} ${distanceUnit}`
            return previousSet.weightKg === null ? `${previousSet.reps} reps` : `${formatKg(previousSet.weightKg)} × ${previousSet.reps}`
          }
          return (
            <Fragment key={exercise.id}>
            {programmeSection && <div className="programme-section-divider"><span>{programmeSection}</span><i /></div>}
            <article
              className={`session-exercise ${state.completed ? 'exercise-complete' : ''} ${index === activeWorkout.exercises.findIndex((item) => !item.completed) ? 'exercise-current' : ''}`}
            >
              <div className="session-exercise-heading">
                <span className="exercise-number">{String(index + 1).padStart(2, '0')}</span>
                <div className="session-exercise-title">
                  <h3>{exercise.name}</h3>
                  <span>{exercise.focus}{exercise.isLowerBody ? ' · LOWER BODY' : ''}</span>
                </div>
                <span className={`exercise-state ${state.completed ? 'done' : ''}`}>
                  {state.completed ? 'DONE' : 'REMAINING'}
                </span>
              </div>
              <p className="exercise-instructions">{exercise.instructions}</p>
              <div className="exercise-target">
                Target · {exercise.targetSets} sets × {/\b(seconds?|secs?|sec|s|meters?|metres?|m|km|per side|per leg|per arm)\b/i.test(exercise.targetReps)
                  ? exercise.targetReps
                  : `${exercise.targetReps} reps`}
              </div>
              <PreviousPerformance
                history={history}
                exercise={(() => {
                  const sourceExerciseId = state.substitution?.originalExerciseId ?? exercise.id
                  const normalPrescription = workout.exercises.find((item) => item.id === sourceExerciseId)
                    ?? getWorkout(workout.id).exercises.find((item) => item.id === sourceExerciseId)
                    ?? exercise
                  return { exerciseId: normalPrescription.id, name: normalPrescription.name, targetSets: normalPrescription.targetSets, targetReps: normalPrescription.targetReps }
                })()}
                activeExercise={state}
                readinessAdjusted={activeWorkout.readinessAdjusted ?? false}
              />

              <div className="set-table">
                <div className={`set-row set-labels ${isSideSpecific ? 'set-row-sides' : ''} ${fieldWorkout ? 'field-set-row' : ''}`} aria-hidden="true">
                  <span>SET</span>{fieldWorkout && <span>PREVIOUS</span>}<span>{metricType === 'assisted' ? 'ASSIST KG' : 'KG'}</span>{isSideSpecific ? <><span>L · {quantityHeading.split('/')[0]}</span><span>R · {quantityHeading.split('/')[0]}</span></> : <span>{quantityHeading}</span>}<span>DONE</span><span />
                </div>
                {state.sets.map((set, setIndex) => (
                  <div className={`set-row ${isSideSpecific ? 'set-row-sides' : ''} ${fieldWorkout ? 'field-set-row' : ''} ${setIndex === currentSetIndex ? 'field-set-current' : ''} ${set.completed ? 'field-set-completed' : ''}`} key={set.id}>
                    <span className="set-index">{String(setIndex + 1).padStart(2, '0')}</span>
                    {fieldWorkout && <span className="field-previous-value">{previousSetLabel(setIndex)}</span>}
                    <label className="visually-hidden" htmlFor={`${set.id}-weight`}>{exercise.name} set {setIndex + 1} {metricType === 'assisted' ? 'assistance' : 'load'} in kilograms</label>
                    <input
                      id={`${set.id}-weight`}
                      className="set-input"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="—"
                      value={set.weightKg}
                      onChange={(event) => {
                        const raw = event.currentTarget.value
                        const value = raw === '.' ? '0.' : raw
                        if (/^\d*\.?\d{0,2}$/.test(value)
                          && (value === '' || (Number.isFinite(Number(value)) && Number(value) <= 1000))) {
                          onChange((current) => updateSet(current, exercise.id, set.id, (item) => ({ ...item, weightKg: value })))
                        }
                      }}
                    />
                    {isSideSpecific ? (['leftReps', 'rightReps'] as const).map((side) => <span className="side-quantity-field" key={side}>
                      <label className="visually-hidden" htmlFor={`${set.id}-${side}`}>{exercise.name} set {setIndex + 1} {side === 'leftReps' ? 'left' : 'right'} {quantityLabel}</label>
                      <input id={`${set.id}-${side}`} className="set-input" type="text" inputMode="numeric" autoComplete="off" placeholder="—" value={set[side] ?? ''} onChange={(event) => {
                        const value = event.currentTarget.value
                        if (value === '' || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 500)) onChange((current) => updateSideQuantity(current, exercise.id, set.id, side, value))
                      }} />
                    </span>) : <>
                      <label className="visually-hidden" htmlFor={`${set.id}-reps`}>{exercise.name} set {setIndex + 1} {quantityLabel}</label>
                      <input id={`${set.id}-reps`} className="set-input" type="text" inputMode="numeric" autoComplete="off" placeholder="—" value={set.reps} onChange={(event) => {
                        const value = event.currentTarget.value
                        if (value === '' || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 500)) onChange((current) => updateSet(current, exercise.id, set.id, (item) => ({ ...item, reps: value })))
                      }} />
                    </>}
                    <button
                      className={`set-complete-button ${set.completed ? 'selected' : ''}`}
                      onClick={() => {
                        if (!set.completed) void playSound('set')
                        onChange((current) => updateSet(
                          current,
                          exercise.id,
                          set.id,
                          (item) => ({ ...item, completed: !item.completed }),
                        ))
                        if (!set.completed) timerProps.onWorkUnitComplete()
                      }}
                      aria-label={`${set.completed ? 'Unmark' : 'Mark'} set ${setIndex + 1} complete for ${exercise.name}`}
                      aria-pressed={set.completed}
                    >
                      <Icon name="check" size={15} />
                    </button>
                    <button
                      className="set-remove-button"
                      onClick={() => onChange((current) => ({
                        ...current,
                        exercises: current.exercises.map((item) => item.exerciseId !== exercise.id || item.sets.length <= 1
                          ? item
                          : { ...item, sets: item.sets.filter((entry) => entry.id !== set.id) }),
                      }))}
                      disabled={state.sets.length <= 1}
                      aria-label={`Remove set ${setIndex + 1} from ${exercise.name}`}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="exercise-actions">
                <button
                  className="add-set-button"
                  onClick={() => onChange((current) => ({
                    ...current,
                    exercises: current.exercises.map((item) => item.exerciseId !== exercise.id || item.sets.length >= 20
                      ? item
                      : { ...item, sets: [...item.sets, { id: createSetId(), weightKg: '', reps: '', completed: false }] }),
                  }))}
                  disabled={state.sets.length >= 20}
                >
                  <Icon name="plus" size={14} /> Add set
                </button>
                <button
                  className={`exercise-done-button ${state.completed ? 'selected' : ''}`}
                  onClick={() => onChange((current) => ({
                    ...current,
                    exercises: current.exercises.map((item) => item.exerciseId === exercise.id
                      ? { ...item, completed: !item.completed }
                      : item),
                  }))}
                  aria-pressed={state.completed}
                >
                  <Icon name="check" size={14} />
                  {state.completed ? 'Completed' : 'Mark exercise done'}
                </button>
              </div>
              <SubstitutionPicker
                index={index}
                exercise={exercise}
                activeWorkout={activeWorkout}
                history={history}
                preferredSubstitutions={preferredSubstitutions}
                onChange={onChange}
                onSavePreferred={onSavePreferredSubstitution}
                onRemovePreferred={onRemovePreferredSubstitution}
              />
            </article>
            </Fragment>
          )
        })}
        </div>
      </section>

      <ChecklistSection
        title="Cool-down and stretching"
        label="RECOVER"
        items={workout.cooldown}
        completedIds={activeWorkout.cooldownCompletedIds}
        initiallyExpanded={false}
        onToggle={(itemId) => onChange((current) => ({
          ...current,
          cooldownCompletedIds: current.cooldownCompletedIds.includes(itemId)
            ? current.cooldownCompletedIds.filter((id) => id !== itemId)
            : [...current.cooldownCompletedIds, itemId],
        }))}
      />

      <footer className="finish-workout-footer">
        <p>{allExercisesComplete
          ? 'Your session is ready to finish. Stretching is optional.'
          : 'Mark each exercise complete when you are ready. Stretching is optional; you can also cancel and resume later.'}</p>
        <button className="button-primary" onClick={onFinish} disabled={!allExercisesComplete}>
          Finish workout <Icon name="arrow" size={16} />
        </button>
      </footer>
    </section>
  )
}

function createSetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export type RestTimerProps = {
  durationSeconds: number
  remainingSeconds: number
  running: boolean
  deadline: number | null
  notificationAvailable: boolean
  notificationPermission: NotificationPermission | 'unsupported'
  pushConfigured: boolean
  notice: string | null
  onSelectDuration: (seconds: number) => void
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onAdjust: (deltaSeconds: number) => void
  onSkip: () => void
  autoStartOnSet: boolean
  countdownWarnings: boolean
  vibrationEnabled: boolean
  onToggleAutoStart: (value: boolean) => void
  onToggleCountdownWarnings: (value: boolean) => void
  onToggleVibration: (value: boolean) => void
  onWorkUnitComplete: () => void
  onEnableNotifications: () => void
}

export function RestTimer({
  durationSeconds,
  remainingSeconds,
  running,
  deadline,
  notificationAvailable,
  notificationPermission,
  pushConfigured,
  notice,
  onSelectDuration,
  onStart,
  onPause,
  onReset,
  onAdjust,
  onSkip,
  autoStartOnSet,
  countdownWarnings,
  vibrationEnabled,
  onToggleAutoStart,
  onToggleCountdownWarnings,
  onToggleVibration,
  onEnableNotifications,
}: RestTimerProps) {
  const [customMinutes, setCustomMinutes] = useState('1')
  const [customSeconds, setCustomSeconds] = useState('30')
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60

  return (
    <section className="rest-timer panel" aria-label="Rest timer">
      <div className="timer-topline">
        <div>
          <div className="eyebrow">BETWEEN SETS</div>
          <h3><Icon name="clock" size={17} /> Rest timer</h3>
        </div>
        <div className="timer-display" role="timer" aria-label={`${minutes} minutes ${seconds} seconds remaining`}>
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
      </div>
      <div className="timer-presets" aria-label="Rest duration presets">
        {restPresets.map((duration) => (
          <button
            className={durationSeconds === duration ? 'selected' : ''}
            key={duration}
            onClick={() => onSelectDuration(duration)}
            aria-pressed={durationSeconds === duration}
          >
            {duration >= 120 ? `${duration / 60} min` : `${duration} sec`}
          </button>
        ))}
      </div>
      <div className="timer-adjustments" aria-label="Adjust remaining rest time">
        <button type="button" onClick={() => onAdjust(-30)} disabled={remainingSeconds <= 0}>−30s</button>
        <button type="button" onClick={() => onAdjust(-15)} disabled={remainingSeconds <= 0}>−15s</button>
        <button type="button" onClick={() => onAdjust(15)}>+15s</button>
        <button type="button" onClick={() => onAdjust(30)}>+30s</button>
      </div>
      <form className="timer-custom-form" onSubmit={(event) => {
        event.preventDefault()
        const total = Number(customMinutes || 0) * 60 + Number(customSeconds || 0)
        if (Number.isInteger(total) && total >= 15 && total <= 600) onSelectDuration(total)
      }}>
        <label>
          <span>MIN</span>
          <input aria-label="Custom rest minutes" inputMode="numeric" type="number" min="0" max="10" value={customMinutes} onChange={(event) => setCustomMinutes(event.currentTarget.value)} />
        </label>
        <label>
          <span>SEC</span>
          <input aria-label="Custom rest seconds" inputMode="numeric" type="number" min="0" max="59" value={customSeconds} onChange={(event) => setCustomSeconds(event.currentTarget.value)} />
        </label>
        <button type="submit">Set custom</button>
      </form>
      <div className="timer-controls">
        {running ? (
          <button className="timer-main-button" onClick={onPause}><Icon name="pause" size={15} /> Pause</button>
        ) : (
          <button className="timer-main-button" onClick={onStart} disabled={remainingSeconds === 0}>
            <Icon name="play" size={15} /> {deadline ? 'Resume' : remainingSeconds === durationSeconds ? 'Start' : 'Resume'}
          </button>
        )}
        <button className="timer-reset-button" onClick={onReset}><Icon name="reset" size={15} /> Reset</button>
        <button className="timer-reset-button" onClick={onSkip} disabled={remainingSeconds === 0 && !running}>Skip rest</button>
        <SoundToggle />
        {notificationAvailable && (!pushConfigured || notificationPermission !== 'granted') && (
          <button className="timer-notification-button" onClick={onEnableNotifications}>
            Enable background alerts
          </button>
        )}
      </div>
      <div className="timer-settings" aria-label="Rest timer settings">
        <label><input type="checkbox" checked={autoStartOnSet} onChange={(event) => onToggleAutoStart(event.currentTarget.checked)} /> Auto-start after completed set</label>
        <label><input type="checkbox" checked={countdownWarnings} onChange={(event) => onToggleCountdownWarnings(event.currentTarget.checked)} /> 10 / 5 / 3 second warnings</label>
        <label><input type="checkbox" checked={vibrationEnabled} onChange={(event) => onToggleVibration(event.currentTarget.checked)} /> Vibration alerts</label>
      </div>
      <p className="timer-note" aria-live="polite">
        {notice ?? (remainingSeconds === 0
          ? 'Rest complete. Take the next set when you’re ready.'
          : 'Background alerts require permission and an internet connection when the timer is scheduled.')}
      </p>
    </section>
  )
}

export function HistoryPage({
  history,
  onDelete,
}: {
  history: WorkoutRecord[]
  onDelete: (recordId: string) => void
}) {
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null)

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORK, AT YOUR PACE</div>
          <h1>Workout history.</h1>
          <p className="page-subtitle">A private record of sessions completed on this device.</p>
        </div>
        <div className="weekly-chip"><Icon name="clock" size={15} /> {history.length} {history.length === 1 ? 'SESSION' : 'SESSIONS'}</div>
      </div>
      {history.length === 0 ? (
        <section className="coming-soon panel history-empty">
          <div className="eyebrow">NOTHING TO CATCH UP ON</div>
          <h2>No completed sessions yet.</h2>
          <p>Once you finish a workout, its exercises, sets, reps, and weights will be saved here.</p>
        </section>
      ) : (
        <div className="history-list">
          {history.map((record) => {
            const isOpen = selectedRecord === record.id
            return (
              <article className="history-card panel" key={record.id}>
                <div className="history-card-top">
                  <div className="history-date">
                    <span className="eyebrow">{new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(record.completedAt)}</span>
                    <h2>{record.workoutName} day</h2>
                    <p><Icon name="clock" size={14} /> {formatDuration(record.durationSeconds)} · {record.exercises.length} exercises</p>
                    {record.readinessAdjusted && <span className="readiness-adjusted-history">READINESS SCALED SESSION · ACTUAL COMPLETED SETS SHOWN BELOW</span>}
                  </div>
                  <span className="history-done"><Icon name="check" size={14} /> COMPLETE</span>
                </div>
                <div className="history-actions">
                  <button
                    className="text-link"
                    onClick={() => setSelectedRecord(isOpen ? null : record.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? 'Hide details' : 'View details'} <Icon name="arrow" size={15} />
                  </button>
                  <button
                    className="history-delete-button"
                    onClick={() => {
                      if (window.confirm(`Delete this ${record.workoutName} workout from history?`)) {
                        onDelete(record.id)
                        setSelectedRecord(null)
                      }
                    }}
                  >
                    <Icon name="trash" size={14} /> Delete
                  </button>
                </div>
                {isOpen && (
                  <div className="history-details">
                    {record.exercises.map((exercise) => (
                      <section className="history-exercise" key={exercise.exerciseId}>
                        <div className="history-exercise-heading">
                          <div><h3>{exercise.name}</h3>{exercise.originalExerciseId && <span className="history-substitution-label">SUB FOR {getSubstitutionDefinition(exercise.originalExerciseId)?.name ?? exercise.originalExerciseId} · {exercise.substitutionReason?.replaceAll('-', ' ')}</span>}</div>
                          <span>{exercise.completed ? 'DONE' : 'NOT MARKED DONE'}</span>
                        </div>
                        <p>{exercise.instructions}</p>
                        <div className="history-set-list">
                          {exercise.sets.map((set, index) => (
                            <div className="history-set-row" key={set.id}>
                              <span>Set {index + 1}</span>
                              <strong>{set.weightKg === null ? '—' : `${set.weightKg} kg`} · {set.reps === null ? '—' : `${set.reps} reps`}</strong>
                              <span className={set.completed ? 'set-history-done' : ''}>{set.completed ? 'Complete' : 'Skipped'}</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60)
  return minutes > 0 ? `${minutes} min` : 'Less than a minute'
}
