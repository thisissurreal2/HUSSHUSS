import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let analytics
let storage

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  analytics = await vite.ssrLoadModule('/src/strengthAnalytics.ts')
  storage = await vite.ssrLoadModule('/src/workoutStorage.ts')
})

after(async () => { await vite?.close() })

function record(id, completedAt, exerciseId, name, targetSets, targetReps, values, readinessAdjusted = false) {
  return {
    id, workoutId: exerciseId === 'plank' ? 'core' : 'push', workoutName: 'Test session',
    startedAt: completedAt - 3600_000, completedAt, durationSeconds: 3600, readinessAdjusted,
    exercises: [{
      exerciseId, name, instructions: '', targetSets, targetReps, completed: true,
      sets: values.map(([weightKg, reps], index) => ({ id: `${id}-${index}`, weightKg, reps, completed: true })),
    }],
  }
}

const bench = { exerciseId: 'barbell-bench-press', name: 'Barbell Bench Press', targetSets: 3, targetReps: '5–8' }

test('first exposure gives no invented target and identifies new exercises', () => {
  const plan = analytics.getProgressionPlan([], bench)
  assert.equal(plan.status, 'New exercise')
  assert.equal(plan.sourceRecord, null)
  assert.match(plan.reason, /comfortable effort/)
  assert.equal(analytics.getExerciseMetricType('assisted-pull-ups', 'Assisted Pull-ups', '5–10'), 'assisted')
  assert.equal(analytics.getExerciseMetricType('plank', 'Plank', '45–60 seconds'), 'timed')
  assert.equal(analytics.getExerciseMetricType('carry', 'Loaded Carry', '20–30 m'), 'distance')
  assert.equal(analytics.getExerciseMetricType('pallof-press', 'Pallof Press', '10 per side'), 'per-side')
  assert.equal(analytics.getExerciseMetricType('single-leg-balance', 'Single-Leg Balance', '30 seconds per side'), 'per-side-time')
})

test('double progression advances each below-cap rep target while preserving the logged resistance', () => {
  const history = [record('one', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 8], [40, 8], [40, 7]])]
  const plan = analytics.getProgressionPlan(history, bench)
  assert.equal(plan.targetText, '3 sets · 40 kg × 8 reps / 40 kg × 8 reps / 40 kg × 8 reps')
  assert.match(plan.reason, /keeping the same resistance/)
})

test('load increases require every prescribed set at the top and use an observed equipment increment', () => {
  const history = [
    record('known-step', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[37.5, 8], [37.5, 8], [37.5, 8]]),
    record('all-top', 2000, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 8], [40, 8], [40, 8]]),
  ]
  const plan = analytics.getProgressionPlan(history, bench)
  assert.match(plan.targetText, /42\.5 kg/)
  assert.match(plan.reason, /smallest load step observed/)

  const unknownIncrement = analytics.getProgressionPlan([
    record('top', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 8], [40, 8], [40, 8]]),
  ], bench)
  assert.doesNotMatch(unknownIncrement.reason, /42\.5/)
  assert.match(unknownIncrement.reason, /increment is unknown/)

  const incomplete = analytics.getProgressionPlan([
    record('incomplete', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 8], [40, 8]]),
  ], bench)
  assert.equal(incomplete.sourceRecord, null)
})

test('failed or incomplete rep targets do not trigger weight progression', () => {
  const failed = analytics.getProgressionPlan([
    record('failed', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 4], [40, 6], [40, 7]]),
  ], bench)
  assert.doesNotMatch(failed.targetText, /kg · 5–8/)
  assert.match(failed.reason, /add a rep|minimum rep target/i)

  const plan = analytics.getProgressionPlan([
    record('incomplete', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 8], [40, 8]]),
  ], bench)
  assert.equal(plan.status, 'New exercise')
})

test('bodyweight and assisted pulling progress by reps first and lower assistance separately', () => {
  const pullups = { exerciseId: 'pull-ups', name: 'Pull-ups', targetSets: 3, targetReps: '5–10' }
  const bodyweight = analytics.getProgressionPlan([
    record('bodyweight', 1000, pullups.exerciseId, pullups.name, 3, pullups.targetReps, [[null, 7], [null, 6], [null, 5]]),
  ], pullups)
  assert.match(bodyweight.targetText, /bodyweight \/ resistance not logged × 8 reps/)
  assert.match(bodyweight.reason, /same resistance/)

  const assisted = { exerciseId: 'assisted-pull-ups', name: 'Assisted Pull-ups', targetSets: 3, targetReps: '5–10' }
  const plan = analytics.getProgressionPlan([
    record('assisted-step', 1000, assisted.exerciseId, assisted.name, 3, assisted.targetReps, [[27.5, 10], [27.5, 10], [27.5, 10]]),
    record('assisted-top', 2000, assisted.exerciseId, assisted.name, 3, assisted.targetReps, [[25, 10], [25, 10], [25, 10]]),
  ], assisted)
  assert.match(plan.targetText, /22\.5 kg/)
  assert.match(plan.reason, /reduce assistance/)
})

