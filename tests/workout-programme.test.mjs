import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let workouts
let storage
let analytics
let substitutions
let muscleMap

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  workouts = await vite.ssrLoadModule('/src/workouts.ts')
  storage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  analytics = await vite.ssrLoadModule('/src/strengthAnalytics.ts')
  substitutions = await vite.ssrLoadModule('/src/exerciseSubstitutions.ts')
  muscleMap = await vite.ssrLoadModule('/src/muscleMap.ts')
})

after(async () => { await vite?.close() })

const rows = (workout) => workout.exercises.map(({ id, name, targetSets, targetReps }) => [id, name, targetSets, targetReps])

test('fixed weekly gym schedule maps weekdays and keeps both weekend days clear for rest', () => {
  assert.deepEqual(workouts.weeklyGymSchedule.map(({ day, workoutId }) => [day, workoutId]), [
    ['Monday', 'push'], ['Tuesday', 'pull'], ['Wednesday', 'core'],
    ['Thursday', 'arnold-chest-back'], ['Friday', 'arnold-shoulders-arms'],
    ['Saturday', null], ['Sunday', null],
  ])
  for (const [date, expected] of [
    [new Date(2026, 10, 16), 'Push'], [new Date(2026, 10, 17), 'Pull'],
    [new Date(2026, 10, 18), 'Core & Legs'], [new Date(2026, 10, 19), 'Arnold — Chest & Back'],
    [new Date(2026, 10, 20), 'Arnold — Shoulders & Arms'],
    [new Date(2026, 10, 21), null], [new Date(2026, 10, 22), null],
  ]) assert.equal(workouts.getScheduledWorkoutForDate(date)?.name ?? null, expected)
  assert.equal(storage.createInitialData().rotationIndex, 0, 'the legacy cursor is preserved and no longer selects a weekday workout')
  assert.deepEqual(workouts.getLowerBodyExercises(workouts.getWorkout('push')), [])
  assert.deepEqual(workouts.getLowerBodyExercises(workouts.getWorkout('pull')), [])
})

test('Push has the exact chest, shoulder and triceps list with no leg press or barbell overhead press', () => {
  assert.deepEqual(rows(workouts.getWorkout('push')), [
    ['incline-smith-machine-bench-press', 'Incline Smith Machine Bench Press', 3, '6–10'],
    ['pec-deck', 'Pec Deck', 3, '10–15'],
    ['machine-chest-press', 'Machine Chest Press', 3, '8–12'],
    ['machine-shoulder-press', 'Machine Shoulder Press', 3, '8–12'],
    ['dumbbell-lateral-raises', 'Dumbbell Lateral Raises', 3, '12–20'],
    ['single-arm-cable-tricep-pushdowns', 'Single-Arm Cable Tricep Pushdowns', 3, '10–15 per arm'],
    ['overhead-cable-tricep-extensions', 'Overhead Cable Tricep Extensions', 2, '10–15'],
  ])
  const pushdown = workouts.getWorkout('push').exercises[5]
  assert.equal(analytics.getExerciseMetricType(pushdown.id, pushdown.name, pushdown.targetReps), 'per-side')
  const pushdownPlan = analytics.getProgressionPlan([], { exerciseId: pushdown.id, name: pushdown.name, targetSets: pushdown.targetSets, targetReps: pushdown.targetReps })
  assert.equal(pushdownPlan.unit, 'reps/arm')
  assert.equal(pushdownPlan.targetMinimum, 10)
  assert.equal(pushdownPlan.targetMaximum, 15)
})

