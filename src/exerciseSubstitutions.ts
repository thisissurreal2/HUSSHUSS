import { getMuscleEntry, type MuscleId } from './muscleMap'
import { workouts, type Exercise } from './workouts'
import type { ActiveWorkout, WorkoutRecord } from './workoutStorage'

export type SubstitutionReason = 'equipment-unavailable' | 'machine-occupied' | 'uncomfortable' | 'variation' | 'pain'
export type MovementPattern = 'horizontal-push' | 'vertical-push' | 'shoulder-isolation' | 'elbow-extension' | 'squat' | 'hip-hinge' | 'vertical-pull' | 'horizontal-pull' | 'rear-delt-isolation' | 'elbow-flexion' | 'knee-flexion' | 'calf-raise' | 'trunk-flexion' | 'anti-rotation' | 'unilateral-squat' | 'carry' | 'balance' | 'anti-extension'
export type Equipment = 'barbell' | 'dumbbells' | 'cable' | 'machine' | 'bodyweight' | 'band' | 'open-space' | 'bench'
export type ExerciseType = 'compound' | 'isolation' | 'bodyweight' | 'timed' | 'unilateral'

export type ExerciseSubstitutionDefinition = {
  id: string
  name: string
  primaryMuscles: MuscleId[]
  secondaryMuscles: MuscleId[]
  equipment: Equipment[]
  pattern: MovementPattern
  type: ExerciseType
  targetReps: string
  targetSets?: number
  difficulty: string
  note?: string
}

export type SubstitutionCandidate = ExerciseSubstitutionDefinition & { score: number; reason: string }

