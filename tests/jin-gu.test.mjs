import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let jinGu
let workoutStorage
let backup

class SnapshotDatabase {
  constructor() {
    this.version = 3
    this.stores = new Map()
    this.keyPaths = new Map()
    for (const [name, keyPath] of [['records', 'category'], ['syncQueue', 'category'], ['migrations', 'id'], ['recovery', 'id'], ['syncMetadata', 'id']]) {
      this.stores.set(name, new Map())
      this.keyPaths.set(name, keyPath)
    }
    this.objectStoreNames = { contains: (name) => this.stores.has(name) }
  }
  close() {}
  transaction(names, mode) { return new SnapshotTransaction(this, Array.isArray(names) ? names : [names], mode) }
}

class SnapshotTransaction {
  constructor(database, names, mode) {
    this.database = database
    this.names = names
    this.mode = mode
    this.working = new Map(names.map((name) => [name, new Map([...database.stores.get(name)].map(([key, value]) => [key, structuredClone(value)]))]))
    this.pending = 0
    this.completionQueued = false
  }
  objectStore(name) {
    const store = this.working.get(name)
    assert.ok(store)
    return {
      get: (key) => this.request(() => store.has(key) ? structuredClone(store.get(key)) : undefined),
      put: (value) => this.request(() => { const key = this.database.keyPaths.get(name); store.set(value[key], structuredClone(value)); return value[key] }),
    }
  }
  request(run) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null }
    this.pending += 1
    setTimeout(() => {
      try { request.result = run(); request.onsuccess?.() }
      catch (error) { request.error = error; request.onerror?.() }
      finally { this.pending -= 1; this.scheduleComplete() }
    }, 0)
    return request
  }
  scheduleComplete() {
    if (this.pending || this.completionQueued) return
    this.completionQueued = true
    setTimeout(() => {
      this.completionQueued = false
      if (this.pending) return
      if (this.mode === 'readwrite') for (const [name, store] of this.working) this.database.stores.set(name, store)
      this.oncomplete?.()
    }, 0)
  }
}

class SnapshotIndexedDB {
  constructor(database) { this.database = database }
  open() {
    const request = { result: null, error: null, onsuccess: null, onerror: null }
    setTimeout(() => { request.result = this.database; request.onsuccess?.() }, 0)
    return request
  }
}

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  jinGu = await vite.ssrLoadModule('/src/jinGuData.ts')
  workoutStorage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  backup = await vite.ssrLoadModule('/src/backupStorage.ts')
})

after(async () => { await vite?.close() })

test('daily Jin Gu routine matches the agreed five sections and avoids gym-programme exercises', () => {
  const routine = jinGu.getJinGuRoutine(20)
  assert.equal(routine.length, 16)
  assert.deepEqual(jinGu.jinGuSections.map((section) => section.estimate), ['about 4 min', 'about 7 min', 'about 7 min', 'about 4 min', '3–5 min'])
  assert.deepEqual(routine.slice(0, 5).map((item) => item.target.seconds), [60, 30, 30, 60, 60])
  assert.equal(routine.find((item) => item.id === 'ma-bu').target.seconds, 20)
  assert.equal(routine.find((item) => item.id === 'ma-bu').target.sets, 2)
  assert.deepEqual(routine.find((item) => item.id === 'gong-bu').target.sides, ['Left', 'Right'])
  assert.deepEqual(routine.find((item) => item.id === 'crane-stance').target.sides, ['Left leg', 'Right leg'])
  assert.deepEqual(routine.find((item) => item.id === 'drawing-bow').target, { kind: 'reps-sides', reps: 5, sets: 1, sides: ['Left', 'Right'] })
  assert.equal(routine.find((item) => item.id === 'wuji-standing').target.kind, 'free-duration')
  const names = routine.map((item) => item.name.toLowerCase()).join(' ')
  for (const gymExercise of ['split squat', 'calf raise', 'rdl', 'band external rotation']) assert.equal(names.includes(gymExercise), false)
  assert.ok(routine.every((item) => item.description && item.instructions.length > 0 && item.safety && item.restSeconds >= 0))
})

