import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let substitutions
let storage
let analytics
let xp
let muscleBalance
let workouts

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  substitutions = await vite.ssrLoadModule('/src/exerciseSubstitutions.ts')
  storage = await vite.ssrLoadModule('/src/workoutStorage.ts')
  analytics = await vite.ssrLoadModule('/src/strengthAnalytics.ts')
  xp = await vite.ssrLoadModule('/src/xp.ts')
  muscleBalance = await vite.ssrLoadModule('/src/muscleBalance.ts')
  workouts = await vite.ssrLoadModule('/src/workouts.ts')
})

after(async () => { await vite?.close() })

function record(id, exerciseId, name, targetReps, sets, completedAt = 1000, originalExerciseId) {
  return {
    id, workoutId: 'push', workoutName: 'Push', startedAt: completedAt - 1800_000, completedAt, durationSeconds: 1800,
    exercises: [{ exerciseId, name, instructions: '', targetSets: sets.length, targetReps, completed: true,
      ...(originalExerciseId ? { originalExerciseId, substitutionReason: 'equipment-unavailable' } : {}),
      sets: sets.map(([weightKg, reps], index) => ({ id: `${id}-${index}`, weightKg, reps, completed: true })) }],
  }
}

test('matches preserve movement pattern and muscle purpose rather than muscle alone', () => {
  const bench = substitutions.getSubstitutionCandidates('barbell-bench-press', 'equipment-unavailable')
  assert.ok(bench.some((item) => item.id === 'dumbbell-bench-press'))
  assert.ok(bench.some((item) => item.id === 'machine-chest-press'))
  assert.ok(bench.some((item) => item.id === 'push-ups'))
  const lateral = substitutions.getSubstitutionCandidates('dumbbell-lateral-raises', 'variation')
  assert.ok(lateral.length > 0)
  assert.ok(lateral.every((item) => item.pattern === 'shoulder-isolation'))
  assert.ok(!lateral.some((item) => item.id === 'machine-shoulder-press'))
  assert.ok(substitutions.getSubstitutionCandidates('pull-ups', 'variation').some((item) => item.id === 'lat-pulldown'))
  assert.ok(substitutions.getSubstitutionCandidates('romanian-deadlift', 'variation').some((item) => item.id === 'dumbbell-romanian-deadlift'))
})

test('muscle metadata matches Muscle Balance map and equipment filters remove unavailable choices', () => {
  assert.equal(substitutions.catalogueMatchesMuscleMap(), true)
  const filtered = substitutions.getSubstitutionCandidates('barbell-bench-press', 'equipment-unavailable', ['machine', 'dumbbells', 'bodyweight', 'bench'])
  assert.ok(filtered.every((item) => !item.equipment.some((equipment) => ['machine', 'dumbbells', 'bodyweight', 'bench'].includes(equipment))))
  assert.ok(filtered.length === 0)
  const machineOccupied = substitutions.getSubstitutionCandidates('pull-ups', 'machine-occupied')
  assert.ok(machineOccupied.every((item) => !item.equipment.includes('machine')))
})

test('session substitution uses the alternative own history and preserves the programme and original history', () => {
  const originalHistory = record('old-bench', 'barbell-bench-press', 'Barbell Bench Press', '5–8', [[70, 8], [70, 8], [70, 7]])
  const substituteHistory = record('old-dumbbell', 'dumbbell-bench-press', 'Dumbbell Bench Press', '8–12', [[22.5, 10], [22.5, 9], [22.5, 8]])
  const active = storage.createActiveWorkout('arnold-chest-back', 2000, [originalHistory, substituteHistory])
  const programme = workouts.getWorkout('arnold-chest-back')
  const next = substitutions.applySessionSubstitution(active, 0, 'dumbbell-bench-press', 'equipment-unavailable', [originalHistory, substituteHistory])
  assert.equal(next.template.exercises[0].id, 'dumbbell-bench-press')
  assert.equal(next.template.exercises[0].targetReps, '8–12')
  assert.equal(next.exercises[0].exerciseId, 'dumbbell-bench-press')
  assert.equal(next.exercises[0].completed, false)
  assert.deepEqual([next.exercises[0].sets[0].weightKg, next.exercises[0].sets[0].reps], ['22.5', '10'])
  assert.equal(next.exercises[0].substitution.originalExerciseId, 'barbell-bench-press')
  assert.equal(workouts.getWorkout('arnold-chest-back').exercises[0].id, programme.exercises[0].id)
  assert.equal(originalHistory.exercises[0].sets[0].weightKg, 70)
})

