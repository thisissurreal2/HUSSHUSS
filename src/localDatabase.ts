export type LocalDataCategory = 'workouts' | 'measurements' | 'athletic'

export type PendingLocalChange = {
  category: LocalDataCategory
  queuedAt: number
  snapshot: unknown
}

export type RemoteSyncState = {
  id: 'github-backup-v1'
  sha: string
  revision: number
  versionId: string
  updatedAt: string
  localFingerprint: string
}

type SnapshotRecord = {
  category: LocalDataCategory
  updatedAt: number
  snapshot: unknown
}

type MigrationRecord = {
  id: string
  status: 'verified' | 'recovered' | 'empty' | 'invalid'
  source: 'localStorage' | 'indexedDB' | 'empty'
  completedAt: number
}

const DATABASE_NAME = 'husshuss-local'
const DATABASE_VERSION = 3
const RECORDS_STORE = 'records'
const QUEUE_STORE = 'syncQueue'
const MIGRATIONS_STORE = 'migrations'
const RECOVERY_STORE = 'recovery'
const SYNC_METADATA_STORE = 'syncMetadata'

let writeChain: Promise<void> = Promise.resolve()

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeChain.then(operation)
  writeChain = result.then(() => undefined, () => undefined)
  return result
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable in this browser.'))
      return
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    let settled = false
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        database.createObjectStore(RECORDS_STORE, { keyPath: 'category' })
      }
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: 'category' })
      }
      if (!database.objectStoreNames.contains(MIGRATIONS_STORE)) {
        database.createObjectStore(MIGRATIONS_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
        database.createObjectStore(RECOVERY_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(SYNC_METADATA_STORE)) {
        database.createObjectStore(SYNC_METADATA_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      if (settled) {
        database.close()
        return
      }
      settled = true
      resolve(database)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      const error = request.error
      reject(error?.name === 'VersionError'
        ? new Error('The local database was created by a newer app version and cannot be opened by this version.')
        : error ?? new Error('Could not open local IndexedDB.'))
    }
    request.onblocked = () => {
      if (settled) return
      settled = true
      reject(new Error('Local IndexedDB is blocked by another open app version. Close other HUSSHUSS tabs and try again.'))
    }
  })
}

function readLegacyValue<T>(
  key: string,
  normalize: (value: unknown) => T | null,
): { snapshot: T | null; present: boolean; error: string | null } {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return { snapshot: null, present: false, error: 'Browser compatibility storage could not be read.' }
  }
  if (raw === null) return { snapshot: null, present: false, error: null }

  try {
    const normalized = normalize(JSON.parse(raw) as unknown)
    return normalized === null
      ? { snapshot: null, present: true, error: 'Saved browser data is invalid or from an unsupported version. The original record has been retained.' }
      : { snapshot: normalized, present: true, error: null }
  } catch {
    return { snapshot: null, present: true, error: 'Saved browser data could not be decoded. The original record has been retained.' }
  }
}

