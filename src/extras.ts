import type { MuscleId } from './muscleMap'

export type ExtraCategoryId = 'neck-traps' | 'forearms-grip' | 'calves-lower-legs' | 'posture-shoulders' | 'athletic-explosiveness' | 'mobility-flexibility'
export type ExtraUnitType = 'set' | 'hold' | 'interval' | 'round'
export type ExtraExercise = {
  id: string
  category: ExtraCategoryId
  name: string
  purpose: string
  instructions: string[]
  prescription: string
  units: number
  unitType: ExtraUnitType
  restSeconds: number
  difficulty: 'Beginner' | 'Beginner–Intermediate'
  equipment: string
  safety: string
  muscles: Partial<Record<MuscleId | 'neck' | 'traps' | 'forearms', number>>
}
export type ExtraWorkUnit = { id: string; completed: boolean; reps?: number; durationSeconds?: number }
export type ExtraSessionExercise = { exerciseId: string; units: ExtraWorkUnit[] }
export type ExtraSessionRecord = {
  id: string
  startedAt: number
  completedAt: number | null
  status: 'completed' | 'cancelled'
  category: ExtraCategoryId | 'mixed'
  exercises: ExtraSessionExercise[]
  xpEarned: number
  sessionBonusEarned: boolean
}

const stopNote = 'Stop if you feel pain, dizziness, headache, tingling or unusual symptoms. Keep the movement comfortable and controlled.'
const e = (id: string, category: ExtraCategoryId, name: string, purpose: string, instructions: string[], prescription: string, units: number, unitType: ExtraUnitType, restSeconds: number, equipment: string, safety: string, muscles: ExtraExercise['muscles'], difficulty: ExtraExercise['difficulty'] = 'Beginner'): ExtraExercise => ({ id, category, name, purpose, instructions, prescription, units, unitType, restSeconds, equipment, safety, muscles, difficulty })

export const extraCategories: { id: ExtraCategoryId; name: string; description: string; duration: string }[] = [
  { id: 'neck-traps', name: 'Neck & Traps', description: 'Gentle neck control and upper-trap strength.', duration: '8–12 MIN' },
  { id: 'forearms-grip', name: 'Forearms & Grip', description: 'Grip endurance and wrist strength.', duration: '10–15 MIN' },
  { id: 'calves-lower-legs', name: 'Calves & Lower Legs', description: 'Ankle strength and lower-leg capacity.', duration: '10–15 MIN' },
  { id: 'posture-shoulders', name: 'Posture & Shoulder Health', description: 'Scapular control and shoulder support.', duration: '10–15 MIN' },
  { id: 'athletic-explosiveness', name: 'Athletic Explosiveness', description: 'Low-volume coordination and power practice.', duration: '8–12 MIN' },
  { id: 'mobility-flexibility', name: 'Mobility & Flexibility', description: 'Comfortable range of motion and recovery-friendly movement.', duration: '8–12 MIN' },
]