const definitions: ExerciseSubstitutionDefinition[] = [
  { id: 'barbell-bench-press', name: 'Barbell Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: ['barbell', 'bench'], pattern: 'horizontal-push', type: 'compound', targetReps: '5–8', difficulty: 'Requires a stable bench setup; use safeties or a spotter where appropriate.' },
  { id: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: ['dumbbells', 'bench'], pattern: 'horizontal-push', type: 'compound', targetReps: '8–12', difficulty: 'Each arm stabilizes independently; choose a comfortable range.' },
  { id: 'machine-chest-press', name: 'Machine Chest Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders'], equipment: ['machine'], pattern: 'horizontal-push', type: 'compound', targetReps: '8–12', difficulty: 'Guided path; set the seat so handles begin comfortably.' },
  { id: 'push-ups', name: 'Push-ups', primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'shoulders', 'core'], equipment: ['bodyweight'], pattern: 'horizontal-push', type: 'compound', targetReps: '8–15', difficulty: 'Adjust difficulty with an incline or knee variation.' },
  { id: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], equipment: ['dumbbells', 'bench'], pattern: 'horizontal-push', type: 'compound', targetReps: '8–12', difficulty: 'Use a modest incline and controlled range.' },
  { id: 'incline-machine-press', name: 'Incline Machine Press', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], equipment: ['machine'], pattern: 'horizontal-push', type: 'compound', targetReps: '8–12', difficulty: 'Guided incline press; adjust seat and range.' },
  { id: 'overhead-shoulder-press', name: 'Overhead Shoulder Press', primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'], equipment: ['barbell'], pattern: 'vertical-push', type: 'compound', targetReps: '6–10', difficulty: 'Keep the range comfortable and avoid forcing the back to arch.' },
  { id: 'machine-shoulder-press', name: 'Machine Shoulder Press', primaryMuscles: ['shoulders'], secondaryMuscles: ['triceps'], equipment: ['machine'], pattern: 'vertical-push', type: 'compound', targetReps: '8–12', difficulty: 'Guided overhead path; choose a comfortable seat and range.' },
  { id: 'dumbbell-lateral-raises', name: 'Dumbbell Lateral Raises', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: ['dumbbells'], pattern: 'shoulder-isolation', type: 'isolation', targetReps: '12–15', difficulty: 'Use a light load and avoid swinging.' },
  { id: 'cable-lateral-raises', name: 'Cable Lateral Raises', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: ['cable'], pattern: 'shoulder-isolation', type: 'isolation', targetReps: '12–15', difficulty: 'Keep the load light and motion smooth.' },
  { id: 'machine-lateral-raises', name: 'Machine Lateral Raises', primaryMuscles: ['shoulders'], secondaryMuscles: [], equipment: ['machine'], pattern: 'shoulder-isolation', type: 'isolation', targetReps: '12–15', difficulty: 'Set pads comfortably and avoid shrugging.' },
  { id: 'cable-tricep-pushdowns', name: 'Cable Tricep Pushdowns', primaryMuscles: ['triceps'], secondaryMuscles: [], equipment: ['cable'], pattern: 'elbow-extension', type: 'isolation', targetReps: '10–15', difficulty: 'Keep upper arms comfortably near your sides.' },
  { id: 'overhead-cable-tricep-extensions', name: 'Overhead Cable Tricep Extensions', primaryMuscles: ['triceps'], secondaryMuscles: [], equipment: ['cable'], pattern: 'elbow-extension', type: 'isolation', targetReps: '10–12', difficulty: 'Use a comfortable shoulder position.' },
  { id: 'leg-press', name: 'Leg Press', primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings'], equipment: ['machine'], pattern: 'squat', type: 'compound', targetReps: '8–12', difficulty: 'Use a comfortable depth; do not lock the knees.' },
  { id: 'goblet-squat', name: 'Goblet Squat', primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'core'], equipment: ['dumbbells'], pattern: 'squat', type: 'compound', targetReps: '8–12', difficulty: 'Hold one dumbbell close and use a comfortable depth.' },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift (RDL)', primaryMuscles: ['hamstrings', 'glutes'], secondaryMuscles: ['back'], equipment: ['barbell'], pattern: 'hip-hinge', type: 'compound', targetReps: '8–10', difficulty: 'Keep the weight close and stop before control or form changes.' },
  { id: 'dumbbell-romanian-deadlift', name: 'Dumbbell Romanian Deadlift', primaryMuscles: ['hamstrings', 'glutes'], secondaryMuscles: ['back'], equipment: ['dumbbells'], pattern: 'hip-hinge', type: 'compound', targetReps: '8–10', difficulty: 'Use a light start and the same controlled hinge pattern.' },
  { id: 'cable-pull-through', name: 'Cable Pull-Through', primaryMuscles: ['glutes', 'hamstrings'], secondaryMuscles: ['back'], equipment: ['cable'], pattern: 'hip-hinge', type: 'compound', targetReps: '10–12', difficulty: 'Practise the hinge with a light cable load.' },
  { id: 'pull-ups', name: 'Pull-ups', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: ['bodyweight'], pattern: 'vertical-pull', type: 'bodyweight', targetReps: '5–10', difficulty: 'Use a comfortable grip; assistance is a valid scaling option.' },
  { id: 'lat-pulldown', name: 'Lat Pulldown', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: ['machine'], pattern: 'vertical-pull', type: 'compound', targetReps: '8–12', difficulty: 'Choose assistance/load that allows a controlled pull.' },
  { id: 'assisted-pull-ups', name: 'Assisted Pull-ups', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: ['machine'], pattern: 'vertical-pull', type: 'compound', targetReps: '5–10', difficulty: 'Adjust assistance to maintain controlled reps.' },
  { id: 'chest-supported-rows', name: 'Chest-Supported Rows', primaryMuscles: ['back'], secondaryMuscles: ['biceps', 'shoulders'], equipment: ['machine', 'bench'], pattern: 'horizontal-pull', type: 'compound', targetReps: '8–12', difficulty: 'Keep the chest supported and avoid shrugging.' },
  { id: 'single-arm-dumbbell-row', name: 'Single-Arm Dumbbell Row', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: ['dumbbells', 'bench'], pattern: 'horizontal-pull', type: 'unilateral', targetReps: '10–12 per side', difficulty: 'Support yourself and keep the torso steady.' },
  { id: 'single-arm-cable-rows', name: 'Single-Arm Cable Rows', primaryMuscles: ['back'], secondaryMuscles: ['biceps'], equipment: ['cable'], pattern: 'horizontal-pull', type: 'unilateral', targetReps: '10–12', difficulty: 'Resist torso rotation.' },
  { id: 'reverse-pec-deck', name: 'Reverse Pec Deck', primaryMuscles: ['shoulders'], secondaryMuscles: ['back'], equipment: ['machine'], pattern: 'rear-delt-isolation', type: 'isolation', targetReps: '12–15', difficulty: 'Use a light load with a smooth sweep.' },
  { id: 'cable-rear-delt-fly', name: 'Cable Rear-Delt Fly', primaryMuscles: ['shoulders'], secondaryMuscles: ['back'], equipment: ['cable'], pattern: 'rear-delt-isolation', type: 'isolation', targetReps: '12–15', difficulty: 'Keep the load light and avoid turning it into a row.' },
  { id: 'preacher-curls', name: 'Preacher Curls', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: ['machine'], pattern: 'elbow-flexion', type: 'isolation', targetReps: '8–12', difficulty: 'Keep the upper arm supported and lower with control.' },
  { id: 'cable-curls', name: 'Cable Curls', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: ['cable'], pattern: 'elbow-flexion', type: 'isolation', targetReps: '10–12', difficulty: 'Keep elbows steady and use a comfortable range.' },
  { id: 'hammer-curls', name: 'Hammer Curls', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: ['dumbbells'], pattern: 'elbow-flexion', type: 'isolation', targetReps: '10–12', difficulty: 'Keep palms facing inward and avoid momentum.' },
  { id: 'rope-hammer-curls', name: 'Rope Hammer Curls', primaryMuscles: ['biceps'], secondaryMuscles: [], equipment: ['cable'], pattern: 'elbow-flexion', type: 'isolation', targetReps: '10–12', difficulty: 'Keep a neutral grip and elbows steady.' },
  { id: 'hanging-knee-raises', name: 'Hanging Knee Raises', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['bodyweight'], pattern: 'trunk-flexion', type: 'bodyweight', targetReps: '10–15', difficulty: 'Avoid swinging; a captain’s chair can reduce grip demand.' },
  { id: 'captains-chair-knee-raises', name: 'Captain’s Chair Knee Raises', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['machine'], pattern: 'trunk-flexion', type: 'bodyweight', targetReps: '10–15', difficulty: 'Back support reduces hanging and grip demands.' },
  { id: 'reverse-crunches', name: 'Reverse Crunches', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['bodyweight', 'bench'], pattern: 'trunk-flexion', type: 'bodyweight', targetReps: '10–15', difficulty: 'Use a controlled pelvic curl without swinging.' },
  { id: 'cable-crunches', name: 'Cable Crunches', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['cable'], pattern: 'trunk-flexion', type: 'isolation', targetReps: '12–15', difficulty: 'Use a controlled trunk curl; do not pull on the neck.' },
  { id: 'machine-crunches', name: 'Machine Crunches', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['machine'], pattern: 'trunk-flexion', type: 'isolation', targetReps: '12–15', difficulty: 'Adjust the seat and use a comfortable controlled range.' },
  { id: 'pallof-press', name: 'Pallof Press', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['cable'], pattern: 'anti-rotation', type: 'unilateral', targetReps: '10 per side', difficulty: 'Keep hips and shoulders facing forward.' },
  { id: 'band-pallof-press', name: 'Band Pallof Press', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['band'], pattern: 'anti-rotation', type: 'unilateral', targetReps: '10 per side', difficulty: 'Anchor the band securely and resist rotation.' },
  { id: 'bulgarian-split-squats', name: 'Bulgarian Split Squats', primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings', 'core'], equipment: ['bench', 'bodyweight'], pattern: 'unilateral-squat', type: 'unilateral', targetReps: '8 per leg', difficulty: 'Use support and a comfortable stance.' },
  { id: 'reverse-lunges', name: 'Reverse Lunges', primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'hamstrings', 'core'], equipment: ['bodyweight'], pattern: 'unilateral-squat', type: 'unilateral', targetReps: '8 per leg', difficulty: 'Step back to a stable, comfortable range.' },
  { id: 'farmer-carries', name: 'Farmer Carries', primaryMuscles: [], secondaryMuscles: [], equipment: ['dumbbells', 'open-space'], pattern: 'carry', type: 'timed', targetReps: '30–40 seconds', difficulty: 'Walk with steady steps; grip and load affect difficulty.' },
  { id: 'suitcase-carries', name: 'Suitcase Carries', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['dumbbells', 'open-space'], pattern: 'carry', type: 'unilateral', targetReps: '30–40 seconds per side', difficulty: 'Unilateral carry adds anti-tilt demand; alternate sides.' },
  { id: 'single-leg-balance', name: 'Single-Leg Balance', primaryMuscles: [], secondaryMuscles: [], equipment: ['bodyweight', 'open-space'], pattern: 'balance', type: 'unilateral', targetReps: '30 seconds per side', difficulty: 'Stand near support and use a clear floor.' },
  { id: 'supported-single-leg-balance', name: 'Supported Single-Leg Balance', primaryMuscles: [], secondaryMuscles: [], equipment: ['bodyweight', 'open-space'], pattern: 'balance', type: 'unilateral', targetReps: '30 seconds per side', difficulty: 'Use fingertip support as needed.' },
  { id: 'plank', name: 'Plank', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['bodyweight'], pattern: 'anti-extension', type: 'timed', targetReps: '45–60 seconds', difficulty: 'Stop the hold when you can no longer maintain a comfortable position.' },
  { id: 'dead-bug', name: 'Dead Bug', primaryMuscles: ['core'], secondaryMuscles: [], equipment: ['bodyweight'], pattern: 'anti-extension', type: 'bodyweight', targetReps: '8–12 per side', difficulty: 'Use a slow range while keeping the trunk controlled.' },
  { id: 'standing-cable-leg-curls', name: 'Standing Cable Leg Curls', primaryMuscles: ['hamstrings'], secondaryMuscles: [], equipment: ['cable'], pattern: 'knee-flexion', type: 'isolation', targetReps: '10–15', difficulty: 'Use an ankle cuff, steady support, and a controlled range.' },
  { id: 'band-leg-curls', name: 'Standing Band Leg Curls', primaryMuscles: ['hamstrings'], secondaryMuscles: [], equipment: ['band'], pattern: 'knee-flexion', type: 'isolation', targetReps: '10–15', difficulty: 'Anchor the band securely and keep the movement controlled.' },
  { id: 'standing-calf-raises', name: 'Standing Calf Raises', primaryMuscles: ['calves'], secondaryMuscles: [], equipment: ['machine', 'bodyweight'], pattern: 'calf-raise', type: 'isolation', targetReps: '12–15', difficulty: 'Use a support if needed and move through a comfortable range.' },
  { id: 'single-leg-calf-raises', name: 'Single-Leg Calf Raises', primaryMuscles: ['calves'], secondaryMuscles: [], equipment: ['bodyweight', 'open-space'], pattern: 'calf-raise', type: 'unilateral', targetReps: '8–10 per leg', difficulty: 'Hold a stable support and switch legs with control.' },
]

