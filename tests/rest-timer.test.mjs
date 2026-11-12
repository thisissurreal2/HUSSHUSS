import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let workoutStorage

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  workoutStorage = await vite.ssrLoadModule('/src/workoutStorage.ts')
})

after(async () => { await vite?.close() })

test('advanced rest timer defaults are enabled safely and persist in AppData', () => {
  const data = workoutStorage.createInitialData()
  assert.equal(data.restDurationSeconds, 90)
  assert.equal(data.timerAutoStart, true)
  assert.equal(data.timerCountdownWarnings, true)
  assert.equal(data.timerVibration, false)
  assert.equal(workoutStorage.isAppData(data), true)
})

test('older version-2 data without advanced timer preferences remains compatible', () => {
  const oldData = workoutStorage.createInitialData()
  delete oldData.timerAutoStart
  delete oldData.timerCountdownWarnings
  delete oldData.timerVibration

  const normalized = workoutStorage.normalizeAppData(oldData)
  assert.equal(normalized?.timerAutoStart, true)
  assert.equal(normalized?.timerCountdownWarnings, true)
  assert.equal(normalized?.timerVibration, false)
})

test('custom rest durations accept 15 to 600 seconds and reject out-of-range values', () => {
  const base = workoutStorage.createInitialData()
  assert.equal(workoutStorage.isAppData({ ...base, restDurationSeconds: 420, timerRemainingSeconds: 420 }), true)
  assert.equal(workoutStorage.isAppData({ ...base, restDurationSeconds: 14, timerRemainingSeconds: 14 }), false)
  assert.equal(workoutStorage.isAppData({ ...base, restDurationSeconds: 601, timerRemainingSeconds: 601 }), false)
})
