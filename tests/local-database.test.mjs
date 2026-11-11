import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

class MemoryDatabase {
  constructor() {
    this.version = 3
    this.stores = new Map()
    this.keyPaths = new Map()
    this.transactionCount = 0
    this.afterGet = null
    for (const [name, keyPath] of [
      ['records', 'category'],
      ['syncQueue', 'category'],
      ['migrations', 'id'],
      ['recovery', 'id'],
      ['syncMetadata', 'id'],
    ]) {
      this.createObjectStore(name, { keyPath })
    }
    this.objectStoreNames = { contains: (name) => this.stores.has(name) }
  }

  createObjectStore(name, { keyPath }) {
    this.stores.set(name, new Map())
    this.keyPaths.set(name, keyPath)
  }

  transaction(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames]
    this.transactionCount += 1
    return new MemoryTransaction(this, names, mode)
  }

  close() {}
}

class MemoryTransaction {
  constructor(database, names, mode) {
    this.database = database
    this.names = names
    this.mode = mode
    this.snapshotStores = mode === 'readonly'
      ? new Map(names.map((name) => [name, new Map(
          [...database.stores.get(name)].map(([key, value]) => [key, structuredClone(value)]),
        )]))
      : null
    this.pending = 0
    this.completionQueued = false
    this.settled = false
  }

  objectStore(name) {
    assert.ok(this.names.includes(name))
    return {
      get: (key) => this.request(() => {
        const source = this.snapshotStores?.get(name) ?? this.database.stores.get(name)
        const value = source.get(key)
        this.database.afterGet?.(name, key)
        return value === undefined ? undefined : structuredClone(value)
      }),
      put: (value) => this.request(() => {
        const keyPath = this.database.keyPaths.get(name)
        this.database.stores.get(name).set(value[keyPath], structuredClone(value))
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

  scheduleComplete() {
    if (this.pending !== 0 || this.completionQueued || this.settled) return
    this.completionQueued = true
    setTimeout(() => {
      this.completionQueued = false
      if (this.pending === 0 && !this.settled) {
        this.settled = true
        this.oncomplete?.()
      }
    }, 0)
  }
}

class MemoryIndexedDB {
  constructor(database) {
    this.database = database
  }

  open(_name, version) {
    const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
    setTimeout(() => {
      if (version > this.database.version) {
        request.error = new Error('Unexpected schema upgrade in migration regression test.')
        request.onerror?.()
        return
      }
      request.result = this.database
      request.onsuccess?.()
    }, 0)
    return request
  }
}

let vite
let readPrimarySnapshot
let readConsistentPrimarySnapshots
let database

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const localDatabase = await vite.ssrLoadModule('/src/localDatabase.ts')
  readPrimarySnapshot = localDatabase.readPrimarySnapshot
  readConsistentPrimarySnapshots = localDatabase.readConsistentPrimarySnapshots
})

after(async () => {
  await vite?.close()
})

test('invalid IndexedDB migration data is archived and not replaced by an empty snapshot', async () => {
  const originalWindow = globalThis.window
  database = new MemoryDatabase()
  const invalidRecord = {
    category: 'workouts',
    updatedAt: 123,
    snapshot: { corruptWorkoutHistory: ['must remain recoverable'] },
  }
  database.stores.get('records').set('workouts', structuredClone(invalidRecord))
  database.stores.get('migrations').set('migration:workouts', {
    id: 'migration:workouts',
    status: 'verified',
    source: 'indexedDB',
    completedAt: 123,
  })

  globalThis.window = {
    indexedDB: new MemoryIndexedDB(database),
    localStorage: { getItem: () => null },
    dispatchEvent: () => true,
  }

  try {
    const emptySnapshot = { workouts: [] }
    const result = await readPrimarySnapshot(
      'workouts',
      'husshuss.data',
      (value) => typeof value === 'object' && value !== null && Array.isArray(value.workouts),
      () => null,
      emptySnapshot,
    )

    assert.equal(result.usable, false)
    assert.match(result.error, /preserved in recovery storage/)
    assert.deepEqual(database.stores.get('records').get('workouts'), invalidRecord)
    const archived = [...database.stores.get('recovery').values()]
    assert.equal(archived.length, 1)
    assert.deepEqual(archived[0].value, invalidRecord)
    assert.equal(archived[0].reason, 'invalid-primary-record')
    assert.notDeepEqual(database.stores.get('records').get('workouts').snapshot, emptySnapshot)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})

test('valid migrated IndexedDB data remains the primary snapshot', async () => {
  const originalWindow = globalThis.window
  database = new MemoryDatabase()
  const validSnapshot = { workouts: ['completed-session'] }
  database.stores.get('records').set('workouts', {
    category: 'workouts',
    updatedAt: 123,
    snapshot: validSnapshot,
  })
  database.stores.get('migrations').set('migration:workouts', {
    id: 'migration:workouts',
    status: 'verified',
    source: 'indexedDB',
    completedAt: 123,
  })
  globalThis.window = {
    indexedDB: new MemoryIndexedDB(database),
    localStorage: { getItem: () => null },
    dispatchEvent: () => true,
  }

  try {
    const result = await readPrimarySnapshot(
      'workouts',
      'husshuss.data',
      (value) => typeof value === 'object' && value !== null && Array.isArray(value.workouts),
      () => null,
      { workouts: [] },
    )
    assert.deepEqual(result, { data: validSnapshot, error: null, usable: true })
    assert.equal(database.stores.get('recovery').size, 0)
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})

test('backup snapshot reads all primary data categories in one IndexedDB read transaction', async () => {
  const originalWindow = globalThis.window
  database = new MemoryDatabase()
  for (const category of ['workouts', 'measurements', 'athletic']) {
    database.stores.get('records').set(category, {
      category,
      updatedAt: 123,
      snapshot: { value: `initial-${category}` },
    })
  }
  database.afterGet = (store, key) => {
    if (store === 'records' && key === 'workouts') {
      database.stores.get('records').set('measurements', {
        category: 'measurements',
        updatedAt: 456,
        snapshot: { value: 'later-measurements' },
      })
    }
  }
  globalThis.window = {
    indexedDB: new MemoryIndexedDB(database),
    localStorage: { getItem: () => null },
    dispatchEvent: () => true,
  }

  try {
    const transactionsBeforeRead = database.transactionCount
    const snapshots = await readConsistentPrimarySnapshots({
      workouts: (value) => typeof value === 'object' && value !== null,
      measurements: (value) => typeof value === 'object' && value !== null,
      athletic: (value) => typeof value === 'object' && value !== null,
    })
    assert.equal(database.transactionCount - transactionsBeforeRead, 1)
    assert.deepEqual(snapshots.measurements, { value: 'initial-measurements' })
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
