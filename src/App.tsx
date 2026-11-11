import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HistoryPage, WorkoutSession, type RestTimerProps } from './WorkoutFeatures'
import { PerformanceDashboard } from './PerformanceDashboard'
import { StrengthProgressPage } from './StrengthProgress'
import { BodyMeasurements } from './BodyMeasurements'
import { AthleticDevelopment } from './AthleticDevelopment'
import { PersonalInsights } from './PersonalInsights'
import { BackupRecovery } from './BackupRecovery'
import { readMeasurementData } from './measurementStorage'
import { readAthleticData } from './athleticStorage'
import {
  createActiveWorkout,
  createWorkoutRecord,
  createInitialData,
  readAppData,
  writeAppData,
  type ActiveWorkout,
  type AppData,
} from './workoutStorage'
import { getLowerBodyExercise, getWorkout, workouts, type Workout, type WorkoutId } from './workouts'
import './App.css'

type IconName =
  | 'activity'
  | 'arrow'
  | 'body'
  | 'check'
  | 'chevron'
  | 'clock'
  | 'grid'
  | 'moon'
  | 'spark'
  | 'target'
  | 'trend'

const navigation: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'rotation', label: 'Your rotation', icon: 'activity' },
  { id: 'history', label: 'Workout history', icon: 'clock' },
  { id: 'progress', label: 'Progress', icon: 'trend' },
  { id: 'body', label: 'Measurements', icon: 'body' },
]

type Tab = 'overview' | 'rotation' | 'history' | 'progress' | 'body'
type ProgressView = 'dashboard' | 'strength' | 'athletic' | 'insights' | 'backup'

