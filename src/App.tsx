import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HistoryPage, WorkoutSession, type RestTimerProps } from './WorkoutFeatures'
import { PerformanceDashboard } from './PerformanceDashboard'
import { StrengthProgressPage } from './StrengthProgress'
import { MuscleBalance } from './MuscleBalance.tsx'
import { BrandMark, BrandWordmark } from './BrandIdentity'
import { mascots } from './mascots'
import { BodyMeasurements } from './BodyMeasurements'
import { AthleticDevelopment } from './AthleticDevelopment'
import { PersonalInsights } from './PersonalInsights'
import { XpCard } from './xpCard'
import { didWorkoutLevelUp } from './xp'
import { isSoundEnabled, playSound, unlockSound } from './sound'
import {
  cancelRestPush,
  enablePushNotifications,
  hasPushRegistration,
  registerPushServiceWorker,
  scheduleRestPush,
} from './pushNotifications'
import { BackupRecovery } from './BackupRecovery'
import { readMeasurementData } from './measurementStorage'
import { readAthleticData } from './athleticStorage'
import {
  createActiveWorkout,
  createWorkoutRecord,
  type WorkoutRecord,
  createInitialData,
  readAppData,
  writeAppData,
  type ActiveWorkout,
  type AppData,
} from './workoutStorage'
import { getLowerBodyExercises, workouts, type Workout, type WorkoutId } from './workouts'
import { ExtrasPage } from './ExtrasPage'
import { IsoTeFlePage } from './IsoTeFle'
import { ReadinessPage } from './ReadinessView'
import { getLocalDateKey, upsertReadinessCheckIn, type ReadinessCheckIn } from './readiness'
import { ReadinessDecisionPanel } from './ReadinessActions'
import { chooseWorkoutPlan, createRecoverySession, getTrainingRecommendation, type RecoveryActivity } from './readinessTraining'
import {
  getExtraRecommendation,
  extraCategories,
  getCategoryExercises,
  type ExtraCategoryId,
  type ExtraSessionRecord,
} from './extras'
import './App.css'
import './ui-polish.css'

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
  { id: 'overview', label: 'Today', icon: 'grid' },
  { id: 'rotation', label: 'Train', icon: 'activity' },
  { id: 'isotefle', label: 'IsoTeFle', icon: 'target' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'progress', label: 'Progress', icon: 'trend' },
  { id: 'body', label: 'Measurements', icon: 'body' },
]

