import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let readiness
let storage
let training
let workouts
let xp
let backup

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  readiness = await vite.ssrLoadModule('/src/readiness.ts')
  storage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  training = await vite.ssrLoadModule('/src/readinessTraining.ts')
  workouts = (await vite.ssrLoadModule('/src/workouts.ts')).workouts
  xp = await vite.ssrLoadModule('/src/xp.ts')
  backup = await vite.ssrLoadModule('/src/backupStorage.ts')
})

after(async () => { await vite?.close() })

const ratings = (overrides = {}) => ({ sleep: 3, energy: 3, soreness: 3, motivation: 3, stress: 3, ...overrides })

test('readiness normalizes weighted ratings and handles inverse soreness and stress', () => {
  assert.equal(readiness.calculateReadinessScore(ratings()), 50)
  assert.equal(readiness.calculateReadinessScore(ratings({ sleep: 5, energy: 5, soreness: 1, motivation: 5, stress: 1 })), 100)
  assert.equal(readiness.calculateReadinessScore(ratings({ sleep: 1, energy: 1, soreness: 5, motivation: 1, stress: 5 })), 0)
  assert.equal(readiness.calculateReadinessScore(ratings({ sleep: 5 })), 63)
  assert.ok(readiness.calculateReadinessScore(ratings({ soreness: 1 })) > readiness.calculateReadinessScore(ratings({ soreness: 5 })))
  assert.ok(readiness.calculateReadinessScore(ratings({ stress: 1 })) > readiness.calculateReadinessScore(ratings({ stress: 5 })))
})

test('invalid ratings and category boundaries are rejected or classified', () => {
  for (const bad of [0, 6, 2.5, NaN, '3']) {
    assert.throws(() => readiness.calculateReadinessScore(ratings({ sleep: bad })))
  }
  assert.equal(readiness.getReadinessCategory(80), 'ready')
  assert.equal(readiness.getReadinessCategory(79), 'caution')
  assert.equal(readiness.getReadinessCategory(60), 'caution')
  assert.equal(readiness.getReadinessCategory(59), 'recovery')
})

test('same-day check-in edits replace the record and preserve its creation time', () => {
  const first = readiness.upsertReadinessCheckIn([], ratings(), '2026-11-14', '2026-11-14T01:00:00Z')
  const edited = readiness.upsertReadinessCheckIn(first, ratings({ energy: 5 }), '2026-11-14', '2026-11-14T02:00:00Z')
  assert.equal(edited.length, 1)
  assert.equal(edited[0].energy, 5)
  assert.equal(edited[0].createdAt, '2026-11-14T01:00:00Z')
  assert.equal(edited[0].updatedAt, '2026-11-14T02:00:00Z')
  assert.equal(edited[0].score, readiness.calculateReadinessScore(edited[0]))
})

test('history computes averages, extrema, 7 and 30 day windows without fabricating missing days', () => {
  const history = ['2026-11-14', '2026-11-10', '2026-10-20'].map((date, index) => ({
    ...ratings(), date, score: [50, 75, 90][index], createdAt: `${date}T01:00:00Z`, updatedAt: `${date}T01:00:00Z`,
  }))
  const trend = readiness.getReadinessTrends(history, '2026-11-14')
  assert.equal(trend.days7.length, 2)
  assert.equal(trend.days30.length, 3)
  assert.equal(trend.average, 72)
  assert.equal(trend.highest, 90)
  assert.equal(trend.lowest, 50)
  assert.equal(trend.completedDays, 3)
  assert.equal(readiness.getReadinessTrends([], '2026-11-14').average, null)
})

test('older AppData gains an empty readiness history without losing workout or timer data', () => {
  const older = storage.createInitialData()
  delete older.readiness
  older.rotationIndex = 2
  older.restDurationSeconds = 120
  const normalized = storage.normalizeAppData(older)
  assert.deepEqual(normalized.readiness, [])
  assert.equal(normalized.rotationIndex, 2)
  assert.equal(normalized.restDurationSeconds, 120)
  assert.equal(storage.isAppData({ ...normalized, readiness: [{ date: '2026-11-14', score: 100 }] }), false)
})

test('backup-compatible AppData retains readiness alongside workout rotation and XP source history', () => {
  const checkIns = readiness.upsertReadinessCheckIn([], ratings({ sleep: 5 }), '2026-11-14')
  const workoutData = { ...storage.createInitialData(), rotationIndex: 1, readiness: checkIns }
  const roundTrip = JSON.parse(JSON.stringify(workoutData))
  assert.equal(storage.isAppData(roundTrip), true)
  assert.deepEqual(roundTrip.readiness, checkIns)
  assert.equal(roundTrip.rotationIndex, 1)
  assert.deepEqual(roundTrip.history, [])
})