function Icon({
  name,
  size = 20,
}: {
  name: IconName
  size?: number
}) {
  const paths: Record<IconName, ReactNode> = {
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    body: <><circle cx="12" cy="5" r="2" /><path d="M12 7v5m-4 9 2-6h4l2 6m-8-8 4 2 4-2" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    moon: <><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
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

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [progressView, setProgressView] = useState<ProgressView>('dashboard')
  const [data, setData] = useState<AppData>(createInitialData)
  const dataRef = useRef(data)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [dataReady, setDataReady] = useState(false)
  const [workoutWriteAvailable, setWorkoutWriteAvailable] = useState(false)
  const [timerNotice, setTimerNotice] = useState<string | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )
  const audioContextRef = useRef<AudioContext | null>(null)
  const completedTimerRef = useRef<number | null>(null)
  const [now] = useState(() => new Date())
  const workout = data.currentWorkout
    ? data.currentWorkout.template
    : workouts[data.rotationIndex]
  const dateLabel = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now)
  const greeting = now.getHours() < 12
    ? 'Good morning.'
    : now.getHours() < 18
      ? 'Good afternoon.'
      : 'Good evening.'

  useEffect(() => {
    let active = true
    void Promise.all([readAppData(), readMeasurementData(), readAthleticData()])
      .then(([workoutsResult, measurementsResult, athleticResult]) => {
        if (!active) return
        dataRef.current = workoutsResult.data
        setData(workoutsResult.data)
        setWorkoutWriteAvailable(workoutsResult.usable)
        const errors = [
          workoutsResult.error,
          measurementsResult.error,
          athleticResult.error,
        ].filter((error): error is string => error !== null)
        setStorageError(errors.length > 0 ? errors.join(' ') : null)
        setDataReady(true)
      })
      .catch((error: unknown) => {
        if (active) {
          setStorageError(`Local IndexedDB could not be initialized: ${error instanceof Error ? error.message : 'unknown error'}`)
          setWorkoutWriteAvailable(false)
          setDataReady(true)
        }
      })
    return () => { active = false }
  }, [])

  const updateData = useCallback((change: (current: AppData) => AppData) => {
    if (!dataReady || !workoutWriteAvailable) return
    const current = dataRef.current
    const next = change(current)
    if (next === current) return

    dataRef.current = next
    setData(next)
    void writeAppData(next)
      .then(() => setStorageError((error) => error?.startsWith('Workout data could not be saved') ? null : error))
      .catch((error: unknown) => {
        setStorageError(`Workout data could not be saved to IndexedDB: ${error instanceof Error ? error.message : 'unknown error'}`)
      })
  }, [dataReady, workoutWriteAvailable])

  function startWorkout() {
    const current = dataRef.current
    if (current.currentWorkout) {
      setActiveTab('overview')
      window.requestAnimationFrame(() => document.getElementById('active-workout')?.scrollIntoView({ behavior: 'smooth' }))
      return
    }
    const nextWorkoutId: WorkoutId = workouts[current.rotationIndex].id
    updateData((latest) => ({
      ...latest,
      currentWorkout: createActiveWorkout(nextWorkoutId),
      recoverySelected: false,
    }))
    setActiveTab('overview')
    window.requestAnimationFrame(() => document.getElementById('active-workout')?.scrollIntoView({ behavior: 'smooth' }))
  }

  function updateCurrentWorkout(change: (current: ActiveWorkout) => ActiveWorkout) {
    updateData((current) => current.currentWorkout
      ? { ...current, currentWorkout: change(current.currentWorkout) }
      : current)
  }

  function cancelWorkout(selectRecovery = false) {
    const current = dataRef.current.currentWorkout
    if (!current) return
    const name = getWorkout(current.workoutId).name
    const recoveryMessage = selectRecovery ? ' Today will be marked as a recovery day.' : ''
    if (!window.confirm(`Cancel this ${name} workout? It will not be added to history, and you can start it again later.${recoveryMessage}`)) return
    updateData((latest) => latest.currentWorkout?.id !== current.id
      ? latest
      : {
          ...latest,
          currentWorkout: null,
          recoverySelected: selectRecovery,
          timerRunning: false,
          timerDeadline: null,
          timerRemainingSeconds: latest.restDurationSeconds,
        })
  }

  function finishWorkout() {
    const current = dataRef.current.currentWorkout
    if (!current || current.exercises.some((exercise) => !exercise.completed)) return
    if (dataRef.current.history.some((record) => record.id === current.id)) return

    try {
      const record = createWorkoutRecord(current)
      updateData((latest) => {
        if (latest.currentWorkout?.id !== current.id
          || latest.history.some((item) => item.id === record.id)) return latest
        return {
          ...latest,
          rotationIndex: (latest.rotationIndex + 1) % workouts.length,
          currentWorkout: null,
          history: [record, ...latest.history],
          recoverySelected: false,
          timerRunning: false,
          timerDeadline: null,
          timerRemainingSeconds: latest.restDurationSeconds,
        }
      })
    } catch {
      setStorageError('The workout could not be completed. Your current session is still available to resume.')
    }
  }

  function selectRestDuration(seconds: number) {
    updateData((current) => ({
      ...current,
      restDurationSeconds: seconds,
      timerRemainingSeconds: seconds,
      timerDeadline: null,
      timerRunning: false,
    }))
    setTimerNotice(null)
  }

  function startRestTimer() {
    const current = dataRef.current
    const remaining = current.timerRemainingSeconds || current.restDurationSeconds
    const deadline = Date.now() + remaining * 1000
    completedTimerRef.current = null
    updateData((latest) => ({
      ...latest,
      timerRemainingSeconds: remaining,
      timerDeadline: deadline,
      timerRunning: true,
    }))
    setTimerNotice(null)
    try {
      if (!audioContextRef.current && typeof window.AudioContext !== 'undefined') {
        audioContextRef.current = new window.AudioContext()
      }
      void audioContextRef.current?.resume().catch(() => {
        setTimerNotice('The timer is running. Browser sound is unavailable; keep the timer visible for its on-screen alert.')
      })
    } catch {
      setTimerNotice('The timer is running. Browser sound is unavailable; keep the timer visible for its on-screen alert.')
    }
  }

  function pauseRestTimer() {
    const current = dataRef.current
    const remaining = current.timerDeadline === null
      ? current.timerRemainingSeconds
      : Math.max(0, Math.ceil((current.timerDeadline - Date.now()) / 1000))
    updateData((latest) => ({
      ...latest,
      timerRemainingSeconds: remaining,
      timerDeadline: null,
      timerRunning: false,
    }))
  }

  function resetRestTimer() {
    completedTimerRef.current = null
    updateData((current) => ({
      ...current,
      timerRemainingSeconds: current.restDurationSeconds,
      timerDeadline: null,
      timerRunning: false,
    }))
    setTimerNotice(null)
  }

  function alertRestTimerFinished() {
    let notificationShown = false
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification('Rest timer complete', { body: 'Take the next set when you’re ready.' })
        notificationShown = true
      } catch {
        setTimerNotice('Rest complete. Take the next set when you’re ready.')
      }
    }

    const context = audioContextRef.current
    if (context) {
      void context.resume().then(() => {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = 660
        gain.gain.setValueAtTime(0.0001, context.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start()
        oscillator.stop(context.currentTime + 0.46)
      }).catch(() => setTimerNotice('Rest complete. Take the next set when you’re ready.'))
    } else if (!notificationShown) {
      setTimerNotice('Rest complete. Take the next set when you’re ready.')
    }
  }

  async function enableTimerNotifications() {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      setTimerNotice('Notifications are not supported here. The timer will use on-screen and sound alerts where available.')
      return
    }
    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      setTimerNotice(permission === 'granted'
        ? 'Timer notifications enabled.'
        : 'Notifications were not enabled. The timer can still use sound and on-screen alerts.')
    } catch {
      setTimerNotice('Notification permission could not be requested. The timer can still use sound and on-screen alerts.')
    }
  }

  useEffect(() => {
    if (!data.timerRunning || data.timerDeadline === null) return
    const deadline = data.timerDeadline
    const updateRemaining = () => {
      const current = dataRef.current
      if (!current.timerRunning || current.timerDeadline !== deadline) return
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      if (remaining === 0) {
        updateData((latest) => latest.timerDeadline !== deadline
          ? latest
          : { ...latest, timerRunning: false, timerDeadline: null, timerRemainingSeconds: 0 })
        if (completedTimerRef.current !== deadline) {
          completedTimerRef.current = deadline
          alertRestTimerFinished()
        }
      } else if (remaining !== current.timerRemainingSeconds) {
        updateData((latest) => latest.timerDeadline !== deadline
          ? latest
          : { ...latest, timerRemainingSeconds: remaining })
      }
    }
    updateRemaining()
    const intervalId = window.setInterval(updateRemaining, 250)
    return () => window.clearInterval(intervalId)
  }, [data.timerDeadline, data.timerRunning, updateData])

  function deleteHistoryRecord(recordId: string) {
    updateData((current) => ({
      ...current,
      history: current.history.filter((record) => record.id !== recordId),
    }))
  }

  function goToTab(tab: Tab) {
    setActiveTab(tab)
  }

  if (!dataReady) {
    return (
      <div className="app-shell min-h-screen">
        <main className="main-content" role="status">Opening your local HUSSHUSS database…</main>
      </div>
    )
  }

  return (
    <div className="app-shell min-h-screen">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(event) => {
            event.preventDefault()
            goToTab('overview')
          }}
          aria-label="HUSSHUSS home"
        >
          <BrandMark />
          <span>HUSS<span className="brand-light">HUSS</span></span>
        </a>

        <div className="sidebar-label">YOUR SPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`nav-link ${activeTab === item.id ? 'selected' : ''}`}
              key={item.id}
              onClick={() => goToTab(item.id)}
              aria-current={activeTab === item.id ? 'page' : undefined}
            >
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === 'rotation' && <span className="nav-count">03</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <div className="note-icon"><Icon name="moon" size={17} /></div>
          <p>Rest is part of the work.</p>
          <span>Take the day you need.</span>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          PHASE 3.5 · ON THIS DEVICE
        </div>
      </aside>

      <div className="page-column">
        <header className="topbar">
          <div className="mobile-brand">
            <BrandMark />
            <span>HUSS<span className="brand-light">HUSS</span></span>
          </div>
          <div className="topbar-date"><span className="status-dot" /> {dateLabel}</div>
          <div className="topbar-profile" aria-label="HUSSHUSS profile">
            <span>H</span>
          </div>
        </header>

        <main className="main-content">
          {activeTab === 'overview' && (
            <Overview
              workout={workout}
              activeWorkout={data.currentWorkout}
              recoverySelected={data.recoverySelected}
              greeting={greeting}
              completedCount={data.history.length}
              history={data.history}
              onStart={startWorkout}
              onRecover={() => updateData((current) => current.currentWorkout
                ? current
                : { ...current, recoverySelected: true })}
              onResume={startWorkout}
              onCancel={() => cancelWorkout()}
              onCancelToRecover={() => cancelWorkout(true)}
              onFinish={finishWorkout}
              onWorkoutChange={updateCurrentWorkout}
              timer={{
                durationSeconds: data.restDurationSeconds,
                remainingSeconds: data.timerRemainingSeconds,
                running: data.timerRunning,
                deadline: data.timerDeadline,
                notificationAvailable: typeof Notification !== 'undefined',
                notificationPermission,
                notice: timerNotice,
                onSelectDuration: selectRestDuration,
                onStart: startRestTimer,
                onPause: pauseRestTimer,
                onReset: resetRestTimer,
                onEnableNotifications: () => { void enableTimerNotifications() },
              }}
              onOpenRotation={() => goToTab('rotation')}
            />
          )}
          {activeTab === 'rotation' && (
            <RotationPage
              rotationIndex={data.rotationIndex}
              onStart={startWorkout}
            />
          )}
          {activeTab === 'history' && (
            <HistoryPage history={data.history} onDelete={deleteHistoryRecord} />
          )}
          {activeTab === 'progress' && (
            <div className="progress-tab-content">
              <div className="progress-view-tabs" aria-label="Progress views">
                <button
                  type="button"
                  className={progressView === 'dashboard' ? 'selected' : ''}
                  aria-pressed={progressView === 'dashboard'}
                  onClick={() => setProgressView('dashboard')}
                >
                  Performance dashboard
                </button>
                <button
                  type="button"
                  className={progressView === 'strength' ? 'selected' : ''}
                  aria-pressed={progressView === 'strength'}
                  onClick={() => setProgressView('strength')}
                >
                  Exercise progression
                </button>
                <button
                  type="button"
                  className={progressView === 'athletic' ? 'selected' : ''}
                  aria-pressed={progressView === 'athletic'}
                  onClick={() => setProgressView('athletic')}
                >
                  Athletic development
                </button>
                <button
                  type="button"
                  className={progressView === 'insights' ? 'selected' : ''}
                  aria-pressed={progressView === 'insights'}
                  onClick={() => setProgressView('insights')}
                >
                  Personal insights
                </button>
                <button
                  type="button"
                  className={progressView === 'backup' ? 'selected' : ''}
                  aria-pressed={progressView === 'backup'}
                  onClick={() => setProgressView('backup')}
                >
                  Backup & sync
                </button>
              </div>
              <div hidden={progressView !== 'dashboard'}>
                <PerformanceDashboard
                  history={data.history}
                  onOpenHistory={() => setActiveTab('history')}
                  onOpenStrengthProgress={() => setProgressView('strength')}
                />
              </div>
              <div hidden={progressView !== 'strength'}>
                <StrengthProgressPage history={data.history} />
              </div>
              <div hidden={progressView !== 'athletic'}>
                <AthleticDevelopment />
              </div>
              <div hidden={progressView !== 'insights'}>
                <PersonalInsights history={data.history} />
              </div>
              <div hidden={progressView !== 'backup'}>
                <BackupRecovery onRestored={() => window.location.reload()} />
              </div>
            </div>
          )}
          {activeTab === 'body' && <BodyMeasurements />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <button
            className={`mobile-nav-link ${activeTab === item.id ? 'selected' : ''}`}
            key={item.id}
            onClick={() => goToTab(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.id === 'overview'
              ? 'Home'
              : item.id === 'rotation'
                ? 'Plan'
                : item.id === 'history'
                  ? 'History'
                : item.id === 'progress'
                  ? 'Progress'
                  : 'Body'}</span>
          </button>
        ))}
      </nav>
      {storageError && (
        <div className="storage-alert" role="alert">
          <strong>Local data notice</strong>
          <span>{storageError}</span>
          <button onClick={() => setStorageError(null)} aria-label="Dismiss data notice">Dismiss</button>
        </div>
      )}
    </div>
  )
}