test('substitute progression starts from its own history and unrelated original history is not a comparison', () => {
  const bench = record('bench', 'barbell-bench-press', 'Barbell Bench Press', '5–8', [[100, 8], [100, 8], [100, 8]])
  const exercise = { exerciseId: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', targetSets: 3, targetReps: '8–12' }
  assert.equal(analytics.getProgressionPlan([bench], exercise).status, 'New exercise')
  const own = record('db', exercise.exerciseId, exercise.name, exercise.targetReps, [[20, 9], [20, 8], [20, 8]])
  assert.equal(analytics.getProgressionPlan([bench, own], exercise).sourceRecord.id, 'db')
})

test('actual substitute ID drives Muscle Balance and XP once; record retains original prescription', () => {
  const active = storage.createActiveWorkout('arnold-chest-back', 2000, [])
  let substituted = substitutions.applySessionSubstitution(active, 0, 'machine-chest-press', 'machine-occupied', [])
  substituted = {
    ...substituted,
    exercises: substituted.exercises.map((exercise, index) => ({
      ...exercise, completed: true,
      sets: exercise.sets.map((set) => ({ ...set, weightKg: index === 0 ? '25' : '', reps: '8', completed: index === 0 })),
    })),
  }
  const saved = storage.createWorkoutRecord(substituted, 3000)
  const actual = saved.exercises.find((exercise) => exercise.exerciseId === 'machine-chest-press')
  assert.equal(actual.originalExerciseId, 'barbell-bench-press')
  assert.equal(actual.substitutionReason, 'machine-occupied')
  assert.equal(saved.exercises.some((exercise) => exercise.exerciseId === 'barbell-bench-press'), false)
  assert.equal(muscleBalance.computeExposure([saved], 7).unmappedSets, 0)
  const summary = xp.getXpSummary([saved])
  assert.equal(summary.lastWorkoutXp, 3 * xp.XP_PER_SET + xp.XP_PER_WORKOUT)
})

test('preferred replacements validate, can change or be removed, and normalize older AppData', () => {
  assert.equal(substitutions.validateSubstitutionForExercise('barbell-bench-press', 'machine-chest-press'), true)
  assert.equal(substitutions.validateSubstitutionForExercise('dumbbell-lateral-raises', 'machine-shoulder-press'), false)
  const oldData = storage.createInitialData()
  delete oldData.preferredSubstitutions
  assert.deepEqual(storage.normalizeAppData(oldData).preferredSubstitutions, {})
  const withPreference = { ...oldData, preferredSubstitutions: { 'barbell-bench-press': 'machine-chest-press' } }
  assert.equal(storage.isAppData(withPreference), true)
  assert.equal(storage.normalizeAppData(withPreference).preferredSubstitutions['barbell-bench-press'], 'machine-chest-press')
  const changed = { ...withPreference, preferredSubstitutions: { 'barbell-bench-press': 'push-ups' } }
  assert.equal(storage.isAppData(changed), true)
  const removed = { ...changed, preferredSubstitutions: {} }
  assert.equal(storage.isAppData(removed), true)
})

test('replacement selectors keep a pain caution and alternatives explain a comparable movement', () => {
  const options = substitutions.getSubstitutionCandidates('hanging-knee-raises', 'pain')
  assert.ok(options.some((item) => item.id === 'captains-chair-knee-raises'))
  assert.ok(options.every((item) => item.pattern === 'trunk-flexion'))
  assert.ok(options.every((item) => item.reason.length > 0 && item.difficulty.length > 0))
})