test('timed and distance exercises advance within their units and stop at the prescribed cap', () => {
  const plank = { exerciseId: 'plank', name: 'Plank', targetSets: 2, targetReps: '45–60 seconds' }
  const timePlan = analytics.getProgressionPlan([
    record('plank', 1000, plank.exerciseId, plank.name, 2, plank.targetReps, [[null, 50], [null, 50]]),
  ], plank)
  assert.match(timePlan.targetText, /55sec/)
  assert.match(timePlan.reason, /Build the average completed sec/)
  const timeCap = analytics.getProgressionPlan([
    record('plank-cap', 1000, plank.exerciseId, plank.name, 2, plank.targetReps, [[null, 60], [null, 60]]),
  ], plank)
  assert.match(timeCap.reason, /Maintain this target/)

  const carries = { exerciseId: 'farmer-carries', name: 'Farmer Carries', targetSets: 3, targetReps: '30–40 seconds' }
  const carryPlan = analytics.getProgressionPlan([
    record('carry-step', 1000, carries.exerciseId, carries.name, 3, carries.targetReps, [[20, 40], [20, 40], [20, 40]]),
    record('carry-top', 2000, carries.exerciseId, carries.name, 3, carries.targetReps, [[22.5, 40], [22.5, 40], [22.5, 40]]),
  ], carries)
  assert.match(carryPlan.targetText, /25 kg/)
  assert.match(carryPlan.targetText, /30–40 sec/)

  const distance = { exerciseId: 'carry-distance', name: 'Carry', targetSets: 2, targetReps: '20–30 m' }
  const distancePlan = analytics.getProgressionPlan([
    record('distance', 1000, distance.exerciseId, distance.name, 2, distance.targetReps, [[20, 23], [20, 24]]),
  ], distance)
  assert.match(distancePlan.targetText, /24m/)
})

test('status uses multiple comparable exposures and does not react to one poor or readiness-scaled session', () => {
  const progressing = [
    record('a', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[30, 8], [30, 8], [30, 8]]),
    record('b', 2000, bench.exerciseId, bench.name, 3, bench.targetReps, [[32.5, 8], [32.5, 8], [32.5, 8]]),
    record('c', 3000, bench.exerciseId, bench.name, 3, bench.targetReps, [[35, 8], [35, 8], [35, 8]]),
  ]
  assert.equal(analytics.getProgressionPlan(progressing, bench).status, 'Progressing')
  const onePoor = [...progressing.slice(0, 2), record('poor', 3000, bench.exerciseId, bench.name, 3, bench.targetReps, [[20, 5], [20, 5], [20, 5]])]
  assert.notEqual(analytics.getProgressionPlan(onePoor, bench).status, 'Needs attention')
  const repeatedFailures = [
    record('passed', 1000, bench.exerciseId, bench.name, 3, bench.targetReps, [[30, 8], [30, 8], [30, 8]]),
    record('low-a', 2000, bench.exerciseId, bench.name, 3, bench.targetReps, [[30, 4], [30, 4], [30, 4]]),
    record('low-b', 3000, bench.exerciseId, bench.name, 3, bench.targetReps, [[30, 4], [30, 4], [30, 4]]),
  ]
  assert.equal(analytics.getProgressionPlan(repeatedFailures, bench).status, 'Needs attention')
  const reduced = record('reduced', 4000, bench.exerciseId, bench.name, 3, bench.targetReps, [[10, 2], [10, 2], [10, 2]], true)
  assert.equal(analytics.getProgressionPlan([...progressing, reduced], bench).status, 'Progressing')
  assert.equal(analytics.getStalledExercises([reduced]).length, 0)
})