export const extraExercises: ExtraExercise[] = [
  e('gentle-neck-flexion','neck-traps','Gentle neck flexion','Build gentle front-of-neck control.',['Sit tall with shoulders relaxed. Slowly nod the chin slightly toward the chest, then return to neutral.'], '2 × 8 slow reps',2,'set',45,'None','Use a small, pain-free range; no external load. '+stopNote,{neck:0.5}),
  e('gentle-neck-extension','neck-traps','Gentle neck extension','Practise controlled neck movement.',['Keep the torso still. Gently look slightly upward, then return to neutral without forcing the range.'], '2 × 8 slow reps',2,'set',45,'None','Do not drop the head backward or add resistance. '+stopNote,{neck:0.5}),
  e('gentle-lateral-neck-flexion','neck-traps','Gentle lateral neck flexion','Train controlled side-to-side neck movement.',['Keep shoulders level. Bring one ear slightly toward the same-side shoulder, return to centre, and alternate sides.'], '2 × 6 each side',2,'set',45,'None','Do not pull on the head or lift the shoulder. '+stopNote,{neck:0.5}),
  e('dumbbell-shrugs','neck-traps','Dumbbell shrugs','Train upper-trap strength.',['Hold light dumbbells by your sides. Raise shoulders straight up smoothly, pause briefly, then lower under control.'], '2 × 10–12 reps',2,'set',60,'Light dumbbells','Avoid rolling the shoulders or using momentum. '+stopNote,{traps:1}),
  e('wrist-curls','forearms-grip','Wrist curls','Train the wrist flexors.',['Rest forearms on thighs or a bench, palms up. Curl wrists through a comfortable range and lower slowly.'], '2 × 12–15 reps',2,'set',45,'Light dumbbell',stopNote,{forearms:1}),
  e('reverse-wrist-curls','forearms-grip','Reverse wrist curls','Train the wrist extensors.',['Support forearms with palms down. Lift the backs of the hands, then lower slowly.'], '2 × 12–15 reps',2,'set',45,'Light dumbbell',stopNote,{forearms:1}),
  e('dead-hangs','forearms-grip','Dead hangs','Practise grip endurance.',['Use a secure bar and a comfortable grip. Hang with shoulders gently engaged; step down before grip fails.'], '2 × 10–20 sec',2,'hold',60,'Pull-up bar','Use a stable step to get on and off; skip if hanging causes shoulder discomfort. '+stopNote,{forearms:0.5}),
  e('wrist-roller','forearms-grip','Wrist roller','Train forearm endurance.',['Use a light setting. Roll the handle steadily up and down without swinging the arms.'], '2 × 1 controlled roll',2,'round',60,'Wrist roller','Start very light and stop before form breaks. '+stopNote,{forearms:0.75}),
  e('standing-calf-raises','calves-lower-legs','Standing calf raises','Train the calf muscles through a controlled range.',['Stand tall near support. Rise onto the balls of your feet, pause, then lower with control.'], '2 × 12–15 reps',2,'set',45,'Bodyweight or light load',stopNote,{calves:1}),
  e('single-leg-calf-raises','calves-lower-legs','Single-leg calf raises','Build single-leg calf strength and control.',['Hold a support lightly. Rise and lower on one foot, then switch sides.'], '2 × 8–10 each side',2,'set',60,'Wall or rail',stopNote,{calves:1}),
  e('tibialis-raises','calves-lower-legs','Tibialis raises','Strengthen the muscles at the front of the lower leg.',['Lean against a wall with heels planted. Lift toes toward shins, then lower slowly.'], '2 × 12–15 reps',2,'set',45,'Wall',stopNote,{calves:0.5}),
  e('face-pulls','posture-shoulders','Face pulls','Train rear shoulders and upper-back control.',['Set cable or band around face height. Pull toward the face with elbows comfortably out, then return slowly.'], '2 × 12–15 reps',2,'set',45,'Cable or resistance band',stopNote,{shoulders:0.75,back:0.25}),
  e('cable-external-rotations','posture-shoulders','Cable external rotations','Build rotator-cuff control.',['Keep elbow tucked at your side. Rotate the forearm outward against very light resistance, then return slowly.'], '2 × 10 each side',2,'set',45,'Cable or band','Use very light resistance; keep elbow close to the body. '+stopNote,{shoulders:0.5}),
  e('wall-slides','posture-shoulders','Wall slides','Practise shoulder-blade movement and overhead control.',['Stand against a wall with forearms supported. Slide arms upward only as far as comfortable, then lower.'], '2 × 8–10 reps',2,'set',30,'Wall',stopNote,{shoulders:0.25}),
  e('band-pull-aparts','posture-shoulders','Band pull-aparts','Train upper-back and rear-shoulder endurance.',['Hold a light band at chest height. Separate hands while keeping shoulders relaxed, then return slowly.'], '2 × 12 reps',2,'set',40,'Light resistance band',stopNote,{shoulders:0.5,back:0.25}),
  e('box-jumps','athletic-explosiveness','Box jumps','Practise low-volume jumping and landing coordination.',['Choose a low, stable platform. Step back, jump with control, land softly with knees tracking over feet, then step down.'], '3 × 3 jumps',3,'interval',75,'Low stable box','Use a height you can land on quietly and confidently; step down, never jump down. Skip if unsure. '+stopNote,{quadriceps:0.25,glutes:0.25,calves:0.25}),
  e('agility-ladder','athletic-explosiveness','Agility ladder drills','Practise footwork rhythm and coordination.',['Use a simple walk-through pattern first. Keep steps light and controlled; increase speed only while coordination stays smooth.'], '3 × 20 sec',3,'interval',45,'Agility ladder or floor markers','Clear the floor and prioritise control over speed. '+stopNote,{calves:0.25}),
  e('medicine-ball-rotational-throws','athletic-explosiveness','Medicine ball rotational throws','Practise controlled rotational power.',['Use a light ball and a clear wall/partner target. Rotate through hips and torso smoothly, throw, reset, and alternate sides.'], '2 × 5 each side',2,'set',60,'Light medicine ball and safe wall','Use a light ball, clear space and a secure target. Avoid forcing spinal rotation. '+stopNote,{core:0.25}),
  e('jump-rope','athletic-explosiveness','Jump rope','Practise rhythmic low-impact footwork.',['Start with small relaxed hops and short intervals. Keep jumps low and land softly.'], '3 × 20 sec',3,'interval',45,'Jump rope','Use a clear, non-slip surface; substitute marching if jumping is uncomfortable. '+stopNote,{calves:0.25}),
  e('deep-squat-hold','mobility-flexibility','Deep squat hold','Explore comfortable ankle, hip and squat range.',['Hold a stable support if needed. Sit into a comfortable squat depth, breathe steadily, then stand.'], '2 × 20–30 sec',2,'hold',30,'Optional support','Do not force depth or push through pain. '+stopNote,{quadriceps:0.1,glutes:0.1}),
  e('couch-stretch','mobility-flexibility','Couch stretch','Gently stretch the front of the hip and thigh.',['Use padding and support. Set one knee near a wall or couch, keep torso tall, and ease into a mild stretch. Switch sides.'], '2 × 20 sec each side',2,'hold',20,'Wall or couch and padding','Keep the stretch mild; adjust position if the knee is uncomfortable. '+stopNote,{quadriceps:0.1}),
  e('thoracic-rotations','mobility-flexibility','Thoracic rotations','Practise comfortable upper-back rotation.',['On hands and knees or side-lying, rotate the upper back gently while keeping hips steady. Alternate sides.'], '2 × 6 each side',2,'set',20,'Mat',stopNote,{back:0.1}),
  e('cobra-stretch','mobility-flexibility','Cobra stretch','Gently explore front-body extension.',['Lie face down and press up only as far as comfortable, keeping hips grounded. Lower slowly.'], '2 × 15–20 sec',2,'hold',20,'Mat','Use a small range and avoid compressing the lower back. '+stopNote,{core:0.1}),
  e('ankle-mobility','mobility-flexibility','Ankle mobility drills','Practise ankle movement for squatting and walking.',['With heel grounded, move knee gently toward toes over the foot. Return and repeat, then switch sides.'], '2 × 8 each side',2,'set',20,'Wall optional',stopNote,{calves:0.1}),
]

