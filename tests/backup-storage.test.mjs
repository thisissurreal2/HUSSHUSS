import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

class MemoryDatabase {
  constructor() {
    this.version = 3
    this.stores = new Map()
    this.keyPaths = new Map()
    for (const [name, keyPath] of [['records', 'category'], ['syncQueue', 'category'], ['migrations', 'id'], ['recovery', 'id'], ['syncMetadata', 'id']]) {
      this.stores.set(name, new Map())
      this.keyPaths.set(name, keyPath)
    }
    this.objectStoreNames = { contains: (name) => this.stores.has(name) }
    this.transactionCount = 0
    this.failNextActualWrite = false
  }
  close() {}
  transaction(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames]
    this.transactionCount += 1
    return new MemoryTransaction(this, names, mode, this.transactionCount)
  }
}

class MemoryTransaction {
  constructor(database, names, mode, transactionNumber) {
    this.database = database
    this.names = names
    this.mode = mode
    this.transactionNumber = transactionNumber
    this.working = new Map(names.map((name) => [name, new Map(
      [...database.stores.get(name)].map(([key, value]) => [key, structuredClone(value)]),
    )]))
    this.pending = 0
    this.completionQueued = false
    this.settled = false
  }
  objectStore(name) {
    assert.ok(this.names.includes(name))
    const store = this.working.get(name)
    return {
      get: (key) => this.request(() => {
        const value = store.get(key)
        return value === undefined ? undefined : structuredClone(value)
      }),
      put: (value) => this.request(() => {
        this.didPut = true
        const keyPath = this.database.keyPaths.get(name)
        store.set(value[keyPath], structuredClone(value))
        return value[keyPath]
      }),
    }
  }
  request(operation) {
    const request = { result: undefined, error: null, onsuccess: null, onerror: null }
    this.pending += 1
    setTimeout(() => {
      try {
        request.result = operation()
        request.onsuccess?.()
      } catch (error) {
        request.error = error
        request.onerror?.()
      } finally {
        this.pending -= 1
        this.scheduleComplete()
      }
    }, 0)
    return request
  }
  abort() {
    this.aborted = true
    this.scheduleComplete()
  }
  scheduleComplete() {
    if (this.pending !== 0 || this.completionQueued || this.settled) return
    this.completionQueued = true
    setTimeout(() => {
      this.completionQueued = false
      if (this.pending !== 0 || this.settled) return
      this.settled = true
      if (this.aborted || (this.mode === 'readwrite' && this.didPut && this.database.failNextActualWrite)) {
        this.database.failNextActualWrite = false
        this.onabort?.()
        return
      }
      if (this.mode === 'readwrite') {
        for (const [name, store] of this.working) this.database.stores.set(name, store)
      }
      this.oncomplete?.()
    }, 0)
  }
}

class MemoryIndexedDB {
  constructor(database) { this.database = database }
  open(_name, version) {
    const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
    setTimeout(() => {
      if (version > this.database.version) {
        request.error = new Error('Unexpected database version in isolated backup test.')
        request.onerror?.()
      } else {
        request.result = this.database
        request.onsuccess?.()
      }
    }, 0)
    return request
  }
}

let vite
let backup
let workoutStorage
let measurementStorage
let athleticStorage
let readiness
let readinessTraining
let extras
let database
let localValues
let expectedData
let fixture