test('recommendations distinguish missing check-ins and all three training categories', () => {
  assert.equal(training.getTrainingRecommendation().label, 'No check-in today')
  assert.match(training.getTrainingRecommendation().explanation, /never required/)
  const high = readiness.upsertReadinessCheckIn([], ratings({ sleep: 5, energy: 5, soreness: 1, motivation: 5, stress: 1 }), '2026-11-14')[0]
  const middle = readiness.upsertReadinessCheckIn([], ratings({ sleep: 5, energy: 3, soreness: 3, motivation: 3, stress: 3 }), '2026-11-14')[0]
  const low = readiness.upsertReadinessCheckIn([], ratings({ sleep: 1, energy: 1, soreness: 5, motivation: 1, stress: 5 }), '2026-11-14')[0]
  assert.equal(training.getTrainingRecommendation(high).label, 'Train as planned')
  assert.equal(training.getTrainingRecommendation(middle).label, 'Scale back')
  assert.equal(training.getTrainingRecommendation(low).label, 'Recovery recommended')
  assert.ok(training.getTrainingRecommendation(low).factors.some((item) => item.includes('reduced')))
})

test('scaled plan trims about one quarter of sets, prioritizes accessories, and preserves the source programme', () => {
  const planned = workouts.find((item) => item.id === 'push')
  const snapshot = structuredClone(planned)
  const scaled = training.createScaledWorkout(planned)
  const originalSetCount = planned.exercises.reduce((sum, item) => sum + item.targetSets, 0)
  const scaledSetCount = scaled.exercises.reduce((sum, item) => sum + item.targetSets, 0)
  assert.ok((originalSetCount - scaledSetCount) / originalSetCount >= 0.2)
  assert.ok((originalSetCount - scaledSetCount) / originalSetCount <= 0.3)
  assert.deepEqual(planned, snapshot)
  for (const exercise of planned.exercises.filter((item) => /bench|press/i.test(item.name))) {
    assert.equal(scaled.exercises.find((item) => item.id === exercise.id).targetSets, exercise.targetSets)
  }
  assert.ok(scaled.exercises.every((item) => item.targetSets >= 1))
  assert.throws(() => training.createScaledWorkout(planned, 0.5))
})

test('scaled plan is only used when the user accepts and the active workout records that choice', () => {
  const planned = workouts.find((item) => item.id === 'pull')
  assert.equal(training.chooseWorkoutPlan(planned, false), planned)
  const accepted = training.chooseWorkoutPlan(planned, true)
  assert.notEqual(accepted, planned)
  const active = storage.createActiveWorkout(planned.id, 1000, [], accepted, true)
  assert.equal(active.readinessAdjusted, true)
  assert.equal(active.template.exercises.reduce((sum, item) => sum + item.targetSets, 0), active.exercises.reduce((sum, item) => sum + item.sets.length, 0))
  const completed = storage.createWorkoutRecord(active, 2000)
  assert.equal(completed.readinessAdjusted, true)
  assert.equal(storage.isAppData({ ...storage.createInitialData(), rotationIndex: workouts.findIndex((item) => item.id === planned.id), currentWorkout: active }), true)
})

test('recovery activity records are validated and remain outside workout rotation and XP history', () => {
  const recovery = training.createRecoverySession('walking', 20, 'Easy pace', '2026-11-14', 500)
  assert.equal(training.isRecoverySession(recovery), true)
  assert.throws(() => training.createRecoverySession('walking', 0, '', '2026-11-14'))
  const initial = storage.createInitialData()
  const updated = { ...initial, recoverySessions: [recovery] }
  assert.equal(storage.isAppData(updated), true)
  assert.equal(updated.rotationIndex, initial.rotationIndex)
  assert.deepEqual(updated.history, initial.history)
  assert.equal(xp.getXpSummary(updated.history).totalXp, xp.getXpSummary(initial.history).totalXp)
  const rest = training.createRecoverySession('rest', null, '', '2026-11-14', 501)
  assert.equal(rest.durationMinutes, null)
})

test('readiness insights withhold patterns until enough paired data exists', () => {
  assert.deepEqual(training.getReadinessInsights([], [], '2026-11-14'), [])
  const checkIns = []
  const records = []
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(Date.UTC(2026, 10, 8 + index)).toISOString().slice(0, 10)
    const score = 40 + index * 8
    checkIns.push({ ...ratings({ sleep: 3 }), date, score, createdAt: `${date}T10:00:00Z`, updatedAt: `${date}T10:00:00Z` })
    const completedAt = new Date(`${date}T12:00:00`).getTime()
    records.push({ id: `w${index}`, workoutId: 'push', workoutName: 'Push', startedAt: completedAt - 3600_000, completedAt, durationSeconds: 3600, exercises: [{ exerciseId: 'bench', name: 'Bench', instructions: '', targetSets: index + 1, targetReps: '8', completed: true, sets: Array.from({ length: index + 1 }, (_, setIndex) => ({ id: `${index}-${setIndex}`, weightKg: 50, reps: 8, completed: true })) }] })
  }
  const insights = training.getReadinessInsights(checkIns, records, '2026-11-14')
  assert.ok(insights.some((item) => item.id === 'workout-comparison'))
  assert.match(insights.find((item) => item.id === 'workout-comparison').text, /Observation.*not proof/)
})

