import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let workouts
let storage
let analytics
let substitutions

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  workouts = await vite.ssrLoadModule('/src/workouts.ts')
  storage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  analytics = await vite.ssrLoadModule('/src/strengthAnalytics.ts')
  substitutions = await vite.ssrLoadModule('/src/exerciseSubstitutions.ts')
})

after(async () => { await vite?.close() })

test('rotation is Push, Pull, Core & Legs and the next workout begins at Push', () => {
  assert.deepEqual(workouts.workouts.map(({ id, name }) => [id, name]), [
    ['push', 'Push'], ['pull', 'Pull'], ['core', 'Core & Legs'],
  ])
  const initial = storage.createInitialData()
  assert.equal(workouts.workouts[initial.rotationIndex].name, 'Push')
  assert.equal(workouts.workouts[(2 + 1) % workouts.workouts.length].name, 'Push')
})

test('Core & Legs contains exactly the requested eight exercises and targets', () => {
  const core = workouts.getWorkout('core')
  assert.equal(core.name, 'Core & Legs')
  assert.deepEqual(core.exercises.map(({ id, name, targetSets, targetReps }) => [id, name, targetSets, targetReps]), [
    ['cable-crunches', 'Cable Crunches', 3, '10–15'],
    ['hanging-knee-raises', 'Hanging Knee Raises', 2, '8–12'],
    ['pallof-press', 'Pallof Press', 2, '10 per side'],
    ['farmer-carries', 'Farmer Carries', 3, '30–40 metres'],
    ['leg-press', 'Leg Press', 3, '8–12'],
    ['bulgarian-split-squats', 'Bulgarian Split Squats', 2, '8 per leg'],
    ['standing-cable-leg-curls', 'Standing Cable Leg Curls', 2, '10–15'],
    ['standing-calf-raises', 'Standing Calf Raises', 2, '12–15'],
  ])
  assert.ok(core.exercises.some((exercise) => exercise.id === 'farmer-carries'))
  assert.ok(core.exercises.some((exercise) => exercise.id === 'hanging-knee-raises'))
  assert.ok(!core.exercises.some((exercise) => exercise.id === 'dead-bug'))
  assert.equal(analytics.getExerciseMetricType('farmer-carries', 'Farmer Carries', '30–40 metres'), 'distance')
  assert.equal(substitutions.catalogueMatchesMuscleMap(), true)
})

test('new leg accessories retain progression and suitable equipment substitutions', () => {
  const curl = { exerciseId: 'standing-cable-leg-curls', name: 'Standing Cable Leg Curls', targetSets: 2, targetReps: '10–15' }
  const calf = { exerciseId: 'standing-calf-raises', name: 'Standing Calf Raises', targetSets: 2, targetReps: '12–15' }
  assert.equal(analytics.getProgressionPlan([], curl).metricType, 'reps')
  assert.equal(analytics.getProgressionPlan([], calf).metricType, 'reps')
  assert.ok(substitutions.getSubstitutionCandidates(curl.exerciseId, 'equipment-unavailable', ['cable']).some((item) => item.id === 'band-leg-curls'))
  assert.ok(substitutions.getSubstitutionCandidates(calf.exerciseId, 'equipment-unavailable', ['machine']).some((item) => item.id === 'single-leg-calf-raises'))
})

test('saved Core & Athleticism active session and history survive unchanged beside the new template', () => {
  const oldExercises = [
    ['hanging-knee-raises', 'Hanging Knee Raises', 3, '10–15'],
    ['cable-crunches', 'Cable Crunches', 3, '12–15'],
    ['pallof-press', 'Pallof Press', 3, '10 per side'],
    ['bulgarian-split-squats', 'Bulgarian Split Squats', 3, '8 per leg'],
    ['farmer-carries', 'Farmer Carries', 3, '30–40 seconds'],
    ['single-leg-balance', 'Single-Leg Balance', 2, '30 seconds per side'],
    ['plank', 'Plank', 2, '45–60 seconds'],
  ].map(([id, name, targetSets, targetReps]) => ({
    id, name, focus: 'Previous routine', instructions: 'Preserved session instructions.',
    targetSets: Number(targetSets), targetReps,
  }))
  const active = {
    id: 'active-core-before-programme-change', workoutId: 'core', startedAt: 1_700_000_000_000,
    template: {
      id: 'core', name: 'Core & Athleticism', focus: 'Trunk · stability · balance',
      description: 'Saved in-progress session snapshot.', duration: '30–40 min',
      warmup: [], cooldown: [], exercises: oldExercises,
    },
    exercises: oldExercises.map((exercise, index) => ({
      exerciseId: exercise.id, completed: index < 3,
      sets: Array.from({ length: exercise.targetSets }, (_, setIndex) => ({
        id: `${exercise.id}-${setIndex}`, weightKg: index < 3 ? String(15 + index) : '',
        reps: index < 3 ? String(10 + setIndex) : '', completed: index < 3,
      })),
    })),
    warmupCompletedIds: [], cooldownCompletedIds: [],
  }
  const previousRecord = {
    id: 'completed-core-history-before-change', workoutId: 'core', workoutName: 'Core & Athleticism',
    startedAt: 1_699_000_000_000, completedAt: 1_699_003_600_000, durationSeconds: 3600,
    exercises: [{ exerciseId: 'dead-bug', name: 'Dead Bug', instructions: 'Historical instructions.', targetSets: 2, targetReps: '8–12 per side', completed: true,
      sets: [{ id: 'historic-dead-bug-set', weightKg: null, reps: 10, completed: true }] }],
  }
  const existing = {
    ...storage.createInitialData(), rotationIndex: 2, currentWorkout: active, history: [previousRecord],
  }

  const normalized = storage.normalizeAppData(existing)
  assert.ok(normalized)
  assert.deepEqual(normalized.currentWorkout, active)
  assert.equal(normalized.currentWorkout.template.name, 'Core & Athleticism')
  assert.deepEqual(normalized.currentWorkout.exercises.slice(0, 3), active.exercises.slice(0, 3))
  assert.deepEqual(normalized.history, [previousRecord])
  assert.equal(storage.createWorkoutRecord(normalized.currentWorkout, 1_700_003_600_000).workoutName, 'Core & Athleticism')
  assert.equal(workouts.getWorkout('core').name, 'Core & Legs')
  assert.equal(workouts.workouts[(normalized.rotationIndex + 1) % workouts.workouts.length].name, 'Push')
})