export const exerciseSubstitutionCatalogue = definitions
export const equipmentChoices: { id: Equipment; label: string }[] = [
  { id: 'barbell', label: 'Barbell' }, { id: 'dumbbells', label: 'Dumbbells' }, { id: 'cable', label: 'Cable' },
  { id: 'machine', label: 'Machine' }, { id: 'bodyweight', label: 'Bodyweight' }, { id: 'band', label: 'Band' },
  { id: 'open-space', label: 'Open space' }, { id: 'bench', label: 'Bench' },
]

const byId = new Map(definitions.map((definition) => [definition.id, definition]))
const originalExerciseIds = new Set(workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.id)))

export function getSubstitutionDefinition(exerciseId: string): ExerciseSubstitutionDefinition | undefined {
  return byId.get(exerciseId)
}

export function getExerciseMeasurementProfile(exercise: Exercise | ExerciseSubstitutionDefinition): ExerciseSubstitutionDefinition | undefined {
  return byId.get(exercise.id)
}

function overlap(left: MuscleId[], right: MuscleId[]): number {
  if (!left.length || !right.length) return 0
  return left.filter((item) => right.includes(item)).length / Math.max(left.length, right.length)
}

function musclesFor(exercise: ExerciseSubstitutionDefinition): MuscleId[] {
  return [...exercise.primaryMuscles, ...exercise.secondaryMuscles]
}