export function getExtraExercise(id: string): ExtraExercise | undefined { return extraExercises.find((item) => item.id === id) }
export function getCategoryExercises(category: ExtraCategoryId): ExtraExercise[] { return extraExercises.filter((item) => item.category === category) }
export function createExtraSession(exerciseIds: string[], startedAt = Date.now()): ExtraSessionRecord {
  const selected = exerciseIds.map(getExtraExercise).filter((item): item is ExtraExercise => Boolean(item))
  if (selected.length === 0) throw new Error('Choose at least one exercise.')
  return { id: globalThis.crypto?.randomUUID?.() ?? `extra-${startedAt}-${Math.random().toString(36).slice(2)}`, startedAt, completedAt: null, status: 'cancelled', category: new Set(selected.map((item) => item.category)).size === 1 ? selected[0].category : 'mixed', exercises: selected.map((item) => ({ exerciseId: item.id, units: Array.from({ length: item.units }, (_, index) => ({ id: `${item.id}-${index}-${startedAt}`, completed: false })) })), xpEarned: 0, sessionBonusEarned: false }
}
export function completeExtraSession(session: ExtraSessionRecord, completedAt = Date.now()): ExtraSessionRecord {
  const valid = session.exercises.filter((exercise) => exercise.units.some((unit) => unit.completed))
  if (valid.length === 0) return { ...session, status: 'cancelled', completedAt: null, xpEarned: 0, sessionBonusEarned: false }
  const units = session.exercises.reduce((sum, exercise) => sum + exercise.units.filter((unit) => unit.completed).length, 0)
  const bonus = valid.length >= 2
  return { ...session, status: 'completed', completedAt, xpEarned: units * 10 + (bonus ? 15 : 0), sessionBonusEarned: bonus }
}
export function isExtraSessionRecord(value: unknown): value is ExtraSessionRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as ExtraSessionRecord
  const categoryValid = item.category === 'mixed' || extraCategories.some((category) => category.id === item.category)
  if (typeof item.id !== 'string' || item.id.length === 0 || !Number.isFinite(item.startedAt)
    || !(item.completedAt === null || Number.isFinite(item.completedAt))
    || (item.status !== 'completed' && item.status !== 'cancelled') || !categoryValid
    || !Array.isArray(item.exercises) || item.exercises.length === 0
    || !item.exercises.every((exercise) => typeof exercise.exerciseId === 'string' && Boolean(getExtraExercise(exercise.exerciseId))
      && Array.isArray(exercise.units) && exercise.units.length > 0 && exercise.units.length <= 20
      && exercise.units.every((unit) => typeof unit.id === 'string' && typeof unit.completed === 'boolean'))
    || new Set(item.exercises.map((exercise) => exercise.exerciseId)).size !== item.exercises.length
    || !Number.isInteger(item.xpEarned) || item.xpEarned < 0 || typeof item.sessionBonusEarned !== 'boolean') return false
  const completedUnits = item.exercises.reduce((sum, exercise) => sum + exercise.units.filter((unit) => unit.completed).length, 0)
  const completedExercises = item.exercises.filter((exercise) => exercise.units.some((unit) => unit.completed)).length
  const eligible = completedExercises >= 2
  if (item.status === 'cancelled') return item.completedAt === null && completedUnits === 0 && item.xpEarned === 0 && !item.sessionBonusEarned
  return item.completedAt !== null && completedUnits > 0 && item.xpEarned === completedUnits * 10 + (eligible ? 15 : 0) && item.sessionBonusEarned === eligible
}

