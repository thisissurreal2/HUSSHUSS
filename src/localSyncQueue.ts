export type LocalDataCategory = 'workouts' | 'measurements' | 'athletic'

export type PendingLocalChange = {
  category: LocalDataCategory
  queuedAt: number
  snapshot: unknown
}

const DATABASE_NAME = 'husshuss-local'
const DATABASE_VERSION = 1
const RECORDS_STORE = 'records'
const QUEUE_STORE = 'syncQueue'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable in this browser.'))
      return
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(RECORDS_STORE)) {
        database.createObjectStore(RECORDS_STORE, { keyPath: 'category' })
      }
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: 'category' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local IndexedDB.'))
    request.onblocked = () => reject(new Error('Local IndexedDB is blocked by another open app version.'))
  })
}

function notifyStorageError(error: unknown): void {
  const detail = error instanceof Error ? error.message : 'Local sync queue could not be updated.'
  window.dispatchEvent(new CustomEvent('husshuss:local-storage-error', { detail }))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPendingLocalChange(value: unknown): value is PendingLocalChange {
  return isObject(value)
    && (value.category === 'workouts' || value.category === 'measurements' || value.category === 'athletic')
    && typeof value.queuedAt === 'number'
    && Number.isFinite(value.queuedAt)
    && 'snapshot' in value
}

export async function queueLocalSnapshots(
  snapshots: { category: LocalDataCategory; snapshot: unknown }[],
): Promise<void> {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([RECORDS_STORE, QUEUE_STORE], 'readwrite')
      const records = transaction.objectStore(RECORDS_STORE)
      const queue = transaction.objectStore(QUEUE_STORE)
      for (const { category, snapshot } of snapshots) {
        const queuedAt = Date.now()
        records.put({ category, updatedAt: queuedAt, snapshot })
        queue.put({ category, queuedAt, snapshot } satisfies PendingLocalChange)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the local sync queue.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Local sync queue transaction was aborted.'))
    })
  } finally {
    database.close()
  }
  window.dispatchEvent(new Event('husshuss:local-queue-updated'))
}

export function stageLocalSnapshot(category: LocalDataCategory, snapshot: unknown): void {
  void queueLocalSnapshots([{ category, snapshot }])
    .catch(notifyStorageError)
}

export async function initializeLocalQueue(
  isValidSnapshot: (category: LocalDataCategory, snapshot: unknown) => boolean,
): Promise<void> {
  const rawSnapshots: Partial<Record<LocalDataCategory, string>> = {}
  for (const [category, key] of [
    ['workouts', 'husshuss.data'],
    ['measurements', 'husshuss.measurements'],
    ['athletic', 'husshuss.athletic'],
  ] as const) {
    const raw = window.localStorage.getItem(key)
    if (raw !== null) rawSnapshots[category] = raw
  }

  if (Object.keys(rawSnapshots).length === 0) return

  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([RECORDS_STORE, QUEUE_STORE], 'readwrite')
      const records = transaction.objectStore(RECORDS_STORE)
      const queue = transaction.objectStore(QUEUE_STORE)
      for (const category of Object.keys(rawSnapshots) as LocalDataCategory[]) {
        const request = records.get(category)
        request.onsuccess = () => {
          if (request.result) return
          const raw = rawSnapshots[category]
          if (raw === undefined) return
          try {
            const snapshot: unknown = JSON.parse(raw)
            if (!isValidSnapshot(category, snapshot)) return
            const queuedAt = Date.now()
            records.put({ category, updatedAt: queuedAt, snapshot })
            queue.put({ category, queuedAt, snapshot } satisfies PendingLocalChange)
          } catch {
            // Corrupt localStorage remains untouched and is not copied into the queue.
          }
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not initialize local IndexedDB.'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Local IndexedDB initialization was aborted.'))
    })
    window.dispatchEvent(new Event('husshuss:local-queue-updated'))
  } finally {
    database.close()
  }
}

export async function getPendingLocalChanges(): Promise<PendingLocalChange[]> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(QUEUE_STORE, 'readonly')
      const request = transaction.objectStore(QUEUE_STORE).getAll()
      request.onsuccess = () => {
        const result: unknown = request.result
        if (!Array.isArray(result) || !result.every(isPendingLocalChange)) {
          reject(new Error('The local sync queue contains invalid data. Existing workout data has not been changed.'))
          return
        }
        resolve(result)
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read the local sync queue.'))
    })
  } finally {
    database.close()
  }
}
