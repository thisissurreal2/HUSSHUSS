import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let iso
let workoutStorage
let jinGu
let backup

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  iso = await vite.ssrLoadModule('/src/isotefleData.ts')
  workoutStorage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  jinGu = await vite.ssrLoadModule('/src/jinGuData.ts')
  backup = await vite.ssrLoadModule('/src/backupStorage.ts')
})

after(async () => { await vite?.close() })

test('weekly plan keeps recovery days clear and follows the approved weekdays', () => {
  const days = {
    '2026-11-15': 'mobility-flow', // Sunday
    '2026-11-16': 'isometric-a',
    '2026-11-17': 'mobility-flow',
    '2026-11-18': null,
    '2026-11-19': 'isometric-b',
    '2026-11-20': 'tendon-weekly',
    '2026-11-21': null,
  }
  for (const [date, expected] of Object.entries(days)) {
    assert.deepEqual(iso.scheduleTemplateIdsForDate(date), expected ? [expected] : [])
  }
  for (const date of ['2026-11-18', '2026-11-21', '2026-11-22']) assert.equal(iso.isRecoveryDay(date), true)
  assert.equal(iso.isRecoveryOrUnavailableDay('2026-11-22', 'isometric-a'), true)
  assert.equal(iso.isRecoveryOrUnavailableDay('2026-11-22', 'mobility-flow'), false)
})

test('session templates contain the specified IsoTeFle exercises and measurement targets', () => {
  const a = iso.getIsoTemplate('isometric-a')
  const b = iso.getIsoTemplate('isometric-b')
  const tendon = iso.getIsoTemplate('tendon-weekly')
  const mobility = iso.getIsoTemplate('mobility-flow')
  assert.deepEqual(a.exercises.map(({ name, sets, target }) => [name, sets, target.kind, target.minSeconds, target.maxSeconds]), [
    ['Wall Sit', 2, 'hold', 30, 45], ['Split Squat Hold', 2, 'hold', 20, 30],
    ['Push-Up Hold', 2, 'hold', 20, 30], ['Glute Bridge Hold', 2, 'hold', 30, 45],
    ['Side Plank', 2, 'hold', 20, 40], ['Calf Raise Hold', 2, 'hold', 30, 45],
  ])
  assert.deepEqual(b.exercises.map(({ name, sets, target }) => [name, sets, target.kind, target.minSeconds, target.maxSeconds]), [
    ['Glute Bridge Hold', 2, 'hold', 30, 45], ['Single-Leg Calf Hold', 2, 'hold', 20, 30],
    ['Pike Push-Up Hold', 2, 'hold', 20, 30], ['Self-Resisted Towel Row or Curl', 2, 'hold', 15, 25],
    ['Towel Grip Hold', 2, 'hold', 20, 30],
  ])
  assert.deepEqual(tendon.exercises.map(({ name, sets, target }) => [name, sets, target.kind, target.minReps, target.maxReps]), [
    ['Wall Sit', 3, 'hold', undefined, undefined],
    ['Standing Calf Raises', 3, 'reps', 12, 15], ['Tibialis Raises', 2, 'reps', 15, 20],
    ['Single-Leg Calf Raises', 2, 'reps', 8, 12],
  ])
  assert.equal(mobility.exercises.length, 8)
  assert.ok(a.exercises.some((item) => item.name === 'Calf Raise Hold'))
  assert.ok(b.exercises.some((item) => item.name === 'Single-Leg Calf Hold'))
  assert.ok(tendon.exercises.some((item) => item.name === 'Standing Calf Raises'))
  assert.ok(tendon.exercises.some((item) => item.name === 'Single-Leg Calf Raises'))
})