export function getExtraRecommendation(history: { workoutId: string; completedAt: number }[], sessions: ExtraSessionRecord[]): { category: ExtraCategoryId; reason: string } {
  if (history.length === 0) return { category: 'mobility-flexibility', reason: 'A gentle, general mobility option is a sensible place to start.' }
  const latest = [...history].sort((a, b) => b.completedAt - a.completedAt)[0]
  const recentCategories = sessions.filter((session) => session.status === 'completed' && session.completedAt !== null && Date.now() - session.completedAt >= 0 && Date.now() - session.completedAt < 14 * 86400000).map((session) => session.category)
  const lastCompleted = new Map<ExtraCategoryId, number>()
  for (const session of sessions) if (session.status === 'completed' && session.completedAt !== null && session.category !== 'mixed') lastCompleted.set(session.category, Math.max(lastCompleted.get(session.category) ?? 0, session.completedAt))
  const preferred: ExtraCategoryId[] = latest.workoutId === 'push'
    ? ['forearms-grip', 'calves-lower-legs', 'mobility-flexibility', 'neck-traps', 'posture-shoulders', 'athletic-explosiveness']
    : latest.workoutId === 'pull'
      ? ['calves-lower-legs', 'mobility-flexibility', 'neck-traps', 'athletic-explosiveness', 'posture-shoulders', 'forearms-grip']
      : ['posture-shoulders', 'mobility-flexibility', 'forearms-grip', 'neck-traps', 'calves-lower-legs', 'athletic-explosiveness']
  const category = preferred.find((id) => !recentCategories.includes(id)) ?? [...preferred].sort((a, b) => (lastCompleted.get(a) ?? 0) - (lastCompleted.get(b) ?? 0))[0]
  const reasons: Record<ExtraCategoryId, string> = {
    'neck-traps': 'A light neck-and-trap option has not featured in your recent extra sessions.',
    'forearms-grip': 'Grip and forearm work is a useful complement to your recent training mix.',
    'calves-lower-legs': 'A short lower-leg session can add some focused calf and ankle work.',
    'posture-shoulders': 'A controlled shoulder-health session can complement your recent rotation.',
    'athletic-explosiveness': 'A small, low-volume coordination session is available if you feel fresh.',
    'mobility-flexibility': 'A gentle mobility option is available when you want something low intensity.',
  }
  return { category, reason: reasons[category] }
}
