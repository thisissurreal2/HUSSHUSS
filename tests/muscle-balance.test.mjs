import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let muscleMap
let muscleBalance
let workoutsModule

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  muscleMap = await vite.ssrLoadModule('/src/muscleMap.ts')
  muscleBalance = await vite.ssrLoadModule('/src/muscleBalance.ts')
  workoutsModule = await vite.ssrLoadModule('/src/workouts.ts')
})

after(async () => {
  await vite?.close()
})

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 12, 12, 0, 0)

function set(id, reps, weightKg = 20, completed = true) {
  return { id, weightKg, reps, completed }
}

function exercise(exerciseId, sets, { name = exerciseId, targetReps = '8–12' } = {}) {
  return {
    exerciseId,
    name,
    instructions: '',
    targetSets: sets.length,
    targetReps,
    completed: true,
    sets,
  }
}

function record(id, daysAgo, exercises) {
  const completedAt = NOW.getTime() - daysAgo * DAY
  return {
    id,
    workoutId: 'push',
    workoutName: 'Push',
    startedAt: completedAt - 60_000,
    completedAt,
    durationSeconds: 60,
    exercises,
  }
}

function stat(result, muscle) {
  return result.current.muscles.find((item) => item.muscle === muscle)
}

test('every exercise in the current rotation has a muscle mapping', () => {
  for (const workout of workoutsModule.workouts) {
    for (const item of workout.exercises) {
      assert.ok(muscleMap.getMuscleEntry(item.id), `Missing muscle mapping for ${item.id}`)
    }
  }
})

test('legacy exercise IDs from earlier versions are mapped', () => {
  const legacy = [
    'dumbbell-bench-press', 'seated-shoulder-press', 'cable-fly', 'goblet-squat', 'lat-pulldown',
    'chest-supported-row', 'face-pull', 'dead-bug', 'front-plank', 'seated-calf-raise',
  ]
  for (const id of legacy) assert.ok(muscleMap.getMuscleEntry(id), `Missing legacy mapping for ${id}`)
})

test('mapping weights follow the rubric and only reference known muscles', () => {
  const allowed = new Set([0.25, 0.5, 0.75, 1])
  const known = new Set(muscleMap.muscles.map((item) => item.id))
  for (const [id, entry] of Object.entries(muscleMap.exerciseMuscleMap)) {
    if (entry.excluded) {
      assert.ok(entry.reason.length > 0, `${id} is excluded without a reason`)
      continue
    }
    const weights = Object.entries(entry.weights)
    assert.ok(weights.length > 0, `${id} has no weights`)
    assert.ok(weights.some(([, weight]) => weight === 1), `${id} has no primary muscle`)
    for (const [muscle, weight] of weights) {
      assert.ok(known.has(muscle), `${id} references unknown muscle ${muscle}`)
      assert.ok(allowed.has(weight), `${id} has off-rubric weight ${weight}`)
    }
  }
})

test('farmer carries and single-leg balance are excluded by design', () => {
  assert.equal(muscleMap.getMuscleEntry('farmer-carries').excluded, true)
  assert.equal(muscleMap.getMuscleEntry('single-leg-balance').excluded, true)
})

