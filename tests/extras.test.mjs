import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let extras
let xp
let muscleBalance
let workoutStorage

before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  extras = await vite.ssrLoadModule('/src/extras.ts')
  xp = await vite.ssrLoadModule('/src/xp.ts')
  muscleBalance = await vite.ssrLoadModule('/src/muscleBalance.ts')
  workoutStorage = await vite.ssrLoadModule('/src/workoutStorage.ts')
})

after(async () => { await vite?.close() })

test('EXTRAS catalogue contains six categories and the specified exercise set', () => {
  assert.equal(extras.extraCategories.length, 6)
  assert.equal(extras.extraExercises.length, 24)
  assert.ok(extras.getExtraExercise('gentle-neck-flexion'))
  assert.ok(!extras.extraExercises.some((item) => /neck bridge/i.test(item.name)))
})

test('completed extra work units award 10 XP each and a single eligible session bonus', () => {
  const session = extras.createExtraSession(['wrist-curls', 'reverse-wrist-curls'], 1000)
  const completed = { ...session, exercises: session.exercises.map((item) => ({ ...item, units: item.units.map((unit) => ({ ...unit, completed: true })) })) }
  const record = extras.completeExtraSession(completed, 2000)
  assert.equal(record.status, 'completed')
  assert.equal(record.xpEarned, 55)
  assert.equal(record.sessionBonusEarned, true)
  assert.equal(extras.completeExtraSession(record, 3000).xpEarned, 55)
})

test('one completed exercise earns work-unit XP without the session bonus', () => {
  const session = extras.createExtraSession(['standing-calf-raises'], 1000)
  const partial = { ...session, exercises: session.exercises.map((item) => ({ ...item, units: item.units.map((unit, index) => ({ ...unit, completed: index === 0 })) })) }
  const record = extras.completeExtraSession(partial, 2000)
  assert.equal(record.xpEarned, 10)
  assert.equal(record.sessionBonusEarned, false)
})

test('cancelled and untouched sessions earn no XP', () => {
  const session = extras.createExtraSession(['dead-hangs'], 1000)
  const record = extras.completeExtraSession(session, 2000)
  assert.equal(record.status, 'cancelled')
  assert.equal(record.xpEarned, 0)
  assert.equal(record.completedAt, null)
})

test('extra XP contributes to the existing level total without changing normal workout XP', () => {
  const summary = xp.getXpSummary([], [{ id: 'x', startedAt: 1, completedAt: 2, status: 'completed', category: 'forearms-grip', exercises: [], xpEarned: 55, sessionBonusEarned: true }])
  assert.equal(summary.totalXp, 55)
  assert.equal(xp.getXpSummary([]).totalXp, 0)
})

test('extra exposure separates supplementary muscles from the ten-axis radar', () => {
  const session = extras.createExtraSession(['dumbbell-shrugs', 'wrist-curls'], 1000)
  const completed = extras.completeExtraSession({ ...session, exercises: session.exercises.map((item) => ({ ...item, units: item.units.map((unit) => ({ ...unit, completed: true })) })) }, 2000)
  const exposure = muscleBalance.computeExtraExposure([completed], { start: 0, end: 3000 }, 7)
  assert.equal(exposure.supplementary.find((item) => item.muscle === 'traps').weightedSets, 2)
  assert.equal(exposure.supplementary.find((item) => item.muscle === 'forearms').weightedSets, 2)
})


test('older AppData without EXTRAS fields normalizes to empty EXTRAS collections', () => {
  const oldData = { ...workoutStorage.createInitialData() }
  delete oldData.extrasSessions
  delete oldData.extrasFavourites
  const normalized = workoutStorage.normalizeAppData(oldData)
  assert.deepEqual(normalized.extrasSessions, [])
  assert.deepEqual(normalized.extrasFavourites, [])
})

test('recommendations use gentle mobility when there is no training history', () => {
  assert.equal(extras.getExtraRecommendation([], []).category, 'mobility-flexibility')
})

test('EXTRAS source can be isolated from main exposure and combined', () => {
  const session = extras.createExtraSession(['standing-calf-raises'], 1000)
  const completed = extras.completeExtraSession({ ...session, exercises: session.exercises.map((item) => ({ ...item, units: item.units.map((unit) => ({ ...unit, completed: true })) })) }, 2000)
  const extra = muscleBalance.computeExtraExposure([completed], { start: 0, end: 3000 }, 30)
  const main = muscleBalance.computeExposure([], 30)
  const onlyExtra = muscleBalance.applyMuscleSource(main, extra, 30, 'extras')
  const combined = muscleBalance.applyMuscleSource(main, extra, 30, 'combined')
  assert.equal(onlyExtra.muscles.find((item) => item.muscle === 'calves').weightedSets, 2)
  assert.equal(combined.muscles.find((item) => item.muscle === 'calves').weightedSets, 2)
})