function recoveryId(category: LocalDataCategory): string {
  return `recovery:${category}:${Date.now()}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function addRecoveryRecord(
  store: IDBObjectStore,
  category: LocalDataCategory,
  value: unknown,
  reason: string,
): void {
  store.put({ id: recoveryId(category), category, recoveredAt: Date.now(), reason, value })
}

function dispatchDatabaseUpdate(categories: LocalDataCategory[]): void {
  window.dispatchEvent(new Event('husshuss:local-queue-updated'))
  if (categories.some((category) => category !== 'workouts')) {
    window.dispatchEvent(new Event('husshuss:local-data-changed'))
  }
}

export async function readPrimarySnapshot<T>(
  category: LocalDataCategory,
  storageKey: string,
  isValid: (value: unknown) => value is T,
  normalizeLegacy: (value: unknown) => T | null,
  emptyValue: T,
): Promise<{ data: T; error: string | null; usable: boolean }> {
  const legacy = readLegacyValue(storageKey, normalizeLegacy)
  try {
    const result = await serialize(async () => {
      const database = await openDatabase()
      let transactionResult: { data: T; error: string | null; usable: boolean }
      try {
        transactionResult = await new Promise<{ data: T; error: string | null; usable: boolean }>((resolve, reject) => {
          const transaction = database.transaction(
            [RECORDS_STORE, QUEUE_STORE, MIGRATIONS_STORE, RECOVERY_STORE],
            'readwrite',
          )
          const records = transaction.objectStore(RECORDS_STORE)
          const queue = transaction.objectStore(QUEUE_STORE)
          const migrations = transaction.objectStore(MIGRATIONS_STORE)
          const recovery = transaction.objectStore(RECOVERY_STORE)
          const recordRequest = records.get(category)
          const migrationRequest = migrations.get(`migration:${category}`)
          let recordReady = false
          let migrationReady = false
          let record: unknown
          let migration: unknown
          let selected: T = emptyValue
          let selectedError: string | null = legacy.error
          let selectedUsable = false
          let shouldDispatch = false

          const chooseSnapshot = () => {
            if (!recordReady || !migrationReady) return
            const existing = record as SnapshotRecord | undefined
            const existingValid = existing !== undefined
              && typeof existing === 'object'
              && existing.category === category
              && isValid(existing.snapshot)
            const migrationComplete = migration !== undefined
              && typeof migration === 'object'
              && (migration as MigrationRecord).id === `migration:${category}`
            const migrationStatus = migration as MigrationRecord | undefined

            if (migrationComplete && existingValid) {
              selected = existing.snapshot as T
              selectedError = null
              selectedUsable = true
              return
            }

            if (legacy.snapshot !== null) {
              if (existing !== undefined) {
                if (!existingValid) {
                  addRecoveryRecord(recovery, category, existing, 'invalid-primary-record')
                } else if (JSON.stringify(existing.snapshot) !== JSON.stringify(legacy.snapshot)) {
                  addRecoveryRecord(recovery, category, existing, 'pre-migration-indexeddb-snapshot')
                }
              }
              selected = legacy.snapshot
              const now = Date.now()
              records.put({ category, updatedAt: now, snapshot: selected } satisfies SnapshotRecord)
              queue.put({ category, queuedAt: now, snapshot: selected } satisfies PendingLocalChange)
              migrations.put({
                id: `migration:${category}`,
                status: 'verified',
                source: 'localStorage',
                completedAt: now,
              } satisfies MigrationRecord)
              selectedError = null
              selectedUsable = true
              shouldDispatch = true
              return
            }

            if (existing !== undefined && !existingValid) {
              if (!migrationComplete || migrationStatus?.status !== 'invalid') {
                addRecoveryRecord(recovery, category, existing, 'invalid-primary-record')
                migrations.put({
                  id: `migration:${category}`,
                  status: 'invalid',
                  source: 'indexedDB',
                  completedAt: Date.now(),
                } satisfies MigrationRecord)
                shouldDispatch = true
              }
              selected = emptyValue
              selectedUsable = false
              selectedError ??= 'The IndexedDB record is invalid and has been preserved in recovery storage.'
              return
            }

            if (existingValid) {
              selected = existing.snapshot as T
              selectedUsable = true
              if (!migrationComplete) {
                const now = Date.now()
                migrations.put({
                  id: `migration:${category}`,
                  status: 'recovered',
                  source: 'indexedDB',
                  completedAt: now,
                } satisfies MigrationRecord)
                selectedError = legacy.error
                shouldDispatch = true
              }
              return
            }

            if (!legacy.present && legacy.error === null) {
              const now = Date.now()
              selected = emptyValue
              selectedUsable = true
              records.put({ category, updatedAt: now, snapshot: selected } satisfies SnapshotRecord)
              migrations.put({
                id: `migration:${category}`,
                status: 'empty',
                source: 'empty',
                completedAt: now,
              } satisfies MigrationRecord)
              selectedError = null
              shouldDispatch = true
            } else {
              selected = emptyValue
              selectedUsable = false
              selectedError ??= 'Saved data could not be recovered. The original record has been retained.'
            }
          }

          recordRequest.onsuccess = () => {
            record = recordRequest.result
            recordReady = true
            chooseSnapshot()
          }
          migrationRequest.onsuccess = () => {
            migration = migrationRequest.result
            migrationReady = true
            chooseSnapshot()
          }
          transaction.oncomplete = () => {
            if (shouldDispatch) dispatchDatabaseUpdate([category])
            resolve({ data: selected, error: selectedError, usable: selectedUsable })
          }
          transaction.onerror = () => reject(transaction.error ?? new Error('Could not read the local database.'))
          transaction.onabort = () => reject(transaction.error ?? new Error('Local database initialization was interrupted.'))
        })
      } finally {
        database.close()
      }
      if (transactionResult.error === null) {
        try {
          await verifyPrimarySnapshot(category, transactionResult.data, isValid)
        } catch (error) {
          return {
            data: transactionResult.data,
            error: error instanceof Error ? error.message : 'Local data could not be verified after reading.',
            usable: false,
          }
        }
      }
      return transactionResult
    })
    return result
  } catch (error) {
    return {
      data: emptyValue,
      error: error instanceof Error ? error.message : 'Local IndexedDB could not be opened or read.',
      usable: false,
    }
  }
}

export async function readConsistentPrimarySnapshots(
  validators: Record<LocalDataCategory, (value: unknown) => boolean>,
): Promise<Record<LocalDataCategory, unknown>> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(RECORDS_STORE, 'readonly')
      const store = transaction.objectStore(RECORDS_STORE)
      const records: Partial<Record<LocalDataCategory, unknown>> = {}
      const categories: LocalDataCategory[] = ['workouts', 'measurements', 'athletic']
      for (const category of categories) {
        const request = store.get(category)
        request.onsuccess = () => { records[category] = request.result }
        request.onerror = () => reject(request.error ?? new Error('Could not read a consistent local backup snapshot.'))
      }
      transaction.oncomplete = () => {
        const snapshots: Partial<Record<LocalDataCategory, unknown>> = {}
        for (const category of categories) {
          const record = records[category] as SnapshotRecord | undefined
          if (!record || record.category !== category || !validators[category](record.snapshot)) {
            reject(new Error(`The ${category} data changed or became invalid while creating the backup.`))
            return
          }
          snapshots[category] = record.snapshot
        }
        resolve(snapshots as Record<LocalDataCategory, unknown>)
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not read a consistent local backup snapshot.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Consistent local backup read was interrupted.'))
    })
  } finally {
    database.close()
  }
}

async function verifyPrimarySnapshot<T>(
  category: LocalDataCategory,
  expected: T,
  isValid: (value: unknown) => value is T,
): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([RECORDS_STORE, MIGRATIONS_STORE], 'readonly')
      const recordRequest = transaction.objectStore(RECORDS_STORE).get(category)
      const migrationRequest = transaction.objectStore(MIGRATIONS_STORE).get(`migration:${category}`)
      let record: unknown
      let migration: unknown
      recordRequest.onsuccess = () => { record = recordRequest.result }
      migrationRequest.onsuccess = () => { migration = migrationRequest.result }
      transaction.oncomplete = () => {
        const stored = record as SnapshotRecord | undefined
        const status = migration as MigrationRecord | undefined
        if (!stored || stored.category !== category || !isValid(stored.snapshot)
          || JSON.stringify(stored.snapshot) !== JSON.stringify(expected)
          || !status || status.id !== `migration:${category}`) {
          reject(new Error('Local database readback verification failed. The original LocalStorage records remain available.'))
          return
        }
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('Local database readback verification failed.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Local database verification was interrupted.'))
    })
  } finally {
    database.close()
  }
}

async function writeSnapshots(
  snapshots: { category: LocalDataCategory; snapshot: unknown }[],
  validators?: Partial<Record<LocalDataCategory, (value: unknown) => boolean>>,
): Promise<void> {
  await serialize(async () => {
    const database = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction([RECORDS_STORE, QUEUE_STORE, RECOVERY_STORE], 'readwrite')
        const records = transaction.objectStore(RECORDS_STORE)
        const queue = transaction.objectStore(QUEUE_STORE)
        const recovery = transaction.objectStore(RECOVERY_STORE)
        for (const { category, snapshot } of snapshots) {
          const validator = validators?.[category]
          if (validator && !validator(snapshot)) {
            transaction.abort()
            reject(new Error(`Refusing to save invalid ${category} data.`))
            return
          }
          const request = records.get(category)
          request.onsuccess = () => {
            const existing = request.result as SnapshotRecord | undefined
            if (existing && validator && !validator(existing.snapshot)) {
              addRecoveryRecord(recovery, category, existing, 'invalid-primary-record-replaced')
            }
            const queuedAt = Date.now()
            records.put({ category, updatedAt: queuedAt, snapshot } satisfies SnapshotRecord)
            queue.put({ category, queuedAt, snapshot } satisfies PendingLocalChange)
          }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('Could not save local IndexedDB data.'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Local IndexedDB write was aborted.'))
      })
    } finally {
      database.close()
    }
  })
  dispatchDatabaseUpdate(snapshots.map(({ category }) => category))
}

export function writePrimarySnapshot<T>(
  category: LocalDataCategory,
  snapshot: T,
  isValid: (value: unknown) => value is T,
): Promise<void> {
  return writeSnapshots([{ category, snapshot }], { [category]: isValid })
}

export function queueLocalSnapshots(
  snapshots: { category: LocalDataCategory; snapshot: unknown }[],
): Promise<void> {
  return writeSnapshots(snapshots)
}

export async function getPendingLocalChanges(): Promise<PendingLocalChange[]> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(QUEUE_STORE, 'readonly')
      const request = transaction.objectStore(QUEUE_STORE).getAll()
      request.onsuccess = () => {
        const result: unknown = request.result
        if (!Array.isArray(result) || !result.every((value) => (
          typeof value === 'object' && value !== null
          && ['workouts', 'measurements', 'athletic'].includes((value as PendingLocalChange).category)
          && Number.isFinite((value as PendingLocalChange).queuedAt)
          && 'snapshot' in value
        ))) {
          reject(new Error('The local sync queue contains invalid data. Existing workout data has not been changed.'))
          return
        }
        resolve(result as PendingLocalChange[])
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read the local sync queue.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not read the local sync queue.'))
    })
  } finally {
    database.close()
  }
}

function isRemoteSyncState(value: unknown): value is RemoteSyncState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return state.id === 'github-backup-v1'
    && typeof state.sha === 'string' && /^[0-9a-f]{40}$/i.test(state.sha)
    && Number.isSafeInteger(state.revision) && (state.revision as number) >= 1
    && typeof state.versionId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state.versionId)
    && typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt))
    && typeof state.localFingerprint === 'string' && /^[0-9a-f]{64}$/.test(state.localFingerprint)
}

export async function readRemoteSyncState(): Promise<RemoteSyncState | null> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(SYNC_METADATA_STORE, 'readonly')
      const request = transaction.objectStore(SYNC_METADATA_STORE).get('github-backup-v1')
      request.onsuccess = () => {
        if (request.result === undefined) {
          resolve(null)
        } else if (isRemoteSyncState(request.result)) {
          resolve(request.result)
        } else {
          reject(new Error('Saved GitHub sync metadata is invalid. No local fitness data was changed.'))
        }
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read GitHub sync metadata.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not read GitHub sync metadata.'))
    })
  } finally {
    database.close()
  }
}

export async function writeRemoteSyncState(state: RemoteSyncState): Promise<void> {
  if (!isRemoteSyncState(state)) throw new Error('Refusing to save invalid GitHub sync metadata.')
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SYNC_METADATA_STORE, 'readwrite')
      transaction.objectStore(SYNC_METADATA_STORE).put(state)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save GitHub sync metadata.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('GitHub sync metadata write was aborted.'))
    })
  } finally {
    database.close()
  }
}