test('Pull prioritizes weighted pull-ups and removes the Smith row without changing the remaining order', () => {
  const pull = workouts.getWorkout('pull')
  assert.deepEqual(rows(pull), [
    ['pull-ups', 'Weighted Pull-Ups', 3, '5–8'],
    ['seated-cable-row', 'Seated Cable Row', 3, '8–12'],
    ['chest-supported-rows', 'Chest-Supported Row', 3, '8–12'],
    ['incline-dumbbell-curls', 'Incline Dumbbell Curls', 3, '8–12'],
    ['hammer-curls', 'Hammer Curls', 3, '10–15'],
    ['reverse-pec-deck', 'Reverse Pec Deck', 2, '12–15'],
  ])
  assert.ok(!pull.exercises.some((item) => ['smith-machine-bent-over-row', 'single-arm-cable-rows', 'romanian-deadlift'].includes(item.id)))

  const active = storage.createActiveWorkout('pull', 2000)
  assert.equal(analytics.getExerciseMetricType('pull-ups', 'Weighted Pull-Ups', '5–8'), 'reps')
  const weighted = {
    ...active,
    exercises: active.exercises.map((item, index) => index === 0
      ? { ...item, sets: item.sets.map((set, setIndex) => setIndex === 0 ? { ...set, weightKg: '12.5', reps: '6', completed: true } : set) }
      : item),
  }
  const record = storage.createWorkoutRecord(weighted, 3000)
  assert.equal(record.exercises[0].exerciseId, 'pull-ups')
  assert.equal(record.exercises[0].sets[0].weightKg, 12.5)
  assert.equal(record.exercises[0].sets[0].reps, 6)
  assert.equal(analytics.getProgressionPlan([record], { exerciseId: 'pull-ups', name: 'Weighted Pull-Ups', targetSets: 3, targetReps: '5–8' }).metricType, 'reps')
})

test('Arnold workout templates retain their requested names, exercise order, shared identities and targets', () => {
  const chestBack = workouts.getWorkout('arnold-chest-back')
  const shouldersArms = workouts.getWorkout('arnold-shoulders-arms')
  assert.equal(chestBack.name, 'Arnold — Chest & Back')
  assert.deepEqual(rows(chestBack), [
    ['barbell-bench-press', 'Barbell Bench Press', 3, '6–10'],
    ['lat-pulldown', 'Lat Pulldown', 3, '8–12'],
    ['incline-dumbbell-press', 'Incline Dumbbell Press', 2, '8–12'],
    ['standing-t-bar-row', 'Standing T-Bar Row', 3, '8–12'],
    ['pec-deck', 'Pec Deck', 2, '12–15'],
  ])
  assert.equal(shouldersArms.name, 'Arnold — Shoulders & Arms')
  assert.deepEqual(rows(shouldersArms), [
    ['dumbbell-lateral-raises', 'Dumbbell Lateral Raises', 3, '12–20'],
    ['reverse-pec-deck', 'Reverse Pec Deck', 3, '12–15'],
    ['preacher-curls', 'Preacher Curls', 3, '8–12'],
    ['overhead-cable-tricep-extensions', 'Overhead Cable Tricep Extensions', 3, '10–15'],
    ['cable-curls', 'Cable Bicep Curls', 2, '10–15'],
    ['cable-tricep-pushdowns', 'Cable Tricep Pushdowns', 2, '10–15'],
  ])
  assert.equal(chestBack.exercises.filter((item) => item.id === 'pec-deck')[0].id, workouts.getWorkout('push').exercises[1].id)
  assert.equal(chestBack.exercises.some((item) => /dumbbell bench|seated machine row|chest-supported row|cable chest fly/i.test(item.name)), false)
  assert.equal(shouldersArms.exercises.some((item) => /shoulder press/i.test(item.name)), false)
})