test('tendon check recommends standard, adjustable reduction, or skipping based on current input', () => {
  assert.equal(iso.getTendonAdjustment({ soreness: 0, discomfort: 0, recovery: 'good', adjusted: false }), 'standard')
  assert.equal(iso.getTendonAdjustment({ soreness: 5, discomfort: 0, recovery: 'usual', adjusted: false }), 'reduce')
  assert.equal(iso.getTendonAdjustment({ soreness: 2, discomfort: 1, recovery: 'good', adjusted: false }), 'reduce')
  assert.equal(iso.getTendonAdjustment({ soreness: 2, discomfort: 4, recovery: 'good', adjusted: false }), 'skip-or-reschedule')
  assert.equal(iso.getTendonAdjustment({ soreness: 2, discomfort: 0, recovery: 'low', adjusted: false }), 'skip-or-reschedule')
  const entry = { id: 'tendon-weekly:2026-11-20', templateId: 'tendon-weekly', programmeId: 'tendon', originalDate: '2026-11-20', scheduledDate: '2026-11-20', status: 'scheduled', optional: false, updatedAt: 0 }
  const session = iso.createIsoActiveSession(entry, 1_700_000_000_000, { soreness: 5, discomfort: 1, recovery: 'usual', adjusted: false })
  const reduced = iso.applyTendonAdjustment(session, true)
  assert.equal(reduced.recoveryCheck.adjusted, true)
  assert.ok(reduced.exercises.every((exercise) => exercise.sets.length === iso.getIsoTemplate('tendon-weekly').exercises.find((item) => item.id === exercise.exerciseId).sets - 1))
  assert.equal(reduced.exercises.every((exercise) => exercise.sets.every((set) => set.weightKg === null)), true)
  assert.equal(iso.applyTendonAdjustment(session, false).exercises[1].sets.length, 3)
})

test('rescheduled entries remain in the visible window when their original week has passed', () => {
  const moved = { id: 'isometric-a:2026-11-16', templateId: 'isometric-a', programmeId: 'isometric', originalDate: '2026-11-16', scheduledDate: '2026-12-03', status: 'rescheduled', optional: false, updatedAt: 10 }
  const schedule = iso.getScheduleWindow('2026-11-30', [moved], 7)
  assert.equal(schedule.filter((entry) => entry.id === moved.id).length, 1)
  assert.equal(schedule.find((entry) => entry.id === moved.id).scheduledDate, moved.scheduledDate)
  assert.equal(iso.isRecoveryOrUnavailableDay(moved.scheduledDate, moved.templateId), false)
})

test('demanding sessions cannot be rescheduled onto recovery days or stacked together', () => {
  assert.equal(iso.canRescheduleIsoTemplate('tendon-weekly', '2026-11-18', []), false)
  assert.equal(iso.canRescheduleIsoTemplate('isometric-b', '2026-11-21', []), false)
  assert.equal(iso.canRescheduleIsoTemplate('isometric-b', '2026-11-19', []), false)
  assert.equal(iso.canRescheduleIsoTemplate('tendon-weekly', '2026-11-17', []), true)
  assert.equal(iso.canRescheduleIsoTemplate('mobility-flow', '2026-11-21', []), true)
  const moved = { id: 'other-session', templateId: 'isometric-a', programmeId: 'isometric', originalDate: '2026-11-16', scheduledDate: '2026-11-17', status: 'rescheduled', optional: false, updatedAt: 1 }
  assert.equal(iso.canRescheduleIsoTemplate('tendon-weekly', '2026-11-17', [moved]), false)
  assert.equal(iso.canRescheduleIsoTemplate('tendon-weekly', '2026-11-17', [moved], 'other-session'), true)
})