test('a bench press set contributes by mapped weight', () => {
  const history = [record('a', 1, [exercise('barbell-bench-press', [set('1', 5), set('2', 5), set('3', 5)])])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(stat(result, 'chest').weightedSets, 3)
  assert.equal(stat(result, 'triceps').weightedSets, 1.5)
  assert.equal(stat(result, 'shoulders').weightedSets, 1.5)
  assert.equal(stat(result, 'back').weightedSets, 0)
  assert.equal(result.current.countedSets, 3)
})

test('only completed sets with reps are counted; exercise-level completion is ignored', () => {
  const history = [record('a', 1, [exercise('pull-ups', [
    set('1', 8),
    set('2', 8, 0, false),
    set('3', null, 0, true),
  ])])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(stat(result, 'back').weightedSets, 1)
  assert.equal(result.current.setsWithoutReps, 1)
  assert.equal(result.current.countedSets, 1)
})

test('excluded and unmapped exercises are reported, not silently counted', () => {
  const history = [record('a', 1, [
    exercise('farmer-carries', [set('1', 40, 24)], { targetReps: '30–40 seconds' }),
    exercise('mystery-machine', [set('2', 10), set('3', 10)], { name: 'Mystery Machine' }),
  ])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(result.current.totalWeightedSets, 0)
  assert.equal(result.current.designExcludedSets, 1)
  assert.equal(result.current.unmappedSets, 2)
  assert.deepEqual(result.current.unmappedExerciseNames, ['Mystery Machine'])
})

test('windows use calendar days and an equal-length previous window', () => {
  const history = [
    record('today', 0, [exercise('cable-crunches', [set('1', 12)])]),
    record('edge', 6, [exercise('cable-crunches', [set('2', 12)])]),
    record('outside', 8, [exercise('cable-crunches', [set('3', 12)])]),
  ]
  const result = muscleBalance.analyzeMuscleBalance(history, '7d', NOW)
  assert.equal(result.current.workoutCount, 2)
  assert.equal(result.previous.workoutCount, 1)
  assert.equal(stat(result, 'core').weightedSets, 2)
})

test('future-dated records are ignored', () => {
  const history = [record('future', -1, [exercise('cable-crunches', [set('1', 12)])])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(result.current.workoutCount, 0)
})

test('weekly rate, share and relative values are consistent', () => {
  const history = [record('a', 2, [
    exercise('barbell-bench-press', [set('1', 5), set('2', 5)]),
    exercise('cable-tricep-pushdowns', [set('3', 12)]),
  ])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  const chest = stat(result, 'chest')
  assert.equal(chest.weightedSets, 2)
  assert.ok(Math.abs(chest.setsPerWeek - 2 / (30 / 7)) < 1e-9)
  assert.equal(chest.relative, 1)
  const shareSum = result.current.muscles.reduce((total, item) => total + item.share, 0)
  assert.ok(Math.abs(shareSum - 1) < 1e-9)
})

test('a lone minor-contribution set does not count as a trained day', () => {
  const history = [record('a', 1, [exercise('bulgarian-split-squats', [set('1', 8)], { targetReps: '8 per leg' })])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(stat(result, 'core').weightedSets, 0.25)
  assert.equal(stat(result, 'core').trainedDays, 0)
  assert.equal(stat(result, 'quadriceps').trainedDays, 1)
})

test('volume load only uses loaded sets in standard rep ranges', () => {
  const history = [record('a', 1, [
    exercise('barbell-bench-press', [set('1', 5, 60), set('2', 5, 60)], { targetReps: '5–8' }),
    exercise('plank', [set('3', 50, 0)], { targetReps: '45–60 seconds' }),
  ])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(stat(result, 'chest').volumeLoadKg, 600)
  assert.equal(stat(result, 'triceps').volumeLoadKg, 300)
  assert.equal(stat(result, 'core').volumeLoadKg, 0)
})

test('insights are withheld until there are enough sessions', () => {
  const history = [record('a', 1, [exercise('barbell-bench-press', [set('1', 5)])])]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  assert.equal(result.lowConfidence, true)
  assert.equal(result.insights.length, 1)
  assert.equal(result.insights[0].kind, 'info')
})

test('no workouts means no insights and no low-confidence flag', () => {
  const result = muscleBalance.analyzeMuscleBalance([], '30d', NOW)
  assert.equal(result.insights.length, 0)
  assert.equal(result.lowConfidence, false)
  assert.equal(result.current.totalWeightedSets, 0)
})

test('insights report related-pair ratios and the new calf rotation coverage from real data', () => {
  const history = [1, 3, 5, 7].map((daysAgo, index) => record(`r${index}`, daysAgo, [
    exercise('barbell-bench-press', [set(`a${index}`, 5), set(`b${index}`, 5), set(`c${index}`, 5)]),
    exercise('romanian-deadlift', [set(`d${index}`, 8)]),
  ]))
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  const ids = result.insights.map((item) => item.id)
  assert.ok(ids.includes('gap-covered'))
  assert.match(result.insights.find((item) => item.id === 'gap-covered').text, /calves/i)
  assert.ok(!ids.includes('pair-biceps-triceps'), 'zero-exposure pairs are reported as gaps, not ratios')
  assert.ok(ids.includes('pair-chest-back'))
})

test('change insights compare against the previous equal window', () => {
  const heavyBack = (id, daysAgo, sets) => record(id, daysAgo, [
    exercise('pull-ups', Array.from({ length: sets }, (_, index) => set(`${id}-${index}`, 8))),
  ])
  const history = [
    heavyBack('p1', 40, 3), heavyBack('p2', 42, 3), heavyBack('p3', 44, 3),
    heavyBack('c1', 2, 6), heavyBack('c2', 4, 6), heavyBack('c3', 6, 6),
  ]
  const result = muscleBalance.analyzeMuscleBalance(history, '30d', NOW)
  const change = result.insights.find((item) => item.id === 'change-back')
  assert.ok(change, 'expected a back change insight')
  assert.ok(change.text.includes('up 100%'))
  assert.equal(result.changeFraction.back, 1)
})

test('rotation coverage reflects the mapped exercises', () => {
  assert.equal(muscleBalance.rotationCoversMuscle('calves'), true)
  assert.equal(muscleBalance.rotationCoversMuscle('hamstrings'), true)
  assert.equal(muscleBalance.rotationCoversMuscle('chest'), true)
})
