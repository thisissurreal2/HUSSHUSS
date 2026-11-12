import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let xp
let strengthAnalytics

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  xp = await vite.ssrLoadModule('/src/xp.ts')
  strengthAnalytics = await vite.ssrLoadModule('/src/strengthAnalytics.ts')
})

after(async () => {
  await vite?.close()
})

function workoutRecord(id, completedAt, weightKg, setCount = 1) {
  return {
    id,
    workoutId: 'push',
    workoutName: 'Push',
    startedAt: completedAt - 60_000,
    completedAt,
    durationSeconds: 60,
    exercises: [{
      exerciseId: 'bench-press',
      name: 'Bench Press',
      instructions: '',
      targetSets: setCount,
      targetReps: '8-12',
      completed: true,
      sets: Array.from({ length: setCount }, (_, index) => ({
        id: `${id}-${index}`,
        weightKg,
        reps: 10,
        completed: true,
      })),
    }],
  }
}

test('personal records preserve chronological order when completion timestamps tie', () => {
  const older = workoutRecord('older', 1000, 100)
  const newer = workoutRecord('newer', 1000, 110)

  const records = strengthAnalytics.getPersonalRecords([newer, older])

  assert.deepEqual(records.map(({ recordId, firstBenchmark }) => ({ recordId, firstBenchmark })), [
    { recordId: 'older', firstBenchmark: true },
    { recordId: 'newer', firstBenchmark: false },
  ])
})

test('XP includes completed sets and detects only a real level threshold crossing', () => {
  const history = [
    workoutRecord('three', 3000, 100),
    workoutRecord('two', 2000, 100),
    workoutRecord('one', 1000, 100),
  ]
  const before = xp.getXpSummary(history)
  assert.equal(before.totalXp, 180)
  assert.equal(before.level, 1)

  const levelUp = workoutRecord('four', 4000, 110)
  const afterLevelUp = xp.getXpSummary([levelUp, ...history])
  assert.equal(afterLevelUp.totalXp, 265)
  assert.equal(afterLevelUp.level, 2)
  assert.equal(afterLevelUp.lastWorkoutXp, 85)
  assert.equal(xp.didWorkoutLevelUp(history, levelUp), true)

  const noLevelUp = workoutRecord('five', 5000, 110)
  assert.equal(xp.didWorkoutLevelUp([levelUp, ...history], noLevelUp), false)
})