test('light practice reduces the prescribed work without adding exercises', () => {
  const routine = jinGu.getJinGuRoutine(30)
  assert.equal(jinGu.getJinGuTarget(routine.find((item) => item.id === 'ma-bu'), true).seconds, 15)
  assert.equal(jinGu.getJinGuTarget(routine.find((item) => item.id === 'drawing-bow'), true).reps, 3)
  assert.equal(jinGu.getJinGuTarget(routine.find((item) => item.id === 'wuji-standing'), true).minSeconds, 180)
  assert.equal(jinGu.getJinGuRoutine(30).length, routine.length)
})

test('session completion records full and partial practice with unique completed and skipped movements', () => {
  const active = jinGu.createActiveJinGuSession(false, 20, '2026-11-15', 1_700_000_000_000)
  let updated = jinGu.setJinGuExerciseStatus(active, 'gentle-shaking', 'completed')
  updated = jinGu.setJinGuExerciseStatus(updated, 'wrist-circles-waves', 'skipped')
  updated = jinGu.setJinGuExerciseStatus(updated, 'wrist-circles-waves', 'completed')
  assert.equal(updated.completedExerciseIds.filter((id) => id === 'wrist-circles-waves').length, 1)
  assert.equal(updated.skippedExerciseIds.includes('wrist-circles-waves'), false)
  const record = jinGu.createJinGuSessionRecord(updated, 1_700_000_120_000, { difficulty: 2, discomfortReported: false, notes: 'steady' })
  assert.equal(record.status, 'partial')
  assert.equal(record.durationSeconds, 120)
  assert.deepEqual(record.completedExerciseIds, ['gentle-shaking', 'wrist-circles-waves'])
  assert.equal(record.notes, 'steady')

  const full = jinGu.createActiveJinGuSession(false, 20, '2026-11-15', 1_700_000_000_000)
  const complete = jinGu.getJinGuRoutine(20).reduce((session, item) => jinGu.setJinGuExerciseStatus(session, item.id, 'completed'), full)
  assert.equal(jinGu.createJinGuSessionRecord(complete, 1_700_000_300_000, { difficulty: 3, discomfortReported: false, notes: '' }).status, 'completed')
})

test('timer can start, pause, resume and survive session serialization; previous and next movement reset it', () => {
  let active = jinGu.createActiveJinGuSession(false, 20, '2026-11-15', 1000)
  active = jinGu.startJinGuTimer(active, 60, 10_000)
  assert.equal(active.timerDeadline, 70_000)
  assert.equal(jinGu.isActiveJinGuSession(JSON.parse(JSON.stringify(active))), true)
  active = jinGu.pauseJinGuTimer(active, 30_001)
  assert.equal(active.timerDeadline, null)
  assert.equal(active.timerRemainingSeconds, 40)
  active = jinGu.startJinGuTimer(active, 60, 40_000)
  assert.equal(active.timerDeadline, 80_000)
  active = jinGu.moveToJinGuExercise(active, 1)
  assert.equal(active.currentExerciseIndex, 1)
  assert.equal(active.timerDeadline, null)
  assert.equal(active.timerRemainingSeconds, 0)
  assert.equal(jinGu.moveToJinGuExercise(active, 99), active)
})

test('horse stance progression is opt-in and held by insufficient practice, fatigue, discomfort or hard effort', () => {
  const now = 1_800_000_000_000
  const history = Array.from({ length: 5 }, (_, index) => ({
    id: `session-${index}`, date: '2026-11-15', startedAt: now - 8 * 86_400_000 + index,
    completedAt: index === 0 ? now - 8 * 86_400_000 + index : now - 1_000 + index, durationSeconds: 1500,
    completedExerciseIds: jinGu.getJinGuRoutine().map((item) => item.id), skippedExerciseIds: [],
    status: 'completed', lightPractice: false, horseStanceTargetSeconds: 20,
    difficulty: 2, discomfortReported: false, notes: '',
  }))
  assert.equal(jinGu.getNextHorseStanceTarget(20, history, now), 25)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history.slice(0, 3), now), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history.map((item, index) => index === 1 ? { ...item, lightPractice: true } : item), now), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history.map((item, index) => index === 1 ? { ...item, discomfortReported: true } : item), now), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history.map((item, index) => index === 1 ? { ...item, difficulty: 4 } : item), now), null)
  assert.equal(jinGu.getNextHorseStanceTarget(30, history, now), 35)
  assert.equal(jinGu.getNextHorseStanceTarget(35, history, now), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history, now, now - 1000), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history, now, null, 'recovery'), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history, now, null, 'caution'), null)
  assert.equal(jinGu.getNextHorseStanceTarget(20, history, now, null, 'missing'), null)
})