test('plateau needs three full, comparable non-readiness exposures; PR logic still reads real sets', () => {
  const stalled = [1000, 2000, 3000].map((at, index) => record(`stable-${index}`, at, bench.exerciseId, bench.name, 3, bench.targetReps, [[40, 6], [40, 6], [40, 6]]))
  assert.equal(analytics.getStalledExercises(stalled).length, 1)
  assert.equal(analytics.getStalledExercises(stalled.slice(0, 2)).length, 0)
  const reduced = record('reduced', 4000, bench.exerciseId, bench.name, 3, bench.targetReps, [[5, 1], [5, 1], [5, 1]], true)
  assert.equal(analytics.getStalledExercises([...stalled.slice(0, 2), reduced]).length, 0)
  const onePoor = [...stalled.slice(0, 2), record('poor-normal', 4000, bench.exerciseId, bench.name, 3, bench.targetReps, [[20, 6], [20, 6], [20, 6]])]
  assert.equal(analytics.getStalledExercises(onePoor).length, 0)
  assert.ok(analytics.getPersonalRecords(stalled).length >= 1)
})

test('completion feedback distinguishes target achievement and readiness-reduced work', () => {
  const plan = analytics.getProgressionPlan([], bench)
  const achieved = Array.from({ length: 3 }, (_, index) => ({ id: String(index), weightKg: '40', reps: '8', completed: true }))
  const feedback = analytics.getExerciseCompletionFeedback(plan, achieved, true)
  assert.match(feedback, /top of the target/)
  assert.match(analytics.getExerciseCompletionFeedback(plan, achieved.slice(0, 2), true), /incomplete/)
  const adjusted = analytics.getProgressionPlan([], bench, 2, true)
  assert.match(analytics.getExerciseCompletionFeedback(adjusted, achieved.slice(0, 2), true), /does not lower your normal progression target/)
})

test('timed and bodyweight previous values prefill without inventing load', () => {
  const history = [record('bodyweight', 1000, 'pull-ups', 'Pull-ups', 3, '5–10', [[null, 8], [null, 7], [null, 6]])]
  const active = storage.createActiveWorkout('pull', 2000, history)
  const pullup = active.exercises.find((exercise) => exercise.exerciseId === 'pull-ups')
  assert.equal(pullup.sets[0].weightKg, '')
  assert.equal(pullup.sets[0].reps, '8')
})

test('unilateral performance stores each side and uses the weaker side for progression', () => {
  const exercise = { exerciseId: 'single-leg-balance', name: 'Single-Leg Balance', targetSets: 2, targetReps: '30 seconds per side' }
  const previous = record('balance', 1000, exercise.exerciseId, exercise.name, 2, exercise.targetReps, [[null, 25], [null, 30]])
  previous.exercises[0].sets[0].leftReps = 30
  previous.exercises[0].sets[0].rightReps = 25
  previous.exercises[0].sets[1].leftReps = 30
  previous.exercises[0].sets[1].rightReps = 30
  const plan = analytics.getProgressionPlan([previous], exercise)
  assert.equal(plan.metricType, 'per-side-time')
  assert.match(plan.reason, /weaker side/)
  const active = storage.createActiveWorkout('core', 2000, [previous])
  const state = active.exercises.find((item) => item.exerciseId === exercise.exerciseId)
  assert.equal(state.sets[0].leftReps, '30')
  assert.equal(state.sets[0].rightReps, '25')
  assert.equal(state.sets[0].reps, '25')
  const completed = {
    ...active,
    exercises: active.exercises.map((item) => ({
      ...item,
      completed: true,
      sets: item.sets.map((set) => ({ ...set, reps: set.reps || '1', completed: true })),
    })),
  }
  const workoutRecord = storage.createWorkoutRecord(completed, 3000)
  const recordedBalance = workoutRecord.exercises.find((item) => item.exerciseId === exercise.exerciseId).sets[0]
  assert.equal(recordedBalance.leftReps, 30)
  assert.equal(recordedBalance.rightReps, 25)
  const appData = { ...storage.createInitialData(), history: [workoutRecord] }
  assert.equal(storage.isAppData(appData), true)
})

test('assistance loads are excluded from estimated 1RM and weighted PR calculations', () => {
  const assisted = record('assist', 1000, 'assisted-pull-ups', 'Assisted Pull-ups', 3, '5–10', [[20, 10], [20, 10], [20, 10]])
  const performance = analytics.getExercisePerformances([assisted], 'assisted-pull-ups')[0]
  assert.equal(performance.estimatedOneRepMaxKg, null)
  assert.equal(performance.topWeightKg, null)
  assert.equal(analytics.getPersonalRecords([assisted]).length, 0)
})