test('session records and AppData preserve module history without touching gym or Jin Gu records', () => {
  const entry = { id: 'isometric-b:2026-11-19', templateId: 'isometric-b', programmeId: 'isometric', originalDate: '2026-11-19', scheduledDate: '2026-11-19', status: 'scheduled', optional: false, updatedAt: 0 }
  let active = iso.createIsoActiveSession(entry, 1_700_000_000_000)
  const calf = active.exercises.find((item) => item.exerciseId === 'single-leg-calf-hold')
  active = iso.updateIsoSet(active, calf.exerciseId, calf.sets[0].id, (set) => ({ ...set, leftValue: 22, rightValue: 24, completed: true }))
  active = { ...active, currentExerciseIndex: 1, paused: true, notes: 'synthetic note' }
  assert.equal(iso.isActiveIsoSession(JSON.parse(JSON.stringify(active))), true)
  assert.equal(iso.isActiveIsoSession({ ...active, currentExerciseIndex: active.exercises.length }), false)
  const record = iso.createIsoSessionRecord(active, 1_700_000_120_000)
  assert.equal(iso.isIsoSessionRecord(record), true)
  assert.deepEqual([record.exercises.find((item) => item.exerciseId === calf.exerciseId).sets[0].leftValue, record.exercises.find((item) => item.exerciseId === calf.exerciseId).sets[0].rightValue], [22, 24])

  const original = workoutStorage.createInitialData()
  const gymSession = workoutStorage.createActiveWorkout('push', 1_699_999_000_000)
  gymSession.exercises.forEach((exercise) => { exercise.completed = true; exercise.sets.forEach((set) => { set.reps = '10'; set.completed = true }) })
  const completedGym = workoutStorage.createWorkoutRecord(gymSession, 1_700_000_000_000)
  const activeJinGu = jinGu.createActiveJinGuSession(false, 20, '2026-11-15', 1_699_999_000_000)
  const archivedJinGu = jinGu.createJinGuSessionRecord(jinGu.setJinGuExerciseStatus(activeJinGu, 'gentle-shaking', 'completed'), 1_700_000_000_000, { difficulty: 2, discomfortReported: false, notes: 'archived synthetic' })
  const unfinishedJinGu = jinGu.createActiveJinGuSession(true, 20, '2026-11-16', 1_700_000_000_000)
  const unfinishedIso = iso.createIsoActiveSession({ ...entry, id: 'isometric-b:2026-11-20', templateId: 'tendon-weekly', programmeId: 'tendon', originalDate: '2026-11-20', scheduledDate: '2026-11-20' }, 1_700_000_200_000)
  const data = { ...original, rotationIndex: 2, history: [completedGym], jinGuSessions: [archivedJinGu], activeJinGuSession: unfinishedJinGu, isoTeFleSessions: [record], activeIsoTeFleSession: unfinishedIso, isoTeFleSchedule: [entry] }
  assert.equal(jinGu.isJinGuSession(archivedJinGu), true)
  assert.equal(jinGu.isActiveJinGuSession(unfinishedJinGu), true)
  assert.equal(iso.isIsoSessionRecord(record), true)
  assert.equal(iso.isActiveIsoSession(unfinishedIso), true)
  assert.equal(iso.isIsoScheduleEntry(entry), true)
  if (!workoutStorage.isAppData(data)) {
    const isolated = ['history', 'rotationIndex', 'jinGuSessions', 'activeJinGuSession', 'isoTeFleSessions', 'activeIsoTeFleSession', 'isoTeFleSchedule']
      .filter((key) => workoutStorage.isAppData({ ...data, [key]: original[key] }))
    assert.fail(`AppData rejected the combined fixture; replacing invalid field(s) fixes it: ${isolated.join(', ') || 'combination or another required field'}`)
  }
  const normalized = workoutStorage.normalizeAppData(JSON.parse(JSON.stringify(data)))
  assert.deepEqual(normalized.isoTeFleSessions, [record])
  assert.deepEqual(normalized.activeIsoTeFleSession, unfinishedIso)
  assert.deepEqual(normalized.isoTeFleSchedule, [entry])
  assert.deepEqual(normalized.jinGuSessions, [archivedJinGu])
  assert.deepEqual(normalized.activeJinGuSession, unfinishedJinGu)
  assert.equal(normalized.rotationIndex, data.rotationIndex)
  assert.deepEqual(normalized.history, data.history)

  const older = { ...original }
  delete older.isoTeFleSessions
  delete older.activeIsoTeFleSession
  delete older.isoTeFleSchedule
  const normalizedOlder = workoutStorage.normalizeAppData(older)
  assert.deepEqual(normalizedOlder.isoTeFleSessions, [])
  assert.equal(normalizedOlder.activeIsoTeFleSession, null)
  assert.deepEqual(normalizedOlder.isoTeFleSchedule, [])
})

test('older version-2 backup snapshots load with empty IsoTeFle data', async () => {
  const workouts = workoutStorage.createInitialData()
  delete workouts.isoTeFleSessions
  delete workouts.activeIsoTeFleSession
  delete workouts.isoTeFleSchedule
  const bundle = {
    format: 'husshuss-backup', version: 2, exportedAt: '2026-11-16T00:00:00.000Z',
    data: { workouts, measurements: { version: 1, sessions: [] }, athletic: { version: 1, customAssessments: [], records: [] } },
  }
  const parsed = await backup.parseBackup(JSON.stringify(bundle), '')
  assert.deepEqual(parsed.data.workouts.isoTeFleSessions, [])
  assert.equal(parsed.data.workouts.activeIsoTeFleSession, null)
  assert.deepEqual(parsed.data.workouts.isoTeFleSchedule, [])
})