test('backup parsing preserves new recovery and readiness data and normalizes older AppData', async () => {
  const recovery = training.createRecoverySession('rest', null, '', '2026-11-14', 501)
  const bundle = {
    format: 'husshuss-backup', version: 2, exportedAt: '2026-11-14T00:00:00.000Z',
    data: {
      workouts: { ...storage.createInitialData(), readiness: [readiness.upsertReadinessCheckIn([], ratings(), '2026-11-14')[0]], recoverySessions: [recovery], preferredSubstitutions: { 'barbell-bench-press': 'machine-chest-press' } },
      measurements: { version: 1, sessions: [] },
      athletic: { version: 1, customAssessments: [], records: [] },
    },
  }
  const restored = await backup.parseBackup(JSON.stringify(bundle), '')
  assert.deepEqual(restored.data.workouts.recoverySessions, [recovery])
  assert.equal(restored.data.workouts.readiness.length, 1)
  assert.equal(restored.data.workouts.preferredSubstitutions['barbell-bench-press'], 'machine-chest-press')
  const old = structuredClone(bundle)
  delete old.data.workouts.readiness
  delete old.data.workouts.recoverySessions
  delete old.data.workouts.preferredSubstitutions
  const normalized = await backup.parseBackup(JSON.stringify(old), '')
  assert.deepEqual(normalized.data.workouts.readiness, [])
  assert.deepEqual(normalized.data.workouts.recoverySessions, [])
  assert.deepEqual(normalized.data.workouts.preferredSubstitutions, {})
})

test('restore writes readiness and recovery entries into the established workout snapshot', async () => {
  class FakeStoreDatabase {
    constructor() {
      this.version = 3
      this.stores = new Map()
      this.keys = new Map()
      for (const [name, key] of [['records', 'category'], ['syncQueue', 'category'], ['migrations', 'id'], ['recovery', 'id'], ['syncMetadata', 'id']]) {
        this.stores.set(name, new Map())
        this.keys.set(name, key)
      }
      this.objectStoreNames = { contains: (name) => this.stores.has(name) }
    }
    transaction(_names) {
      const database = this
      const transaction = { pending: 0, settled: false }
      const complete = () => {
        if (!transaction.settled && transaction.pending === 0) {
          transaction.settled = true
          setTimeout(() => transaction.oncomplete?.(), 0)
        }
      }
      transaction.objectStore = (name) => ({
        get(key) { return request(() => database.stores.get(name).get(key)) },
        put(value) { return request(() => { const key = value[database.keys.get(name)]; database.stores.get(name).set(key, structuredClone(value)); return key }) },
      })
      function request(action) {
        const result = {}
        transaction.settled = false
        transaction.pending += 1
        setTimeout(() => {
          result.result = structuredClone(action())
          result.onsuccess?.()
          transaction.pending -= 1
          complete()
        }, 0)
        return result
      }
      return transaction
    }
    close() {}
  }
  const database = new FakeStoreDatabase()
  const originalWindow = globalThis.window
  const localValues = new Map()
  globalThis.window = {
    indexedDB: { open: () => {
      const request = {}
      setTimeout(() => { request.result = database; request.onupgradeneeded?.(); request.onsuccess?.() }, 0)
      return request
    } },
    localStorage: { getItem: (key) => localValues.get(key) ?? null, setItem: (key, value) => localValues.set(key, value), removeItem: (key) => localValues.delete(key) },
    dispatchEvent: () => true,
  }
  try {
    const recovery = training.createRecoverySession('mobility', 10, '', '2026-11-14', 701)
    const readings = readiness.upsertReadinessCheckIn([], ratings({ energy: 4 }), '2026-11-14')
    const sideSpecificRecord = {
      id: 'balance-restore', workoutId: 'core', workoutName: 'Core & Athleticism', startedAt: 1000, completedAt: 61000, durationSeconds: 60,
      exercises: [{ exerciseId: 'single-leg-balance', name: 'Single-Leg Balance', instructions: '', targetSets: 1, targetReps: '30 seconds per side', completed: true,
        sets: [{ id: 'balance-set', weightKg: null, reps: 25, leftReps: 30, rightReps: 25, completed: true }] }],
    }
    const bundle = {
      format: 'husshuss-backup', version: 2, exportedAt: '2026-11-14T00:00:00.000Z',
      data: {
        workouts: { ...storage.createInitialData(), rotationIndex: 2, history: [sideSpecificRecord], readiness: readings, recoverySessions: [recovery], preferredSubstitutions: { 'barbell-bench-press': 'machine-chest-press' } },
        measurements: { version: 1, sessions: [] }, athletic: { version: 1, customAssessments: [], records: [] },
      },
    }
    await backup.restoreBackup(bundle)
    const restored = database.stores.get('records').get('workouts').snapshot
    assert.equal(restored.rotationIndex, 2)
    assert.deepEqual(restored.readiness, readings)
    assert.deepEqual(restored.recoverySessions, [recovery])
    assert.deepEqual(restored.preferredSubstitutions, { 'barbell-bench-press': 'machine-chest-press' })
    assert.deepEqual(restored.history[0].exercises[0].sets[0], sideSpecificRecord.exercises[0].sets[0])
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