test('Core & Legs has the exact order and targets grouped as core, legs, then athleticism', () => {
  const core = workouts.getWorkout('core')
  assert.equal(core.name, 'Core & Legs')
  assert.deepEqual(rows(core), [
    ['hanging-knee-raises', 'Hanging Knee Raises', 3, '10–15'],
    ['cable-crunches', 'Cable Crunches', 3, '12–15'],
    ['pallof-press', 'Pallof Press', 2, '10 per side'],
    ['plank', 'Plank', 2, '45–60 seconds'],
    ['romanian-deadlift', 'Romanian Deadlift', 3, '8–10'],
    ['leg-press', 'Leg Press', 3, '8–12'],
    ['bulgarian-split-squats', 'Bulgarian Split Squats', 2, '8–10 per leg'],
    ['farmer-carries', 'Farmer Carries', 3, '30–40 seconds'],
    ['single-leg-balance', 'Single-Leg Balance', 2, '30 seconds per side'],
  ])
  assert.deepEqual([0, 4, 7].map((index) => core.exercises[index].name), [
    'Hanging Knee Raises', 'Romanian Deadlift', 'Farmer Carries',
  ])
  assert.equal(analytics.getExerciseMetricType('farmer-carries', 'Farmer Carries', '30–40 seconds'), 'timed')
  assert.equal(analytics.getExerciseMetricType('single-leg-balance', 'Single-Leg Balance', '30 seconds per side'), 'per-side-time')
  assert.ok(!core.exercises.some((item) => ['standing-cable-leg-curls', 'standing-calf-raises', 'dead-bug'].includes(item.id)))
})

test('Muscle Balance maps the new movements and preserves the established weighting method', () => {
  const expected = {
    'incline-smith-machine-bench-press': { chest: 1, triceps: 0.5, shoulders: 0.5 },
    'single-arm-cable-tricep-pushdowns': { triceps: 1 },
    'barbell-bench-press': { chest: 1, triceps: 0.5, shoulders: 0.5 },
    'incline-dumbbell-press': { chest: 1, shoulders: 0.5, triceps: 0.5 },
    'pec-deck': { chest: 1 },
    'machine-shoulder-press': { shoulders: 1, triceps: 0.5 },
    'pull-ups': { back: 1, biceps: 0.5 },
    'smith-machine-bent-over-row': { back: 1, biceps: 0.5, shoulders: 0.25 },
    'chest-supported-rows': { back: 1, biceps: 0.5, shoulders: 0.25 },
    'seated-cable-row': { back: 1, biceps: 0.5 },
    'standing-t-bar-row': { back: 1, biceps: 0.5, shoulders: 0.25 },
    'incline-dumbbell-curls': { biceps: 1 },
    'reverse-pec-deck': { shoulders: 1, back: 0.25 },
    'preacher-curls': { biceps: 1 },
    'hammer-curls': { biceps: 1 },
    'romanian-deadlift': { hamstrings: 1, glutes: 1, back: 0.5 },
    'leg-press': { quadriceps: 1, glutes: 0.5, hamstrings: 0.25 },
  }
  for (const [id, weights] of Object.entries(expected)) assert.deepEqual(muscleMap.getMuscleEntry(id).weights, weights, id)
  assert.equal(substitutions.catalogueMatchesMuscleMap(), true)
  assert.deepEqual(muscleMap.getMuscleEntry('smith-machine-bent-over-row').weights, expected['smith-machine-bent-over-row'])
  assert.ok(Object.keys(expected).filter((id) => id !== 'smith-machine-bent-over-row').every((id) => workouts.workouts.some((workout) => workout.exercises.some((exercise) => exercise.id === id))))
})