type Tab = 'overview' | 'rotation' | 'isotefle' | 'history' | 'progress' | 'body' | 'extras'
type ProgressView = 'dashboard' | 'strength' | 'muscle' | 'athletic' | 'insights' | 'backup' | 'readiness'

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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [progressView, setProgressView] = useState<ProgressView>('dashboard')
  const [data, setData] = useState<AppData>(createInitialData)
  const dataRef = useRef(data)
  const persistedDataRef = useRef(data)
  const pendingWorkoutWritesRef = useRef(0)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [completedWorkout, setCompletedWorkout] = useState<WorkoutRecord | null>(null)
  const [extraLaunchCategory, setExtraLaunchCategory] = useState<ExtraCategoryId | null>(null)
  const [dataReady, setDataReady] = useState(false)
  const [workoutWriteAvailable, setWorkoutWriteAvailable] = useState(false)
  const [timerNotice, setTimerNotice] = useState<string | null>(null)

  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )

  const [pushConfigured, setPushConfigured] = useState(() => hasPushRegistration())

  const completedTimerRef = useRef<number | null>(null)
  const timerWarningRef = useRef<string | null>(null)
  const finishingWorkoutRef = useRef(false)

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

    void Promise.all([
      readAppData(),
      readMeasurementData(),
      readAthleticData(),
    ])
      .then(([workoutsResult, measurementsResult, athleticResult]) => {
        if (!active) return

        dataRef.current = workoutsResult.data
        persistedDataRef.current = workoutsResult.data
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
          setStorageError(
            `Local IndexedDB could not be initialized: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          )
          setWorkoutWriteAvailable(false)
          setDataReady(true)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void registerPushServiceWorker().catch((error: unknown) => {
      setTimerNotice(
        error instanceof Error
          ? error.message
          : 'Background notification setup is unavailable.',
      )
    })
  }, [])

  const updateData = useCallback((change: (current: AppData) => AppData) => {
    if (!dataReady || !workoutWriteAvailable) return Promise.resolve(false)

    const current = dataRef.current
    const next = change(current)

    if (next === current) return Promise.resolve(true)

    dataRef.current = next
    setData(next)
    pendingWorkoutWritesRef.current += 1

    return writeAppData(next)
      .then(() => {
        persistedDataRef.current = next
        setStorageError((error) =>
          error?.startsWith('Workout data could not be saved') ? null : error,
        )
        return true
      })
      .catch((error: unknown) => {
        setStorageError(
          `Workout data could not be saved to IndexedDB: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        )
        if (import.meta.env.DEV) console.error('HUSHHUSS local workout save failed', error)
        return false
      })
      .finally(() => {
        pendingWorkoutWritesRef.current -= 1
        if (pendingWorkoutWritesRef.current === 0 && dataRef.current !== persistedDataRef.current) {
          dataRef.current = persistedDataRef.current
          setData(persistedDataRef.current)
        }
      })
  }, [dataReady, workoutWriteAvailable])

  function startWorkout(applyScaleBack = false) {
    const current = dataRef.current

    if (current.currentWorkout) {
      setActiveTab('overview')
      window.requestAnimationFrame(() =>
        document.getElementById('active-workout')?.scrollIntoView({
          behavior: 'smooth',
        }),
      )
      return
    }

    const nextWorkoutId: WorkoutId = workouts[current.rotationIndex].id
    const todayCheckIn = current.readiness?.find((entry) => entry.date === getLocalDateKey())
    const shouldScale = applyScaleBack && getTrainingRecommendation(todayCheckIn).category === 'caution'
    const workoutTemplate = shouldScale ? chooseWorkoutPlan(workouts[current.rotationIndex], true) : undefined

    updateData((latest) => ({
      ...latest,
      currentWorkout: createActiveWorkout(
        nextWorkoutId,
        Date.now(),
        latest.history,
        workoutTemplate,
        Boolean(shouldScale),
      ),
      recoverySelected: false,
    }))

    setActiveTab('overview')

    window.requestAnimationFrame(() =>
      document.getElementById('active-workout')?.scrollIntoView({
        behavior: 'smooth',
      }),
    )
  }

  function saveRecovery(activity: RecoveryActivity, duration: number | null, notes: string) {
    const session = createRecoverySession(activity, duration, notes, getLocalDateKey())
    return updateData((current) => ({
      ...current,
      recoverySessions: [session, ...(current.recoverySessions ?? [])],
    }))
  }

  function updateCurrentWorkout(
    change: (current: ActiveWorkout) => ActiveWorkout,
  ) {
    updateData((current) =>
      current.currentWorkout
        ? { ...current, currentWorkout: change(current.currentWorkout) }
        : current,
    )
  }

  function cancelWorkout(selectRecovery = false) {
    const current = dataRef.current.currentWorkout
    if (!current) return

    const name = current.template.name
    const recoveryMessage = selectRecovery
      ? ' Today will be marked as a recovery day.'
      : ''

    if (
      !window.confirm(
        `Cancel this ${name} workout? It will not be added to history, and you can start it again later.${recoveryMessage}`,
      )
    ) {
      return
    }

    updateData((latest) =>
      latest.currentWorkout?.id !== current.id
        ? latest
        : {
            ...latest,
            currentWorkout: null,
            recoverySelected: selectRecovery,
            timerRunning: false,
            timerDeadline: null,
            timerRemainingSeconds: latest.restDurationSeconds,
          },
    )
  }

  async function finishWorkout() {
    const current = dataRef.current.currentWorkout

    if (
      !current ||
      current.exercises.some((exercise) => !exercise.completed) ||
      finishingWorkoutRef.current
    ) {
      return
    }

    if (dataRef.current.history.some((record) => record.id === current.id)) {
      return
    }

    finishingWorkoutRef.current = true
    const previous = dataRef.current

    try {
      const record = createWorkoutRecord(current)

      const next: AppData = {
        ...previous,
        rotationIndex: (previous.rotationIndex + 1) % workouts.length,
        currentWorkout: null,
        history: [record, ...previous.history],
        recoverySelected: false,
        timerRunning: false,
        timerDeadline: null,
        timerRemainingSeconds: previous.restDurationSeconds,
      }

      await writeAppData(next)

      dataRef.current = next
      persistedDataRef.current = next
      setData(next)
      setStorageError(null)
      setCompletedWorkout(record)

      void playSound(
        didWorkoutLevelUp(
          previous.history,
          record,
          previous.extrasSessions ?? [],
        )
          ? 'levelUp'
          : 'finish',
      )
    } catch (error) {
      dataRef.current = previous
      setData(previous)

      setStorageError(
        `The workout could not be completed and saved. Your current session is still available to resume. ${
          error instanceof Error ? error.message : ''
        }`,
      )
    } finally {
      finishingWorkoutRef.current = false
    }
  }

  async function saveExtraSession(session: ExtraSessionRecord) {
    const current = dataRef.current

    if (
      (current.extrasSessions ?? []).some((item) => item.id === session.id)
    ) {
      return
    }

    const next = {
      ...current,
      extrasSessions: [...(current.extrasSessions ?? []), session],
    }

    await writeAppData(next)

    dataRef.current = next
    persistedDataRef.current = next
    setData(next)
    setStorageError(null)

    void playSound('finish')
  }

  function selectRestDuration(seconds: number) {
    void cancelRestPush().catch(() => undefined)

    const safeSeconds = Math.max(15, Math.min(600, Math.round(seconds)))

    timerWarningRef.current = null

    updateData((current) => ({
      ...current,
      restDurationSeconds: safeSeconds,
      timerRemainingSeconds: safeSeconds,
      timerDeadline: null,
      timerRunning: false,
    }))

    setTimerNotice(null)
  }

  function adjustRestTimer(deltaSeconds: number) {
    const current = dataRef.current

    const remaining =
      current.timerRunning && current.timerDeadline !== null
        ? Math.max(
            0,
            Math.ceil((current.timerDeadline - Date.now()) / 1000),
          )
        : current.timerRemainingSeconds

    const nextRemaining = Math.max(
      0,
      Math.min(600, remaining + deltaSeconds),
    )

    const nextDeadline =
      current.timerRunning && nextRemaining > 0
        ? Date.now() + nextRemaining * 1000
        : null

    timerWarningRef.current = null

    updateData((latest) => ({
      ...latest,
      timerRemainingSeconds: nextRemaining,
      timerDeadline: nextDeadline,
      timerRunning: latest.timerRunning && nextRemaining > 0,
    }))

    if (nextDeadline !== null) {
      void scheduleRestPush(nextDeadline).catch((error: unknown) => {
        setPushConfigured(false)
        setTimerNotice(
          error instanceof Error
            ? error.message
            : 'Background alert could not be updated.',
        )
      })
    } else {
      void cancelRestPush().catch(() => undefined)
    }
  }

  function skipRestTimer() {
    void cancelRestPush().catch(() => undefined)

    completedTimerRef.current = null
    timerWarningRef.current = null

    updateData((current) => ({
      ...current,
      timerRemainingSeconds: 0,
      timerDeadline: null,
      timerRunning: false,
    }))

    setTimerNotice('Rest skipped. Continue when you’re ready.')
  }

  function updateTimerPreference(
    key: 'timerAutoStart' | 'timerCountdownWarnings' | 'timerVibration',
    value: boolean,
  ) {
    updateData((current) => ({
      ...current,
      [key]: value,
    }))
  }

  function startRestTimer(restartFullDuration = false) {
    const current = dataRef.current

    const remaining = restartFullDuration
      ? current.restDurationSeconds
      : current.timerRemainingSeconds || current.restDurationSeconds

    const deadline = Date.now() + remaining * 1000

    completedTimerRef.current = null
    timerWarningRef.current = null

    updateData((latest) => ({
      ...latest,
      timerRemainingSeconds: remaining,
      timerDeadline: deadline,
      timerRunning: true,
    }))

    setTimerNotice(null)

    if (pushConfigured) {
      void scheduleRestPush(deadline).catch((error: unknown) => {
        setPushConfigured(false)
        setTimerNotice(
          error instanceof Error
            ? error.message
            : 'Background alert could not be scheduled.',
        )
      })
    }

    if (isSoundEnabled()) {
      void unlockSound().then((unlocked) => {
        if (!unlocked && isSoundEnabled()) {
          setTimerNotice(
            'The timer is running. Browser sound is unavailable; keep the timer visible for its on-screen alert.',
          )
        }
      })
    }
  }

  function pauseRestTimer() {
    void cancelRestPush().catch(() => undefined)

    const current = dataRef.current

    const remaining =
      current.timerDeadline === null
        ? current.timerRemainingSeconds
        : Math.max(
            0,
            Math.ceil((current.timerDeadline - Date.now()) / 1000),
          )

    updateData((latest) => ({
      ...latest,
      timerRemainingSeconds: remaining,
      timerDeadline: null,
      timerRunning: false,
    }))
  }

  function resetRestTimer() {
    void cancelRestPush().catch(() => undefined)

    completedTimerRef.current = null
    timerWarningRef.current = null

    updateData((current) => ({
      ...current,
      timerRemainingSeconds: current.restDurationSeconds,
      timerDeadline: null,
      timerRunning: false,
    }))

    setTimerNotice(null)
  }

  const alertRestTimerFinished = useCallback(async () => {
    if (
      dataRef.current.timerVibration &&
      typeof navigator !== 'undefined' &&
      'vibrate' in navigator
    ) {
      navigator.vibrate?.([180, 90, 180])
    }

    let notificationShown = false

    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready

          await registration.showNotification('REST COMPLETE', {
            body: 'Your rest is over. Time for the next set.',
            icon: '/icon-192.png',
            tag: 'husshuss-rest-timer',
          })
        } else {
          new Notification('REST COMPLETE', {
            body: 'Your rest is over. Time for the next set.',
          })
        }

        notificationShown = true
      } catch {
        setTimerNotice(
          'Rest complete. Take the next set when you’re ready.',
        )
      }
    }

    if (!(await playSound('timer')) && !notificationShown) {
      setTimerNotice(
        'Rest complete. Take the next set when you’re ready.',
      )
    }
  }, [])

  async function enableTimerNotifications() {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported')
      setTimerNotice('Notifications are not supported in this browser.')
      return
    }

    try {
      await enablePushNotifications()

      setNotificationPermission(Notification.permission)
      setPushConfigured(true)

      const current = dataRef.current

      if (current.timerRunning && current.timerDeadline !== null) {
        await scheduleRestPush(current.timerDeadline)
      }

      setTimerNotice(
        'Background alerts enabled. You can leave HUSHHUSS while resting.',
      )
    } catch (error) {
      setPushConfigured(false)
      setNotificationPermission(Notification.permission)

      setTimerNotice(
        error instanceof Error
          ? error.message
          : 'Background notifications could not be enabled.',
      )
    }
  }

  useEffect(() => {
    if (!data.timerRunning || data.timerDeadline === null) return

    const deadline = data.timerDeadline

    const updateRemaining = () => {
      const current = dataRef.current

      if (!current.timerRunning || current.timerDeadline !== deadline) {
        return
      }

      const remaining = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000),
      )

      if (remaining === 0) {
        updateData((latest) =>
          latest.timerDeadline !== deadline
            ? latest
            : {
                ...latest,
                timerRunning: false,
                timerDeadline: null,
                timerRemainingSeconds: 0,
              },
        )

        if (completedTimerRef.current !== deadline) {
          completedTimerRef.current = deadline
          void cancelRestPush().catch(() => undefined)
          void alertRestTimerFinished()
        }
      } else if (remaining !== current.timerRemainingSeconds) {
        updateData((latest) =>
          latest.timerDeadline !== deadline
            ? latest
            : {
                ...latest,
                timerRemainingSeconds: remaining,
              },
        )

        if (
          current.timerCountdownWarnings &&
          [10, 5, 3].includes(remaining)
        ) {
          const warningKey = `${deadline}:${remaining}`

          if (timerWarningRef.current !== warningKey) {
            timerWarningRef.current = warningKey

            if (
              current.timerVibration &&
              typeof navigator !== 'undefined' &&
              'vibrate' in navigator
            ) {
              navigator.vibrate?.(55)
            }

            void playSound('timer')
          }
        }
      }
    }

    updateRemaining()

    const intervalId = window.setInterval(updateRemaining, 250)

    return () => window.clearInterval(intervalId)
  }, [
    data.timerDeadline,
    data.timerRunning,
    pushConfigured,
    updateData,
    alertRestTimerFinished,
  ])

  function deleteHistoryRecord(recordId: string) {
    updateData((current) => ({
      ...current,
      history: current.history.filter((record) => record.id !== recordId),
    }))
  }

  function goToTab(tab: Tab) {
    if (tab !== 'extras') {
      setExtraLaunchCategory(null)
    }

    setActiveTab(tab)
  }

  if (!dataReady) {
    return (
      <div className="app-shell min-h-screen">
        <main className="main-content" role="status">
          Opening your local HUSHHUSS database…
        </main>
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
          aria-label="HUSHHUSS home"
        >
          <BrandMark />
          <BrandWordmark />
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
              {item.id === 'rotation' && (
                <span className="nav-count">03</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-note">
          <div className="note-icon">
            <Icon name="moon" size={17} />
          </div>
          <p>Rest is part of the work.</p>
          <span>Take the day you need.</span>
        </div>

        <div className="sidebar-footer">
          <span className="status-dot" />
          PRIVATE · STORED ON THIS DEVICE
        </div>
      </aside>

      <div className="page-column">
        <header className="topbar">
          <div className="mobile-brand">
            <BrandMark />
            <BrandWordmark />
          </div>

          <div className="topbar-date">
            <span className="status-dot" /> {dateLabel}
          </div>

          <div className="topbar-profile" aria-label="HUSHHUSS profile">
            <BrandMark variant="avatar" />
          </div>
        </header>

        <main className="main-content">
          {activeTab === 'overview' && (
            <Overview
              workout={workout}
              activeWorkout={data.currentWorkout}
              preferredSubstitutions={data.preferredSubstitutions ?? {}}
              onSavePreferredSubstitution={(sourceId, candidateId) => updateData((current) => ({
                ...current,
                preferredSubstitutions: { ...(current.preferredSubstitutions ?? {}), [sourceId]: candidateId },
              }))}
              onRemovePreferredSubstitution={(sourceId) => updateData((current) => {
                const preferredSubstitutions = { ...(current.preferredSubstitutions ?? {}) }
                delete preferredSubstitutions[sourceId]
                return { ...current, preferredSubstitutions }
              })}
              recoverySelected={data.recoverySelected}
              todayReadiness={(data.readiness ?? []).find((entry) => entry.date === getLocalDateKey())}
              onOpenReadiness={() => { setProgressView('readiness'); goToTab('progress') }}
              onStartScaled={() => startWorkout(true)}
              onSaveRecovery={saveRecovery}
              greeting={greeting}
              completedCount={data.history.length}
              history={data.history}
              extras={data.extrasSessions ?? []}
              onStart={startWorkout}
              onRecover={() =>
                updateData((current) =>
                  current.currentWorkout
                    ? current
                    : { ...current, recoverySelected: true },
                )
              }
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
                pushConfigured,
                notice: timerNotice,
                onSelectDuration: selectRestDuration,
                onStart: startRestTimer,
                onPause: pauseRestTimer,
                onReset: resetRestTimer,
                onAdjust: adjustRestTimer,
                onSkip: skipRestTimer,
                autoStartOnSet: data.timerAutoStart ?? true,
                countdownWarnings: data.timerCountdownWarnings ?? true,
                vibrationEnabled: data.timerVibration ?? false,
                onToggleAutoStart: (value: boolean) =>
                  updateTimerPreference('timerAutoStart', value),
                onToggleCountdownWarnings: (value: boolean) =>
                  updateTimerPreference('timerCountdownWarnings', value),
                onToggleVibration: (value: boolean) =>
                  updateTimerPreference('timerVibration', value),
                onWorkUnitComplete: () => {
                  if (dataRef.current.timerAutoStart ?? true) {
                    startRestTimer(true)
                  }
                },
                onEnableNotifications: () => {
                  void enableTimerNotifications()
                },
              }}
              onOpenRotation={() => goToTab('rotation')}
            />
          )}

          {activeTab === 'rotation' && (
            <RotationPage
              rotationIndex={data.rotationIndex}
              onStart={startWorkout}
              todayReadiness={(data.readiness ?? []).find((entry) => entry.date === getLocalDateKey())}
              activeWorkout={data.currentWorkout}
              onOpenReadiness={() => { setProgressView('readiness'); goToTab('progress') }}
              onStartScaled={() => startWorkout(true)}
              onSaveRecovery={saveRecovery}
              onOpenExtras={() => {
                setExtraLaunchCategory(null)
                setActiveTab('extras')
              }}
            />
          )}

          {activeTab === 'isotefle' && <IsoTeFlePage data={data} onChange={updateData} />}

          {activeTab === 'extras' && (
            <ExtrasPage
              initialCategory={extraLaunchCategory}
              sessions={data.extrasSessions ?? []}
              favourites={data.extrasFavourites ?? []}
              onToggleFavourite={(id: string) =>
                updateData((current) => ({
                  ...current,
                  extrasFavourites: (
                    current.extrasFavourites ?? []
                  ).includes(id)
                    ? (current.extrasFavourites ?? []).filter(
                        (item) => item !== id,
                      )
                    : [...(current.extrasFavourites ?? []), id],
                }))
              }
              timer={{
                durationSeconds: data.restDurationSeconds,
                remainingSeconds: data.timerRemainingSeconds,
                running: data.timerRunning,
                deadline: data.timerDeadline,
                notificationAvailable: typeof Notification !== 'undefined',
                notificationPermission,
                pushConfigured,
                notice: timerNotice,
                onSelectDuration: selectRestDuration,
                onStart: startRestTimer,
                onPause: pauseRestTimer,
                onReset: resetRestTimer,
                onAdjust: adjustRestTimer,
                onSkip: skipRestTimer,
                autoStartOnSet: data.timerAutoStart ?? true,
                countdownWarnings: data.timerCountdownWarnings ?? true,
                vibrationEnabled: data.timerVibration ?? false,
                onToggleAutoStart: (value: boolean) =>
                  updateTimerPreference('timerAutoStart', value),
                onToggleCountdownWarnings: (value: boolean) =>
                  updateTimerPreference('timerCountdownWarnings', value),
                onToggleVibration: (value: boolean) =>
                  updateTimerPreference('timerVibration', value),
                onWorkUnitComplete: () => {
                  if (dataRef.current.timerAutoStart ?? true) {
                    startRestTimer(true)
                  }
                },
                onEnableNotifications: () => {
                  void enableTimerNotifications()
                },
              }}
              onSave={saveExtraSession}
              onBack={() => {
                setExtraLaunchCategory(null)
                setActiveTab('rotation')
              }}
            />
          )}

          {activeTab === 'history' && (
            <HistoryPage
              history={data.history}
              onDelete={deleteHistoryRecord}
            />
          )}

          {activeTab === 'progress' && (
            <div className="progress-tab-content">
              <div className="progress-view-tabs" aria-label="Progress views">
                <button type="button" className={progressView === 'readiness' ? 'selected' : ''} aria-pressed={progressView === 'readiness'} onClick={() => setProgressView('readiness')}>Daily readiness</button>
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
                  className={progressView === 'muscle' ? 'selected' : ''}
                  aria-pressed={progressView === 'muscle'}
                  onClick={() => setProgressView('muscle')}
                >
                  Muscle balance
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
                  Backup &amp; sync
                </button>
              </div>

              <div hidden={progressView !== 'dashboard'}>
                <PerformanceDashboard
                  history={data.history}
                  onOpenHistory={() => setActiveTab('history')}
                  onOpenStrengthProgress={() => setProgressView('strength')}
                />
              </div>

              <div hidden={progressView !== 'readiness'}>
                <ReadinessPage
                  history={data.readiness ?? []}
                  workouts={data.history}
                  recoverySessions={data.recoverySessions ?? []}
                  onSave={(ratings) => updateData((current) => ({
                    ...current,
                    readiness: upsertReadinessCheckIn(current.readiness ?? [], ratings, getLocalDateKey()),
                  }))}
                />
              </div>

              <div hidden={progressView !== 'strength'}>
                <StrengthProgressPage history={data.history} />
              </div>

              {progressView === 'muscle' && (
                <MuscleBalance
                  history={data.history}
                  extras={data.extrasSessions ?? []}
                />
              )}

              <div hidden={progressView !== 'athletic'}>
                <AthleticDevelopment />
              </div>

              <div hidden={progressView !== 'insights'}>
                <PersonalInsights history={data.history} />
              </div>

              <div hidden={progressView !== 'backup'}>
                <BackupRecovery
                  onRestored={() => window.location.reload()}
                />
              </div>
            </div>
          )}

          {activeTab === 'body' && <BodyMeasurements />}

          {completedWorkout && (
            <section className={`workout-completion ${completedWorkout.workoutId === 'pull' || completedWorkout.workoutId === 'core' ? 'field-workout-completion' : ''}`}>
              <div className="completion-topline">
                <span className="eyebrow">HUSHHUSS // SESSION CLEARED</span>
                <span className="completion-status">COMPLETE</span>
              </div>

              <div className="completion-content">
                <div className="completion-copy">
                  <span className="eyebrow">ANOTHER ONE IN THE BOOKS</span>
                  <h1>SESSION<br />CLEARED.</h1>

                  <p>
                    {completedWorkout.workoutName} day completed.
                    You showed up and put in the work.
                  </p>

                  <div className="completion-stats">
                    <span>WORKOUT SAVED</span>
                    <span>PROGRESS UPDATED</span>
                    <span>ROTATION ADVANCED</span>
                  </div>

                  <button
                    className="button-primary"
                    onClick={() => {
                      setCompletedWorkout(null)
                      setActiveTab('overview')
                    }}
                  >
                    Back to overview <span aria-hidden="true">→</span>
                  </button>
                </div>

                <div className="completion-mascot">
                  <img
                    src={mascots.workout}
                    alt="SpongeBob after completing a workout"
                  />
                </div>
              </div>

              <section className="extras-recommendation">
                {(() => {
                  const recommendation = getExtraRecommendation(
                    data.history,
                    data.extrasSessions ?? [],
                  )

                  const category = extraCategories.find(
                    (item) => item.id === recommendation.category,
                  )!

                  return (
                    <div>
                      <span className="eyebrow">
                        OPTIONAL · ONLY IF YOU FEEL LIKE IT
                      </span>

                      <h2>GOT MORE IN THE TANK?</h2>

                      <strong>{category.name}</strong>

                      <p>
                        {recommendation.reason} {category.duration} ·{' '}
                        {getCategoryExercises(recommendation.category).length}{' '}
                        exercises.
                      </p>
                    </div>
                  )
                })()}

                <div className="extras-recommendation-actions">
                  <button
                    className="button-primary"
                    onClick={() => {
                      setExtraLaunchCategory(
                        getExtraRecommendation(
                          data.history,
                          data.extrasSessions ?? [],
                        ).category,
                      )
                      setCompletedWorkout(null)
                      setActiveTab('extras')
                    }}
                  >
                    START EXTRA SESSION
                  </button>

                  <button
                    className="button-secondary"
                    onClick={() => setCompletedWorkout(null)}
                  >
                    NOT TODAY
                  </button>
                </div>
              </section>
            </section>
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <button
            className={`mobile-nav-link ${activeTab === item.id ? 'selected' : ''}`}
            key={item.id}
            onClick={() => goToTab(item.id)}
            aria-current={activeTab === item.id ? 'page' : undefined}
            aria-label={item.label}
          >
            <Icon name={item.icon} size={20} />

            <span>{item.id === 'body' ? 'Body' : item.label}</span>
          </button>
        ))}
      </nav>

      {storageError && (
        <div className="storage-alert" role="alert">
          <strong>Local data notice</strong>
          <span>{storageError}</span>
          <button
            onClick={() => setStorageError(null)}
            aria-label="Dismiss data notice"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function Overview({
  workout,
  activeWorkout,
  preferredSubstitutions,
  onSavePreferredSubstitution,
  onRemovePreferredSubstitution,
  recoverySelected,
  todayReadiness,
  greeting,
  completedCount,
  history,
  extras,
  onStart,
  onRecover,
  onResume,
  onCancel,
  onCancelToRecover,
  onFinish,
  onWorkoutChange,
  timer,
  onOpenRotation,
  onOpenReadiness,
  onStartScaled,
  onSaveRecovery,
}: {
  workout: Workout
  activeWorkout: ActiveWorkout | null
  preferredSubstitutions: Record<string, string>
  onSavePreferredSubstitution: (sourceId: string, candidateId: string) => void
  onRemovePreferredSubstitution: (sourceId: string) => void
  recoverySelected: boolean
  todayReadiness?: ReadinessCheckIn
  greeting: string
  completedCount: number
  history: AppData['history']
  extras: ExtraSessionRecord[]
  onStart: () => void
  onRecover: () => void
  onResume: () => void
  onCancel: () => void
  onCancelToRecover: () => void
  onFinish: () => void
  onWorkoutChange: (change: (current: ActiveWorkout) => ActiveWorkout) => void
  timer: RestTimerProps
  onOpenRotation: () => void
  onOpenReadiness: () => void
  onStartScaled: () => void
  onSaveRecovery: (activity: RecoveryActivity, duration: number | null, notes: string) => Promise<boolean>
}) {
  const dayStatus = activeWorkout
    ? 'active'
    : recoverySelected
      ? 'recovery'
      : 'planned'

  const lowerBodyExercises = getLowerBodyExercises(workout)

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE BETTER, EVERY SESSION</div>
          <h1>{greeting}</h1>
          <p className="page-subtitle">
            Make today’s training work for you.
          </p>
        </div>

        <div className="weekly-chip">
          <Icon name="spark" size={16} /> YOUR PACE, YOURS
        </div>
      </div>

      <ReadinessDecisionPanel
        checkIn={todayReadiness}
        workout={workout}
        activeWorkout={activeWorkout}
        onOpenCheckIn={onOpenReadiness}
        onStartScaled={onStartScaled}
        onSaveRecovery={onSaveRecovery}
      />

      <section
        className={`hero-card today-brief ${
          dayStatus === 'recovery' ? 'recovery-hero' : ''
        }`}
      >
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
                ? `${
                    activeWorkout?.exercises.filter(
                      (exercise) => !exercise.completed,
                    ).length ?? 0
                  } exercises left. Your session is saved on this device.`
                : workout.description}
          </p>

          {dayStatus === 'active' ? (
            <button className="button-primary" onClick={onResume}>
              Resume workout <Icon name="arrow" size={17} />
            </button>
          ) : (
            <button className="button-primary" onClick={onStart}>
              {dayStatus === 'recovery'
                ? `Start ${workout.name} when ready`
                : `Start ${workout.name} workout`}
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

        <div className="hero-campaign-mark" aria-hidden="true">
          <span className="campaign-mark-top">
            HUSHHUSS · FIELD NOTES
          </span>
          <BrandMark variant="hero" />
          <span className="campaign-mark-bottom">
            TRAIN WITH INTENTION
          </span>
        </div>

        <div className="hero-foot">
          <span>
            <Icon name="clock" size={15} />{' '}
            {dayStatus === 'recovery'
              ? 'No schedule to catch up on'
              : workout.duration}
          </span>

          <span className="hero-foot-divider" />

          <span>
            <Icon name="target" size={15} />{' '}
            {dayStatus === 'recovery' ? 'Next up' : workout.focus}
          </span>
        </div>
      </section>

      <XpCard history={history} extras={extras} />

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

            <span className="tiny-pill">
              <span className="status-dot" /> READY WHEN YOU ARE
            </span>
          </div>

          <div className="next-workout-row">
            <div className="workout-index">
              {String(
                workouts.findIndex((item) => item.id === workout.id) + 1,
              ).padStart(2, '0')}
            </div>

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
            <span className="leg-icon">
              <Icon name="activity" size={17} />
            </span>

            <div>
              <span className="micro-label">
                {lowerBodyExercises.length === 0 ? 'SESSION EMPHASIS' : lowerBodyExercises.length === 1 ? 'LOWER-BODY MOVEMENT' : 'LOWER-BODY EMPHASIS'}
              </span>
              <strong>
                {lowerBodyExercises.length ? lowerBodyExercises.map((exercise) => exercise.name).join(' · ') : workout.focus}
              </strong>
            </div>
          </div>

          <p className="panel-footnote">
            Lower-body focus changes each session. Keep the effort
            comfortable; take recovery whenever you need it.
          </p>
        </section>

        <section className="panel recovery-panel">
          <div className="recovery-icon">
            <Icon name="moon" size={19} />
          </div>

          <div className="eyebrow">RECOVERY COUNTS</div>
          <h3>No streaks. No pressure.</h3>

          <p>
            There’s no daily target to keep up with. Rest days never move
            your rotation forward.
          </p>

          <div className="recovery-footer">
            <span className="recovery-status">
              <span className="status-dot" />{' '}
              {dayStatus === 'recovery'
                ? 'RECOVERY SELECTED'
                : 'OPTIONAL, ALWAYS'}
            </span>

            {dayStatus === 'planned' && (
              <button className="recovery-link" onClick={onRecover}>
                Choose rest <Icon name="arrow" size={14} />
              </button>
            )}
          </div>
        </section>

        <section className="panel rhythm-panel">
          <div className="panel-label">YOUR RHYTHM</div>
          <div className="rhythm-number">
            {String(completedCount).padStart(2, '0')}
          </div>
          <div className="rhythm-caption">
            completed sessions saved
          </div>
          <div className="rhythm-note">
            <Icon name="spark" size={15} /> Small steps count.
          </div>
        </section>
      </div>

      {activeWorkout && (
        <div id="active-workout">
          <WorkoutSession
            workout={workout}
            activeWorkout={activeWorkout}
            preferredSubstitutions={preferredSubstitutions}
            onSavePreferredSubstitution={onSavePreferredSubstitution}
            onRemovePreferredSubstitution={onRemovePreferredSubstitution}
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

function RotationExerciseList({ workout }: { workout: Workout }) {
  const sectionFor = (index: number) => index < 4 ? 'CORE' : index < 7 ? 'LEGS' : 'ATHLETICISM'
  const isCoreAndLegs = workout.id === 'core'

  return (
    <div className={`rotation-exercises rotation-exercises-${workout.id}`} aria-label={`${workout.name} exercises`}>
      {isCoreAndLegs && <div className="rotation-exercise-section-label">CORE</div>}
      {workout.exercises.map((exercise, exerciseIndex) => {
        const startsSection = isCoreAndLegs && [4, 7].includes(exerciseIndex)
        const hasExplicitUnit = /\b(seconds?|secs?|sec|s|meters?|metres?|m|km|per side|per leg)\b/i.test(exercise.targetReps)
        const target = hasExplicitUnit ? exercise.targetReps : `${exercise.targetReps} reps`

        return (
          <Fragment key={exercise.id}>
            {startsSection && <div className="rotation-exercise-section-label">{sectionFor(exerciseIndex)}</div>}
            <div className="rotation-exercise-row">
              <span className="rotation-exercise-number">{String(exerciseIndex + 1).padStart(2, '0')}</span>
              <div className="rotation-exercise-copy">
                <span>{exercise.targetSets} sets · {target}</span>
                <strong>{exercise.name}</strong>
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

function RotationPage({
  rotationIndex,
  onStart,
  todayReadiness,
  activeWorkout,
  onOpenReadiness,
  onStartScaled,
  onSaveRecovery,
  onOpenExtras,
}: {
  rotationIndex: number
  onStart: () => void
  todayReadiness?: ReadinessCheckIn
  activeWorkout: ActiveWorkout | null
  onOpenReadiness: () => void
  onStartScaled: () => void
  onSaveRecovery: (activity: RecoveryActivity, duration: number | null, notes: string) => Promise<boolean>
  onOpenExtras: () => void
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A FLEXIBLE TRAINING RHYTHM</div>
          <h1>Your rotation.</h1>
          <p className="page-subtitle">
            Continue where you left off. No daily schedule required.
          </p>
        </div>

        <div className="weekly-chip">
          <Icon name="moon" size={16} /> REST DAYS ARE BUILT IN
        </div>
      </div>

      <ReadinessDecisionPanel
        checkIn={todayReadiness}
        workout={workouts[rotationIndex]}
        activeWorkout={activeWorkout}
        onOpenCheckIn={onOpenReadiness}
        onStartScaled={onStartScaled}
        onSaveRecovery={onSaveRecovery}
      />

      <section className="rotation-intro panel">
        <div className="rotation-intro-icon">
          <Icon name="activity" size={21} />
        </div>

        <div>
          <div className="eyebrow">
            UP NEXT · {String(rotationIndex + 1).padStart(2, '0')} OF 03
          </div>

          <h2>{workouts[rotationIndex].name}</h2>

          <p>
            The sequence only moves forward when you mark a session
            complete. A recovery day leaves it right here.
          </p>
        </div>

        <button className="button-primary" onClick={onStart}>
          Start workout <Icon name="arrow" size={17} />
        </button>
      </section>

      <section className="extras-plan-entry panel">
        <div>
          <div className="eyebrow">
            OPTIONAL SUPPLEMENTARY TRAINING
          </div>
          <h2>EXTRAS LIBRARY</h2>
          <p>
            Neck, grip, calves, posture, athleticism and mobility. Never
            part of your main rotation.
          </p>
        </div>

        <button className="button-primary" onClick={onOpenExtras}>
          Explore EXTRAS <Icon name="arrow" size={17} />
        </button>
      </section>

      <div className="rotation-list">
        {workouts.map((item, index) => (
          <article
            className={`rotation-card panel ${item.id === 'pull' || item.id === 'core' ? 'field-rotation-card' : ''} ${
              index === rotationIndex ? 'current' : ''
            }`}
            key={item.id}
          >
            <div className="rotation-card-top">
              <span className="rotation-card-number">
                {String(index + 1).padStart(2, '0')}
              </span>

              {index === rotationIndex && (
                <span className="tiny-pill">
                  <span className="status-dot" /> UP NEXT
                </span>
              )}
            </div>

            <h3>{item.name}</h3>
            <p>{item.focus}</p>

            <div className="rotation-card-divider" />

            <div className="leg-exercise">
              <span className="leg-icon">
                <Icon name="activity" size={17} />
              </span>

              <div>
                <span className="micro-label">
                  {getLowerBodyExercises(item).length === 0 ? 'SESSION EMPHASIS' : getLowerBodyExercises(item).length === 1 ? 'LOWER-BODY MOVEMENT' : 'LOWER-BODY EMPHASIS'}
                </span>
                <strong>
                  {getLowerBodyExercises(item).length ? getLowerBodyExercises(item).map((exercise) => exercise.name).join(' · ') : item.focus}
                </strong>
              </div>
            </div>

            <div className="rotation-duration">
              <Icon name="clock" size={15} /> {item.duration}
            </div>

            {(item.id === 'pull' || item.id === 'core') && <RotationExerciseList workout={item} />}
          </article>
        ))}
      </div>

      <p className="rotation-note">
        <Icon name="moon" size={16} /> Take a full rest day or an easy day
        between sessions whenever you need it. Nothing is scheduled
        automatically.
      </p>
    </>
  )
}

export default App