function Overview({
  workout,
  activeWorkout,
  recoverySelected,
  greeting,
  completedCount,
  history,
  onStart,
  onRecover,
  onResume,
  onCancel,
  onCancelToRecover,
  onFinish,
  onWorkoutChange,
  timer,
  onOpenRotation,
}: {
  workout: Workout
  activeWorkout: ActiveWorkout | null
  recoverySelected: boolean
  greeting: string
  completedCount: number
  history: AppData['history']
  onStart: () => void
  onRecover: () => void
  onResume: () => void
  onCancel: () => void
  onCancelToRecover: () => void
  onFinish: () => void
  onWorkoutChange: (change: (current: ActiveWorkout) => ActiveWorkout) => void
  timer: RestTimerProps
  onOpenRotation: () => void
}) {
  const dayStatus = activeWorkout ? 'active' : recoverySelected ? 'recovery' : 'planned'
  const lowerBodyExercise = getLowerBodyExercise(workout)

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE BETTER, EVERY SESSION</div>
          <h1>{greeting}</h1>
          <p className="page-subtitle">Make today’s training work for you.</p>
        </div>
        <div className="weekly-chip"><Icon name="spark" size={16} /> YOUR PACE, YOURS</div>
      </div>

      <section className={`hero-card ${dayStatus === 'recovery' ? 'recovery-hero' : ''}`}>
        <div className="hero-glow" />
        <div className="hero-content">
          <div className="hero-kicker">
            <span className="hero-kicker-dot" />
            {dayStatus === 'recovery'
              ? 'TODAY · RECOVERY'
              : dayStatus === 'active'
                ? 'WORKOUT IN PROGRESS'
                  : 'YOUR NEXT SESSION'}
          </div>
          <h2>
            {dayStatus === 'recovery'
              ? 'Take the space you need.'
              : dayStatus === 'active'
                ? `${workout.name}, in progress.`
                : `${workout.name}, on your terms.`}
          </h2>
          <p>
            {dayStatus === 'recovery'
              ? `Your next session is still ${workout.name}. Pick it up when you feel ready.`
              : dayStatus === 'active'
                ? `${activeWorkout?.exercises.filter((exercise) => !exercise.completed).length ?? 0} exercises left. Your session is saved on this device.`
                : workout.description}
          </p>
          {dayStatus === 'active' ? (
            <button className="button-primary" onClick={onResume}>
              Resume workout <Icon name="arrow" size={17} />
            </button>
          ) : (
            <button className="button-primary" onClick={onStart}>
              {dayStatus === 'recovery' ? `Start ${workout.name} when ready` : `Start ${workout.name} workout`}
              <Icon name="arrow" size={17} />
            </button>
          )}
          {dayStatus === 'planned' && (
            <button className="button-text" onClick={onRecover}>
              <Icon name="moon" size={16} /> Make today a recovery day
            </button>
          )}
          {dayStatus === 'active' && (
            <button className="button-text" onClick={onCancelToRecover}>
              <Icon name="moon" size={16} /> Cancel and take a recovery day
            </button>
          )}
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core"><BrandMark /></div>
          <span className="orbit-label orbit-label-top">{dayStatus === 'recovery' ? 'REST' : 'MOVE'}</span>
          <span className="orbit-label orbit-label-bottom">{dayStatus === 'recovery' ? 'RESET' : 'RECOVER'}</span>
        </div>
        <div className="hero-foot">
          <span><Icon name="clock" size={15} /> {dayStatus === 'recovery' ? 'No schedule to catch up on' : workout.duration}</span>
          <span className="hero-foot-divider" />
          <span><Icon name="target" size={15} /> {dayStatus === 'recovery' ? 'Next up' : workout.focus}</span>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <div className="eyebrow">YOUR TRAINING, AT A GLANCE</div>
          <h2>The plan</h2>
        </div>
        <button className="text-link" onClick={onOpenRotation}>
          See rotation <Icon name="arrow" size={16} />
        </button>
      </div>

      <div className="dashboard-grid">
        <section className="panel next-panel">
          <div className="panel-topline">
            <span className="panel-label">UP NEXT</span>
            <span className="tiny-pill"><span className="status-dot" /> READY WHEN YOU ARE</span>
          </div>
          <div className="next-workout-row">
            <div className="workout-index">{String(workouts.findIndex((item) => item.id === workout.id) + 1).padStart(2, '0')}</div>
            <div className="next-workout-copy">
              <h3>{workout.name}</h3>
              <p>{workout.focus}</p>
            </div>
            <button
              className="round-arrow"
              onClick={onStart}
              aria-label={activeWorkout ? 'Resume workout' : 'Start workout'}
            >
              <Icon name="chevron" size={18} />
            </button>
          </div>
          <div className="panel-divider" />
          <div className="leg-exercise">
            <span className="leg-icon"><Icon name="activity" size={17} /></span>
            <div><span className="micro-label">ONE LOWER-BODY MOVEMENT</span><strong>{lowerBodyExercise.name} · {lowerBodyExercise.focus}</strong></div>
          </div>
          <p className="panel-footnote">Lower-body focus changes each session. Keep the effort comfortable; take recovery whenever you need it.</p>
        </section>

        <section className="panel recovery-panel">
          <div className="recovery-icon"><Icon name="moon" size={19} /></div>
          <div className="eyebrow">RECOVERY COUNTS</div>
          <h3>No streaks. No pressure.</h3>
          <p>There’s no daily target to keep up with. Rest days never move your rotation forward.</p>
          <div className="recovery-footer">
            <span className="recovery-status"><span className="status-dot" /> {dayStatus === 'recovery' ? 'RECOVERY SELECTED' : 'OPTIONAL, ALWAYS'}</span>
            {dayStatus === 'planned' && <button className="recovery-link" onClick={onRecover}>Choose rest <Icon name="arrow" size={14} /></button>}
          </div>
        </section>

        <section className="panel rhythm-panel">
          <div className="panel-label">YOUR RHYTHM</div>
          <div className="rhythm-number">{String(completedCount).padStart(2, '0')}</div>
          <div className="rhythm-caption">completed sessions saved</div>
          <div className="rhythm-note"><Icon name="spark" size={15} /> Small steps count.</div>
        </section>
      </div>

      {activeWorkout && (
        <div id="active-workout">
          <WorkoutSession
            workout={workout}
            activeWorkout={activeWorkout}
            history={history}
            onChange={onWorkoutChange}
            onFinish={onFinish}
            onCancel={onCancel}
            {...timer}
          />
        </div>
      )}
    </>
  )
}

