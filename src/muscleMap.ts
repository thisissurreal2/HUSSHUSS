/**
 * Exercise → muscle contribution map for Muscle Balance.
 *
 * This is the single, reviewable source of truth for how much each exercise
 * contributes to each radar muscle group. It is static code, not user data:
 * nothing here is stored in IndexedDB, so history, backups and sync are
 * unaffected and every past workout is analysed with the same table.
 *
 * Weight rubric (per completed set):
 *   1.00  primary driver of the movement
 *   0.75  strong contributor
 *   0.50  secondary contributor
 *   0.25  minor contributor or stabiliser
 *
 * Muscles that are not on the radar (forearms, hip flexors, rear-delt detail)
 * carry no weight; where relevant they are mentioned in `notes`.
 *
 * Exercise IDs must match `workouts.ts`. Legacy IDs from earlier app versions
 * are kept so older history is still counted.
 */

export type MuscleId =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'core'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'calves'

export type MuscleWeight = 0.25 | 0.5 | 0.75 | 1

export type MuscleWeights = Partial<Record<MuscleId, MuscleWeight>>

export type ExerciseMuscleEntry =
  | { excluded?: false; weights: MuscleWeights; notes?: string }
  | { excluded: true; reason: string }

export const muscles: { id: MuscleId; label: string; shortLabel: string }[] = [
  { id: 'chest', label: 'Chest', shortLabel: 'Chest' },
  { id: 'back', label: 'Back', shortLabel: 'Back' },
  { id: 'shoulders', label: 'Shoulders', shortLabel: 'Shoulders' },
  { id: 'biceps', label: 'Biceps', shortLabel: 'Biceps' },
  { id: 'triceps', label: 'Triceps', shortLabel: 'Triceps' },
  { id: 'core', label: 'Core', shortLabel: 'Core' },
  { id: 'quadriceps', label: 'Quadriceps', shortLabel: 'Quads' },
  { id: 'hamstrings', label: 'Hamstrings', shortLabel: 'Hams' },
  { id: 'glutes', label: 'Glutes', shortLabel: 'Glutes' },
  { id: 'calves', label: 'Calves', shortLabel: 'Calves' },
]

export function getMuscleLabel(id: MuscleId): string {
  return muscles.find((muscle) => muscle.id === id)?.label ?? id
}