test('saved active sessions and historical workout names, exercises and sets normalize unchanged', () => {
  const oldExercises = [
    ['cable-crunches', 'Cable Crunches', 3, '10–15'],
    ['hanging-knee-raises', 'Hanging Knee Raises', 2, '8–12'],
    ['pallof-press', 'Pallof Press', 2, '10 per side'],
    ['farmer-carries', 'Farmer Carries', 3, '30–40 metres'],
    ['leg-press', 'Leg Press', 3, '8–12'],
    ['bulgarian-split-squats', 'Bulgarian Split Squats', 2, '8 per leg'],
    ['standing-cable-leg-curls', 'Standing Cable Leg Curls', 2, '10–15'],
    ['standing-calf-raises', 'Standing Calf Raises', 2, '12–15'],
  ].map(([id, name, targetSets, targetReps]) => ({
    id, name, focus: 'Previous programme', instructions: 'Saved instructions.',
    targetSets: Number(targetSets), targetReps, ...(id === 'leg-press' || id === 'bulgarian-split-squats' || id === 'standing-cable-leg-curls' || id === 'standing-calf-raises' ? { isLowerBody: true } : {}),
  }))
  const active = {
    id: 'active-core-before-update', workoutId: 'core', startedAt: 1_700_000_000_000,
    template: { id: 'core', name: 'Core & Legs', focus: 'Previous programme', description: 'Saved in-progress snapshot.', duration: '35–45 min', warmup: [], cooldown: [], exercises: oldExercises },
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
    id: 'historic-core-athleticism', workoutId: 'core', workoutName: 'Core & Athleticism',
    startedAt: 1_699_000_000_000, completedAt: 1_699_003_600_000, durationSeconds: 3600,
    exercises: [{ exerciseId: 'dead-bug', name: 'Dead Bug', instructions: 'Historical instructions.', targetSets: 2, targetReps: '8–12 per side', completed: true,
      sets: [{ id: 'historic-dead-bug-set', weightKg: null, reps: 10, completed: true }] }],
  }
  const previousPullRecord = {
    id: 'historic-pull-with-smith-row', workoutId: 'pull', workoutName: 'Pull',
    startedAt: 1_698_000_000_000, completedAt: 1_698_003_600_000, durationSeconds: 3600,
    exercises: [{ exerciseId: 'smith-machine-bent-over-row', name: 'Smith Machine Bent-Over Row', instructions: 'Historical row instructions.', targetSets: 3, targetReps: '6–8', completed: true,
      sets: [{ id: 'historic-smith-row-set', weightKg: 50, reps: 8, completed: true }] }],
  }
  const before = { ...storage.createInitialData(), rotationIndex: 2, currentWorkout: active, history: [previousRecord, previousPullRecord] }
  const restored = storage.normalizeAppData(before)
  assert.ok(restored)
  assert.equal(storage.isAppData(restored), true)
  assert.deepEqual(storage.normalizeAppData(restored), restored)
  assert.deepEqual(restored.currentWorkout, active)
  assert.deepEqual(restored.history, [previousRecord, previousPullRecord])
  assert.equal(storage.createWorkoutRecord(restored.currentWorkout, 1_700_003_600_000).workoutName, 'Core & Legs')
  assert.equal(restored.history[0].workoutName, 'Core & Athleticism')
  assert.equal(restored.history[1].exercises[0].name, 'Smith Machine Bent-Over Row')
  assert.equal(restored.history[1].exercises[0].sets[0].weightKg, 50)
  assert.equal(restored.rotationIndex, 2, 'the old rolling cursor is retained rather than reset or advanced by the date-based schedule')
})

test('new date-selected workout sessions persist without changing the old cursor or archived workout history', () => {
  const archivedRecord = {
    id: 'existing-push-history', workoutId: 'push', workoutName: 'Push',
    startedAt: 1_700_000_000_000, completedAt: 1_700_003_600_000, durationSeconds: 3600,
    exercises: [{ exerciseId: 'old-bench', name: 'Bench Press', instructions: 'Archived snapshot.', targetSets: 3, targetReps: '5–8', completed: true,
      sets: [{ id: 'old-bench-set', weightKg: 60, reps: 8, completed: true }] }],
  }
  const current = storage.createActiveWorkout('arnold-chest-back', 1_700_010_000_000, [archivedRecord])
  const before = { ...storage.createInitialData(), rotationIndex: 2, currentWorkout: current, history: [archivedRecord] }
  const restored = storage.normalizeAppData(before)
  assert.ok(restored)
  assert.equal(storage.isAppData(restored), true)
  assert.equal(restored.rotationIndex, 2)
  assert.deepEqual(restored.history, [archivedRecord])
  assert.deepEqual(restored.currentWorkout, current)
  const completed = storage.createWorkoutRecord(current, 1_700_013_600_000)
  assert.equal(completed.workoutId, 'arnold-chest-back')
  assert.equal(completed.workoutName, 'Arnold — Chest & Back')
  assert.equal(completed.exercises[0].exerciseId, 'barbell-bench-press')
})