export function getSubstitutionCandidates(
  exerciseId: string,
  reason: SubstitutionReason,
  unavailableEquipment: Equipment[] = [],
  preferredId?: string,
): SubstitutionCandidate[] {
  const source = byId.get(exerciseId)
  if (!source) return []
  const excluded = new Set<Equipment>([
    ...unavailableEquipment,
    ...(reason === 'machine-occupied' ? ['machine' as const] : []),
  ])
  return definitions.filter((candidate) => candidate.id !== exerciseId
    && candidate.pattern === source.pattern
    && (originalExerciseIds.has(candidate.id) || byId.has(candidate.id))
    && !candidate.equipment.some((item) => excluded.has(item)))
    .map((candidate) => {
      let score = 0
      const samePattern = candidate.pattern === source.pattern
      score += samePattern ? 6 : 0
      score += overlap(source.primaryMuscles, candidate.primaryMuscles) * 4
      score += overlap(musclesFor(source), musclesFor(candidate)) * 2
      if (candidate.type === source.type) score += 1.25
      if ((source.type === 'unilateral') === (candidate.type === 'unilateral')) score += 0.75
      if (reason === 'equipment-unavailable' || reason === 'machine-occupied') score += candidate.equipment.some((item) => !source.equipment.includes(item)) ? 0.5 : 0
      if (reason === 'uncomfortable' || reason === 'pain') score += candidate.id === 'captains-chair-knee-raises' && exerciseId === 'hanging-knee-raises' ? 1 : 0
      if (candidate.id === preferredId) score += 0.4
      const primaryPreserved = overlap(source.primaryMuscles, candidate.primaryMuscles) > 0
      const reasonText = samePattern && primaryPreserved
        ? 'Matches the same movement pattern and primary muscle focus.'
        : primaryPreserved
          ? 'Keeps the primary muscle focus with a different movement pattern.'
          : 'A broader alternative; check that it fits today’s training goal.'
      return { ...candidate, score, reason: reasonText }
    })
    .filter((candidate) => candidate.score >= 2.5)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export function validateSubstitutionForExercise(sourceId: string, candidateId: string): boolean {
  return sourceId !== candidateId && Boolean(byId.has(sourceId) && byId.has(candidateId)
    && getSubstitutionCandidates(sourceId, 'variation').some((candidate) => candidate.id === candidateId))
}

export function applySessionSubstitution(
  active: ActiveWorkout,
  index: number,
  candidateId: string,
  reason: SubstitutionReason,
  history: WorkoutRecord[],
): ActiveWorkout {
  const currentTemplateExercise = active.template.exercises[index]
  const candidate = byId.get(candidateId)
  const currentState = active.exercises[index]
  if (!currentTemplateExercise || !currentState || !candidate
    || !validateSubstitutionForExercise(currentState.substitution?.originalExerciseId ?? currentTemplateExercise.id, candidateId)) {
    throw new Error('That exercise is not a suitable replacement for this session.')
  }
  const originalExerciseId = currentState.substitution?.originalExerciseId ?? currentTemplateExercise.id
  const previous = history
    .filter((record) => record.exercises.some((exercise) => exercise.exerciseId === candidate.id && exercise.completed))
    .sort((a, b) => b.completedAt - a.completedAt)[0]
    ?.exercises.find((exercise) => exercise.exerciseId === candidate.id)
  const templateExercise: Exercise = {
    id: candidate.id,
    name: candidate.name,
    focus: [candidate.primaryMuscles[0], ...candidate.secondaryMuscles].filter(Boolean).join(' · ') || 'Movement',
    instructions: candidate.difficulty,
    targetSets: currentTemplateExercise.targetSets,
    targetReps: candidate.targetReps,
    ...(candidate.primaryMuscles.includes('quadriceps') || candidate.primaryMuscles.includes('hamstrings') ? { isLowerBody: true } : {}),
  }
  const sets = Array.from({ length: templateExercise.targetSets }, (_, setIndex) => {
    const last = previous?.sets.filter((set) => set.completed && set.reps !== null)[setIndex]
    return {
      id: `${active.id}-${candidate.id}-${setIndex}-${Math.random().toString(36).slice(2, 8)}`,
      weightKg: last?.weightKg == null ? '' : String(last.weightKg),
      reps: last?.reps == null ? '' : String(last.reps),
      completed: false,
      ...(last?.leftReps != null ? { leftReps: String(last.leftReps) } : {}),
      ...(last?.rightReps != null ? { rightReps: String(last.rightReps) } : {}),
    }
  })
  return {
    ...active,
    template: { ...active.template, exercises: active.template.exercises.map((exercise, itemIndex) => itemIndex === index ? templateExercise : exercise) },
    exercises: active.exercises.map((exercise, itemIndex) => itemIndex === index
      ? { exerciseId: candidate.id, completed: false, sets, substitution: { originalExerciseId, reason } }
      : exercise),
  }
}

export function getSubstitutionFromProgramme(exercise: Exercise): ExerciseSubstitutionDefinition | undefined {
  return byId.get(exercise.id)
}

export function getMuscleNames(definition: ExerciseSubstitutionDefinition): { primary: string[]; secondary: string[] } {
  const labels = new Map<MuscleId, string>([
    ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['biceps', 'Biceps'], ['triceps', 'Triceps'],
    ['core', 'Core'], ['quadriceps', 'Quads'], ['hamstrings', 'Hamstrings'], ['glutes', 'Glutes'], ['calves', 'Calves'],
  ])
  return {
    primary: definition.primaryMuscles.map((muscle) => labels.get(muscle) ?? muscle),
    secondary: definition.secondaryMuscles.map((muscle) => labels.get(muscle) ?? muscle),
  }
}

export function catalogueMatchesMuscleMap(): boolean {
  return definitions.filter((item) => originalExerciseIds.has(item.id)).every((item) => {
    const mapped = getMuscleEntry(item.id)
    if (!mapped || 'excluded' in mapped && mapped.excluded) return item.primaryMuscles.length === 0
    return item.primaryMuscles.every((muscle) => (mapped.weights[muscle] ?? 0) >= 0.75)
  })
}