function installIsolatedDatabase() {
  database = new MemoryDatabase()
  for (const [category, snapshot] of Object.entries(fixture)) {
    database.stores.get('records').set(category, { category, updatedAt: 1, snapshot: structuredClone(snapshot) })
    database.stores.get('migrations').set(`migration:${category}`, {
      id: `migration:${category}`, status: 'verified', source: 'indexedDB', completedAt: 1,
    })
  }
  localValues = new Map()
  globalThis.window = {
    indexedDB: new MemoryIndexedDB(database),
    localStorage: {
      getItem: (key) => localValues.get(key) ?? null,
      setItem: (key, value) => localValues.set(key, String(value)),
      removeItem: (key) => localValues.delete(key),
    },
    dispatchEvent: () => true,
  }
}

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  backup = await vite.ssrLoadModule('/src/backupStorage.ts')
  workoutStorage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  measurementStorage = await vite.ssrLoadModule('/src/measurementStorage.ts')
  athleticStorage = await vite.ssrLoadModule('/src/athleticStorage.ts')
  readiness = await vite.ssrLoadModule('/src/readiness.ts')
  readinessTraining = await vite.ssrLoadModule('/src/readinessTraining.ts')
  extras = await vite.ssrLoadModule('/src/extras.ts')

  const previousWindow = globalThis.window
  try {
    const completed = workoutStorage.createActiveWorkout('push', 1_700_000_000_000)
    for (const exercise of completed.exercises) {
      exercise.completed = true
      for (const set of exercise.sets) {
        set.reps = '10'
        set.completed = true
      }
    }
    const record = workoutStorage.createWorkoutRecord(completed, 1_700_000_003_000)
    const incomplete = workoutStorage.createActiveWorkout('push', 1_700_000_010_000, [record])
    const extraSession = extras.completeExtraSession(extras.createExtraSession(['wrist-curls', 'dead-hangs'], 1_700_000_020_000), 1_700_000_030_000)
    extraSession.exercises.forEach((exercise) => { exercise.units[0].completed = true })
    const completedExtra = extras.completeExtraSession(extraSession, 1_700_000_030_000)
    const ratings = { sleep: 4, energy: 3, soreness: 2, motivation: 5, stress: 2 }
    const assessment = athleticStorage.builtInAssessments.find((item) => item.id === 'plank-hold')

    expectedData = {
      workouts: {
        ...workoutStorage.createInitialData(),
        history: [record],
        currentWorkout: incomplete,
        extrasSessions: [completedExtra],
        extrasFavourites: ['wrist-curls'],
        readiness: readiness.upsertReadinessCheckIn([], ratings, '2026-11-15'),
        recoverySessions: [readinessTraining.createRecoverySession('mobility', 20, 'easy movement', '2026-11-15', 1_700_000_040_000)],
        restDurationSeconds: 120,
        timerRemainingSeconds: 45,
        timerAutoStart: false,
        timerCountdownWarnings: false,
        timerVibration: true,
      },
      measurements: {
        version: 1,
        sessions: [{
          id: 'synthetic-measurement', date: '2026-11-15', createdAt: 1_700_000_050_000, updatedAt: 1_700_000_050_000,
          values: { ...measurementStorage.createEmptyMeasurementValues(), bodyWeightKg: 72.4, waistCm: 81 },
        }],
      },
      athletic: {
        version: 1,
        customAssessments: [],
        records: [{
          id: 'synthetic-athletic-record', assessmentId: assessment.id, assessmentName: assessment.name,
          category: assessment.category, date: '2026-11-15', createdAt: 1_700_000_060_000,
          updatedAt: 1_700_000_060_000, values: { seconds: 68 }, notes: 'synthetic record',
        }],
      },
    }
    assert.equal(workoutStorage.isAppData(expectedData.workouts), true)
    assert.equal(measurementStorage.isMeasurementData(expectedData.measurements), true)
    assert.equal(athleticStorage.isAthleticData(expectedData.athletic), true)
    fixture = expectedData
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

after(async () => { await vite?.close() })

test('synthetic backup encrypts and round-trips all supported data categories', async () => {
  const previousWindow = globalThis.window
  installIsolatedDatabase()
  try {
    const passphrase = 'synthetic-test-only-passphrase'
    const encrypted = await backup.createEncryptedBackup(passphrase)
    const envelope = JSON.parse(encrypted)
    assert.deepEqual(Object.keys(envelope).sort(), ['cipher', 'ciphertext', 'format', 'iterations', 'iv', 'kdf', 'salt', 'version'].sort())
    assert.equal(envelope.format, 'husshuss-encrypted-backup')
    assert.equal(envelope.cipher, 'AES-256-GCM')
    assert.equal(envelope.kdf, 'PBKDF2-SHA-256')
    assert.equal(envelope.iterations, 600_000)
    assert.equal(Buffer.from(envelope.salt, 'base64').length, 16)
    assert.equal(Buffer.from(envelope.iv, 'base64').length, 12)

    const parsed = await backup.parseBackup(encrypted, passphrase)
    assert.deepEqual(parsed.data, expectedData)
    assert.equal(parsed.format, 'husshuss-backup')
    assert.equal(parsed.version, 2)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('wrong passphrases, altered ciphertext or authenticated metadata, and malformed envelopes are rejected', async () => {
  const previousWindow = globalThis.window
  installIsolatedDatabase()
  try {
    const encrypted = await backup.createEncryptedBackup('synthetic-test-only-passphrase')
    const envelope = JSON.parse(encrypted)
    await assert.rejects(backup.parseBackup(encrypted, 'wrong-test-only-passphrase'), /incorrect or .*altered/i)

    const alteredCipher = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -4)}AAAA` }
    await assert.rejects(backup.parseBackup(JSON.stringify(alteredCipher), 'synthetic-test-only-passphrase'), /incorrect or .*altered/i)

    const alteredMetadata = { ...envelope, iterations: envelope.iterations + 1 }
    await assert.rejects(backup.parseBackup(JSON.stringify(alteredMetadata), 'synthetic-test-only-passphrase'), /incorrect or .*altered/i)
    await assert.rejects(backup.parseBackup(JSON.stringify({ format: envelope.format, version: envelope.version }), 'synthetic-test-only-passphrase'), /invalid.*unsupported/i)
    await assert.rejects(backup.parseBackup(JSON.stringify({ format: 'husshuss-backup', version: 2, exportedAt: new Date().toISOString(), data: {} }), ''), /invalid.*unsupported/i)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('isolated restore creates a safety snapshot and failed restore preserves all existing records', async () => {
  const previousWindow = globalThis.window
  installIsolatedDatabase()
  try {
    const original = structuredClone(fixture)
    const restoredBundle = {
      format: 'husshuss-backup', version: 2, exportedAt: new Date().toISOString(),
      data: structuredClone(expectedData),
    }
    restoredBundle.data.workouts.rotationIndex = 1
    restoredBundle.data.workouts.currentWorkout = null
    const parsed = await backup.parseBackup(JSON.stringify(restoredBundle), '')
    await backup.restoreBackup(parsed)
    for (const category of ['workouts', 'measurements', 'athletic']) {
      assert.deepEqual(database.stores.get('records').get(category).snapshot, parsed.data[category])
    }
    assert.ok(backup.getRestoreSafetyDate())
    const safety = JSON.parse(localValues.get(backup.RESTORE_SAFETY_KEY))
    assert.deepEqual(JSON.parse(safety.values['husshuss.data']), original.workouts)

    await backup.restoreBackup(parsed)
    const restoredWorkouts = database.stores.get('records').get('workouts').snapshot
    assert.equal(restoredWorkouts.history.length, parsed.data.workouts.history.length)
    assert.equal(restoredWorkouts.extrasSessions.length, parsed.data.workouts.extrasSessions.length)

    const beforeFailure = Object.fromEntries(['workouts', 'measurements', 'athletic'].map((category) => [category,
      structuredClone(database.stores.get('records').get(category).snapshot),
    ]))
    const failingBundle = structuredClone(parsed)
    failingBundle.data.workouts.rotationIndex = 2
    database.failNextActualWrite = true
    await assert.rejects(backup.restoreBackup(failingBundle), /aborted/i)
    for (const category of ['workouts', 'measurements', 'athletic']) {
      assert.deepEqual(database.stores.get('records').get(category).snapshot, beforeFailure[category])
    }
    assert.deepEqual(JSON.parse(JSON.parse(localValues.get(backup.RESTORE_SAFETY_KEY)).values['husshuss.data']), beforeFailure.workouts)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