function RotationPage({
  rotationIndex,
  onStart,
}: {
  rotationIndex: number
  onStart: () => void
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A FLEXIBLE TRAINING RHYTHM</div>
          <h1>Your rotation.</h1>
          <p className="page-subtitle">Continue where you left off. No daily schedule required.</p>
        </div>
        <div className="weekly-chip"><Icon name="moon" size={16} /> REST DAYS ARE BUILT IN</div>
      </div>
      <section className="rotation-intro panel">
        <div className="rotation-intro-icon"><Icon name="activity" size={21} /></div>
        <div>
          <div className="eyebrow">UP NEXT · {String(rotationIndex + 1).padStart(2, '0')} OF 03</div>
          <h2>{workouts[rotationIndex].name}</h2>
          <p>The sequence only moves forward when you mark a session complete. A recovery day leaves it right here.</p>
        </div>
        <button className="button-primary" onClick={onStart}>Start workout <Icon name="arrow" size={17} /></button>
      </section>
      <div className="rotation-list">
        {workouts.map((item, index) => (
          <article className={`rotation-card panel ${index === rotationIndex ? 'current' : ''}`} key={item.id}>
            <div className="rotation-card-top">
              <span className="rotation-card-number">{String(index + 1).padStart(2, '0')}</span>
              {index === rotationIndex && <span className="tiny-pill"><span className="status-dot" /> UP NEXT</span>}
            </div>
            <h3>{item.name}</h3>
            <p>{item.focus}</p>
            <div className="rotation-card-divider" />
            <div className="leg-exercise">
              <span className="leg-icon"><Icon name="activity" size={17} /></span>
              <div><span className="micro-label">LOWER-BODY MOVEMENT</span><strong>{getLowerBodyExercise(item).name} · {getLowerBodyExercise(item).focus}</strong></div>
            </div>
            <div className="rotation-duration"><Icon name="clock" size={15} /> {item.duration}</div>
          </article>
        ))}
      </div>
      <p className="rotation-note"><Icon name="moon" size={16} /> Take a full rest day or an easy day between sessions whenever you need it. Nothing is scheduled automatically.</p>
    </>
  )
}

export default App
