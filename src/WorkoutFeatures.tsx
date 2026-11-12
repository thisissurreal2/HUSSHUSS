import { useState } from 'react'
import { playSound } from './sound'
import { SoundToggle } from './soundToggle'
import { restPresets, type ActiveWorkout, type SetEntry, type WorkoutRecord } from './workoutStorage'
import { PreviousPerformance } from './StrengthProgress'
import type { ChecklistItem, Workout } from './workouts'

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

export function WorkoutSession({
  workout,
  activeWorkout,
  history,
  onChange,
  onFinish,
  onCancel,
  ...timerProps
}: {
  workout: Workout
  activeWorkout: ActiveWorkout
  history: WorkoutRecord[]
  onChange: (change: (current: ActiveWorkout) => ActiveWorkout) => void
  onFinish: () => void
  onCancel: () => void
} & RestTimerProps) {
  const completedExercises = activeWorkout.exercises.filter((exercise) => exercise.completed).length
  const allExercisesComplete = completedExercises === workout.exercises.length

  return (
    <section className="workout-session panel" aria-label={`${workout.name} workout session`}>
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
          return (
            <article
              className={`session-exercise ${state.completed ? 'exercise-complete' : ''}`}
              key={exercise.id}
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
                Target · {exercise.targetSets} sets × {/\b(seconds?|per side|per leg)\b/i.test(exercise.targetReps)
                  ? exercise.targetReps
                  : `${exercise.targetReps} reps`}
              </div>
              <PreviousPerformance
                history={history}
                exercise={{ exerciseId: exercise.id, targetReps: exercise.targetReps }}
                activeExercise={state}
              />

              <div className="set-table">
                <div className="set-row set-labels" aria-hidden="true">
                  <span>SET</span><span>KG</span><span>REPS</span><span>DONE</span><span />
                </div>
                {state.sets.map((set, setIndex) => (
                  <div className="set-row" key={set.id}>
                    <span className="set-index">{String(setIndex + 1).padStart(2, '0')}</span>
                    <label className="visually-hidden" htmlFor={`${set.id}-weight`}>{exercise.name} set {setIndex + 1} weight in kilograms</label>
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
                    <label className="visually-hidden" htmlFor={`${set.id}-reps`}>{exercise.name} set {setIndex + 1} repetitions</label>
                    <input
                      id={`${set.id}-reps`}
                      className="set-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="—"
                      value={set.reps}
                      onChange={(event) => {
                        const value = event.currentTarget.value
                        if (value === '' || (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 500)) {
                          onChange((current) => updateSet(current, exercise.id, set.id, (item) => ({ ...item, reps: value })))
                        }
                      }}
                    />
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
            </article>
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
  notice: string | null
  onSelectDuration: (seconds: number) => void
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onEnableNotifications: () => void
}

export function RestTimer({
  durationSeconds,
  remainingSeconds,
  running,
  deadline,
  notificationAvailable,
  notificationPermission,
  notice,
  onSelectDuration,
  onStart,
  onPause,
  onReset,
  onEnableNotifications,
}: RestTimerProps) {
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
      <div className="timer-controls">
        {running ? (
          <button className="timer-main-button" onClick={onPause}><Icon name="pause" size={15} /> Pause</button>
        ) : (
          <button className="timer-main-button" onClick={onStart} disabled={remainingSeconds === 0}>
            <Icon name="play" size={15} /> {deadline ? 'Resume' : remainingSeconds === durationSeconds ? 'Start' : 'Resume'}
          </button>
        )}
        <button className="timer-reset-button" onClick={onReset}><Icon name="reset" size={15} /> Reset</button>
        <SoundToggle />
        {notificationAvailable && notificationPermission !== 'granted' && (
          <button className="timer-notification-button" onClick={onEnableNotifications}>
            Enable alert
          </button>
        )}
      </div>
      <p className="timer-note" aria-live="polite">
        {notice ?? (remainingSeconds === 0
          ? 'Rest complete. Take the next set when you’re ready.'
          : 'Uses an absolute deadline to catch up after the browser wakes. Background alerts may be delayed while suspended.')}
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
                          <h3>{exercise.name}</h3>
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