export const exerciseMuscleMap: Record<string, ExerciseMuscleEntry> = {
  // ── Current rotation: Push ──────────────────────────────────────────────
  'barbell-bench-press': {
    weights: { chest: 1, triceps: 0.5, shoulders: 0.5 },
    notes: 'Shoulders = front delts.',
  },
  'incline-dumbbell-press': {
    weights: { chest: 1, shoulders: 0.5, triceps: 0.5 },
  },
  'overhead-shoulder-press': {
    weights: { shoulders: 1, triceps: 0.5 },
  },
  'dumbbell-lateral-raises': {
    weights: { shoulders: 1 },
  },
  'cable-tricep-pushdowns': {
    weights: { triceps: 1 },
  },
  'overhead-cable-tricep-extensions': {
    weights: { triceps: 1 },
  },
  'leg-press': {
    weights: { quadriceps: 1, glutes: 0.5, hamstrings: 0.25 },
  },

  // ── Current rotation: Pull ──────────────────────────────────────────────
  'romanian-deadlift': {
    weights: { hamstrings: 1, glutes: 1, back: 0.5 },
    notes: 'Back = spinal erectors holding the hinge.',
  },
  'pull-ups': {
    weights: { back: 1, biceps: 0.5 },
    notes: 'Back = mainly lats. Grip/forearms not on the radar.',
  },
  'chest-supported-rows': {
    weights: { back: 1, biceps: 0.5, shoulders: 0.25 },
    notes: 'Shoulders = rear delts.',
  },
  'single-arm-cable-rows': {
    weights: { back: 1, biceps: 0.5 },
  },
  'reverse-pec-deck': {
    weights: { shoulders: 1, back: 0.25 },
    notes: 'Shoulders = rear delts; back = upper-back retractors.',
  },
  'preacher-curls': {
    weights: { biceps: 1 },
  },
  'hammer-curls': {
    weights: { biceps: 1 },
    notes: 'Forearms are not on the radar.',
  },

  // ── Current rotation: Core & Athleticism ────────────────────────────────
  'hanging-knee-raises': {
    weights: { core: 1 },
    notes: 'Hip flexors are not on the radar.',
  },
  'cable-crunches': {
    weights: { core: 1 },
  },
  'pallof-press': {
    weights: { core: 1 },
  },
  'bulgarian-split-squats': {
    weights: { quadriceps: 1, glutes: 0.75, hamstrings: 0.25, core: 0.25 },
  },
  plank: {
    weights: { core: 1 },
    notes: 'Logged in seconds; counted as one set like any other.',
  },
  'farmer-carries': {
    excluded: true,
    reason: 'Loaded carries are timed and grip-dominated; excluded from the radar by design.',
  },
  'single-leg-balance': {
    excluded: true,
    reason: 'Balance holds are low-load; excluded so they do not inflate calves, glutes or core.',
  },
  'machine-chest-press': { weights: { chest: 1, triceps: 0.5, shoulders: 0.5 } },
  'push-ups': { weights: { chest: 1, triceps: 0.5, shoulders: 0.5, core: 0.25 } },
  'incline-machine-press': { weights: { chest: 1, shoulders: 0.5, triceps: 0.5 } },
  'machine-shoulder-press': { weights: { shoulders: 1, triceps: 0.5 } },
  'cable-lateral-raises': { weights: { shoulders: 1 } },
  'machine-lateral-raises': { weights: { shoulders: 1 } },
  'dumbbell-romanian-deadlift': { weights: { hamstrings: 1, glutes: 1, back: 0.5 } },
  'cable-pull-through': { weights: { glutes: 1, hamstrings: 0.75, back: 0.25 } },
  'assisted-pull-ups': { weights: { back: 1, biceps: 0.5 } },
  'single-arm-dumbbell-row': { weights: { back: 1, biceps: 0.5 } },
  'cable-rear-delt-fly': { weights: { shoulders: 1, back: 0.25 } },
  'cable-curls': { weights: { biceps: 1 } },
  'rope-hammer-curls': { weights: { biceps: 1 } },
  'captains-chair-knee-raises': { weights: { core: 1 } },
  'reverse-crunches': { weights: { core: 1 } },
  'machine-crunches': { weights: { core: 1 } },
  'band-pallof-press': { weights: { core: 1 } },
  'reverse-lunges': { weights: { quadriceps: 1, glutes: 0.75, hamstrings: 0.25, core: 0.25 } },
  'suitcase-carries': { excluded: true, reason: 'Loaded carries are grip-dominated; excluded from the radar by design.' },
  'supported-single-leg-balance': { excluded: true, reason: 'Balance holds are low-load; excluded so they do not inflate the radar.' },

  // ── Legacy IDs from earlier app versions (still present in old history) ─
  'dumbbell-bench-press': {
    weights: { chest: 1, triceps: 0.5, shoulders: 0.5 },
  },
  'seated-shoulder-press': {
    weights: { shoulders: 1, triceps: 0.5 },
  },
  'cable-fly': {
    weights: { chest: 1, shoulders: 0.25 },
  },
  'goblet-squat': {
    weights: { quadriceps: 1, glutes: 0.75, core: 0.25 },
  },
  'lat-pulldown': {
    weights: { back: 1, biceps: 0.5 },
  },
  'chest-supported-row': {
    weights: { back: 1, biceps: 0.5, shoulders: 0.25 },
  },
  'face-pull': {
    weights: { shoulders: 1, back: 0.5 },
    notes: 'Shoulders = rear delts; back = upper-back retractors.',
  },
  'dead-bug': {
    weights: { core: 1 },
  },
  'front-plank': {
    weights: { core: 1 },
  },
  'seated-calf-raise': {
    weights: { calves: 1 },
  },
}

export function getMuscleEntry(exerciseId: string): ExerciseMuscleEntry | undefined {
  return Object.hasOwn(exerciseMuscleMap, exerciseId) ? exerciseMuscleMap[exerciseId] : undefined
}