test('older AppData normalizes with empty Jin Gu state and existing data remains valid', () => {
  const older = workoutStorage.createInitialData()
  delete older.jinGuSessions
  delete older.activeJinGuSession
  delete older.jinGuHorseStanceTargetSeconds
  delete older.jinGuHorseStanceTargetChangedAt
  const normalized = workoutStorage.normalizeAppData(older)
  assert.deepEqual(normalized.jinGuSessions, [])
  assert.equal(normalized.activeJinGuSession, null)
  assert.equal(normalized.jinGuHorseStanceTargetSeconds, 20)
  assert.equal(normalized.rotationIndex, older.rotationIndex)
  assert.deepEqual(normalized.history, older.history)
})

test('saved Jin Gu history and an unfinished practice load back from the existing AppData snapshot', async () => {
  const previousWindow = globalThis.window
  const database = new SnapshotDatabase()
  globalThis.window = {
    indexedDB: new SnapshotIndexedDB(database),
    localStorage: { getItem: () => null },
    dispatchEvent: () => true,
  }
  try {
    const loggedActive = jinGu.createActiveJinGuSession(false, 20, '2026-11-15', 1_700_000_000_000)
    const logged = jinGu.createJinGuSessionRecord(
      jinGu.setJinGuExerciseStatus(loggedActive, 'ma-bu', 'completed'),
      1_700_000_060_000,
      { difficulty: 2, discomfortReported: false, notes: 'saved practice' },
    )
    const data = {
      ...workoutStorage.createInitialData(),
      jinGuSessions: [logged],
      activeJinGuSession: jinGu.createActiveJinGuSession(true, 20, '2026-11-15', 1_700_000_100_000),
    }
    await workoutStorage.writeAppData(data)
    const loaded = await workoutStorage.readAppData()
    assert.equal(loaded.usable, true)
    assert.deepEqual(loaded.data.jinGuSessions, [logged])
    assert.deepEqual(loaded.data.activeJinGuSession, data.activeJinGuSession)
    const afterAnotherReload = await workoutStorage.readAppData()
    assert.deepEqual(afterAnotherReload.data.jinGuSessions, [logged])
    assert.deepEqual(afterAnotherReload.data.activeJinGuSession, data.activeJinGuSession)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('Jin Gu records and in-progress sessions remain inside the supported backup bundle', async () => {
  const active = jinGu.createActiveJinGuSession(true, 20, '2026-11-15', 1_700_000_000_000)
  const completed = jinGu.setJinGuExerciseStatus(active, 'gentle-shaking', 'completed')
  const data = {
    ...workoutStorage.createInitialData(),
    activeJinGuSession: jinGu.createActiveJinGuSession(true, 20, '2026-11-15', 1_700_000_100_000),
    jinGuSessions: [jinGu.createJinGuSessionRecord(completed, 1_700_000_060_000, { difficulty: 2, discomfortReported: false, notes: 'synthetic' })],
  }
  assert.equal(workoutStorage.isAppData(data), true)
  const bundle = { format: 'husshuss-backup', version: 2, exportedAt: new Date().toISOString(), data: {
    workouts: data,
    measurements: { version: 1, sessions: [] },
    athletic: { version: 1, customAssessments: [], records: [] },
  } }
  const parsed = await backup.parseBackup(JSON.stringify(bundle), '')
  assert.deepEqual(parsed.data.workouts.jinGuSessions, data.jinGuSessions)
  assert.deepEqual(parsed.data.workouts.activeJinGuSession, data.activeJinGuSession)
  assert.equal(workoutStorage.isAppData({ ...data, jinGuSessions: [...data.jinGuSessions, data.jinGuSessions[0]] }), false)
})
