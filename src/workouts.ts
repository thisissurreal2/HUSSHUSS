export type WorkoutId = 'push' | 'pull' | 'core' | 'arnold-chest-back' | 'arnold-shoulders-arms'

export type Exercise = {
  id: string
  name: string
  focus: string
  instructions: string
  targetSets: number
  targetReps: string
  isLowerBody?: boolean
}

export type ChecklistItem = {
  id: string
  name: string
  instructions: string
}

export type Workout = {
  id: WorkoutId
  name: string
  focus: string
  description: string
  duration: string
  warmup: ChecklistItem[]
  exercises: Exercise[]
  cooldown: ChecklistItem[]
}

export const workouts: Workout[] = [
  {
    id: 'push',
    name: 'Push',
    focus: 'Chest · shoulders · triceps',
    description: 'A measured chest, shoulder and triceps session.',
    duration: '40–50 min',
    warmup: [
      { id: 'light-cardio', name: 'Light cycling or treadmill · 3–5 min', instructions: 'Move at an easy pace to raise your temperature without tiring yourself.' },
      { id: 'arm-circles', name: 'Arm circles · 15 each direction', instructions: 'Make smooth, comfortable circles, gradually widening the range.' },
      { id: 'band-pull-aparts', name: 'Band pull-aparts · 15 reps', instructions: 'Keep the band light and draw it apart with relaxed shoulders.' },
      { id: 'scapular-push-ups', name: 'Scapular push-ups · 10 reps', instructions: 'Keep your elbows straight and gently move your shoulder blades together and apart.' },
      { id: 'bench-warmup-sets', name: 'Bench press warm-up · 1–2 ramp-up sets', instructions: 'Start very light and add a little weight each set. These do not count as working sets.' },
    ],
    exercises: [
      {
        id: 'incline-smith-machine-bench-press',
        name: 'Incline Smith Machine Bench Press',
        focus: 'Chest',
        instructions: 'Set the Smith bench to a comfortable incline. Lower the bar under control and use the machine safeties as appropriate.',
        targetSets: 3,
        targetReps: '6–10',
      },
      {
        id: 'pec-deck',
        name: 'Pec Deck',
        focus: 'Chest',
        instructions: 'Set the seat so the handles align comfortably with your chest. Bring the arms together under control.',
        targetSets: 3,
        targetReps: '10–15',
      },
      {
        id: 'machine-chest-press',
        name: 'Machine Chest Press',
        focus: 'Chest',
        instructions: 'Set the seat so the handles begin comfortably around mid-chest. Press smoothly without forcing the range.',
        targetSets: 3,
        targetReps: '8–12',
      },
      {
        id: 'machine-shoulder-press',
        name: 'Machine Shoulder Press',
        focus: 'Shoulders',
        instructions: 'Set the seat so the handles start around shoulder height. Press smoothly through a comfortable range without forcing your back to arch.',
        targetSets: 3,
        targetReps: '8–12',
      },
      {
        id: 'dumbbell-lateral-raises',
        name: 'Dumbbell Lateral Raises',
        focus: 'Side shoulders',
        instructions: 'Use a light load, lift smoothly to a comfortable height, and avoid swinging.',
        targetSets: 3,
        targetReps: '12–20',
      },
      {
        id: 'single-arm-cable-tricep-pushdowns',
        name: 'Single-Arm Cable Tricep Pushdowns',
        focus: 'Triceps',
        instructions: 'Use one handle and keep your elbow comfortably near your side. Complete each arm with control.',
        targetSets: 3,
        targetReps: '10–15 per arm',
      },
      {
        id: 'overhead-cable-tricep-extensions',
        name: 'Overhead Cable Tricep Extensions',
        focus: 'Triceps',
        instructions: 'Choose a comfortable shoulder position and extend smoothly without forcing the stretch.',
        targetSets: 2,
        targetReps: '10–15',
      },
    ],
    cooldown: [
      { id: 'doorway-chest-stretch', name: 'Doorway chest stretch · 30 sec per side', instructions: 'Rest your forearm on a doorframe and turn gently away until you feel a mild chest stretch.' },
      { id: 'overhead-triceps-stretch', name: 'Overhead triceps stretch · 30 sec per side', instructions: 'Raise one arm and bend the elbow; use the other hand lightly. Keep the stretch gentle and pain-free.' },
      { id: 'cross-body-shoulder-stretch', name: 'Cross-body shoulder stretch · 30 sec per side', instructions: 'Bring one arm across your chest and support it gently. Do not pull into pain.' },
    ],
  },
  {
    id: 'pull',
    name: 'Pull',
    focus: 'Back · rear shoulders · biceps',
    description: 'Build your back with a steady, controlled pull.',
    duration: '40–50 min',
    warmup: [
      { id: 'light-cardio', name: 'Light cycling or treadmill · 3–5 min', instructions: 'Move at an easy pace to warm up without tiring yourself.' },
      { id: 'arm-swings', name: 'Arm swings · 15 reps', instructions: 'Swing gently through a comfortable range, keeping the movement relaxed.' },
      { id: 'band-pull-aparts', name: 'Band pull-aparts · 15 reps', instructions: 'Use light tension and draw the band apart with control.' },
      { id: 'scapular-pull-ups', name: 'Scapular pull-ups · 8 reps', instructions: 'Hang only if comfortable; keep elbows straight and move your shoulder blades gently.' },
      { id: 'pull-up-warmup-sets', name: 'Pull-up warm-up · 1–2 ramp-up sets', instructions: 'Begin with comfortable bodyweight or assistance and practise a controlled pull. Warm-up sets do not count as working sets.' },
    ],
    exercises: [
      {
        id: 'pull-ups',
        name: 'Weighted Pull-Ups',
        focus: 'Back',
        instructions: 'Use a comfortable grip and controlled range. Log any added external load in the weight field; leave it blank for bodyweight-only reps. Avoid swinging.',
        targetSets: 3,
        targetReps: '5–8',
      },
      {
        id: 'seated-cable-row',
        name: 'Seated Cable Row',
        focus: 'Back',
        instructions: 'Sit tall, brace gently, and draw the handle toward your lower ribs without rocking your torso.',
        targetSets: 3,
        targetReps: '8–12',
      },
      {
        id: 'chest-supported-rows',
        name: 'Chest-Supported Row',
        focus: 'Back',
        instructions: 'Keep your chest supported and draw your elbows back smoothly without shrugging.',
        targetSets: 3,
        targetReps: '8–12',
      },
      {
        id: 'incline-dumbbell-curls',
        name: 'Incline Dumbbell Curls',
        focus: 'Biceps',
        instructions: 'Set a modest bench incline, let the arms hang comfortably, and curl without swinging.',
        targetSets: 3,
        targetReps: '8–12',
      },
      {
        id: 'hammer-curls',
        name: 'Hammer Curls',
        focus: 'Biceps · forearms',
        instructions: 'Keep palms facing inward and elbows close to your sides. Avoid using momentum.',
        targetSets: 3,
        targetReps: '10–15',
      },
      {
        id: 'reverse-pec-deck',
        name: 'Reverse Pec Deck',
        focus: 'Rear shoulders',
        instructions: 'Set the seat so handles are around shoulder height. Sweep your arms back with a light, controlled load.',
        targetSets: 2,
        targetReps: '12–15',
      },
    ],
    cooldown: [
      { id: 'childs-pose', name: 'Child’s pose · 30–45 sec', instructions: 'Sit hips toward heels and reach forward only as far as comfortable. Breathe easily.' },
      { id: 'lat-stretch', name: 'Lat stretch · 30 sec per side', instructions: 'Reach one arm overhead and lean gently to the other side without forcing your shoulder.' },
      { id: 'forearm-stretch', name: 'Forearm stretch · 30 sec per side', instructions: 'Extend an arm and gently move the wrist until you feel a mild forearm stretch.' },
      { id: 'upper-back-stretch', name: 'Gentle upper-back stretch · 30 sec', instructions: 'Reach forward and let the shoulder blades spread gently; keep your neck relaxed.' },
    ],
  },
  {
    id: 'core',
    name: 'Core & Legs',
    focus: 'Core · legs · loaded carries',
    description: 'Abs first, followed by focused leg strength and athletic practice.',
    duration: '40–50 min',
    warmup: [
      { id: 'light-cardio', name: 'Light cycling or treadmill · 3–5 min', instructions: 'Choose an easy pace that warms you up without tiring your legs.' },
      { id: 'leg-swings', name: 'Leg swings · 10 per leg', instructions: 'Hold support and swing each leg gently through a comfortable range.' },
      { id: 'walking-lunges', name: 'Walking lunges · 10 steps', instructions: 'Take controlled steps with a comfortable depth; use support or shorten the stride if needed.' },
      { id: 'worlds-greatest-stretch', name: 'World’s Greatest Stretch · 5 per side', instructions: 'Step into a comfortable lunge, rotate gently, and use your hand for support as needed.' },
      { id: 'bodyweight-squats', name: 'Bodyweight squats · 15 reps', instructions: 'Use a comfortable depth and steady pace, keeping your feet grounded.' },
      { id: 'light-practice-sets', name: 'Light practice sets', instructions: 'Rehearse demanding movements with an easy load or bodyweight. These do not count as working sets.' },
    ],
    exercises: [
      {
        id: 'hanging-knee-raises',
        name: 'Hanging Knee Raises',
        focus: 'Core',
        instructions: 'Use a secure, comfortable hang. Raise and lower your knees without swinging; use a captain’s chair if preferred.',
        targetSets: 3,
        targetReps: '10–15',
      },
      {
        id: 'cable-crunches',
        name: 'Cable Crunches',
        focus: 'Core',
        instructions: 'Kneel comfortably and curl your ribs toward your pelvis without pulling on your neck.',
        targetSets: 3,
        targetReps: '12–15',
      },
      {
        id: 'pallof-press',
        name: 'Pallof Press',
        focus: 'Core stability',
        instructions: 'Stand tall, press the handle away from your chest, and resist rotation. Complete the target on each side.',
        targetSets: 2,
        targetReps: '10 per side',
      },
      {
        id: 'plank',
        name: 'Plank',
        focus: 'Core endurance',
        instructions: 'Keep a comfortable straight line and breathe steadily. Stop the hold if your position or comfort changes.',
        targetSets: 2,
        targetReps: '45–60 seconds',
      },
      {
        id: 'romanian-deadlift',
        name: 'Romanian Deadlift',
        focus: 'Hamstrings · glutes',
        instructions: 'Start with a light weight. Hinge at your hips with a soft knee bend, keep the weight close and spine neutral, and lower only as far as control allows. Stop before form breaks; do not train this lift to failure.',
        targetSets: 3,
        targetReps: '8–10',
        isLowerBody: true,
      },
      {
        id: 'leg-press',
        name: 'Leg Press',
        focus: 'Quads',
        instructions: 'Use a comfortable depth and keep your hips supported against the pad. Do not lock your knees.',
        targetSets: 3,
        targetReps: '8–12',
        isLowerBody: true,
      },
      {
        id: 'bulgarian-split-squats',
        name: 'Bulgarian Split Squats',
        focus: 'Quads · glutes',
        instructions: 'Use a stable support if helpful. Keep the range and stance comfortable and complete each leg with control.',
        targetSets: 2,
        targetReps: '8–10 per leg',
        isLowerBody: true,
      },
      {
        id: 'farmer-carries',
        name: 'Farmer Carries',
        focus: 'Grip · trunk · loaded carry',
        instructions: 'Carry manageable weights with steady steps, relaxed shoulders, and an upright posture. Record the hold duration for each set.',
        targetSets: 3,
        targetReps: '30–40 seconds',
      },
      {
        id: 'single-leg-balance',
        name: 'Single-Leg Balance',
        focus: 'Balance',
        instructions: 'Stand near support on a clear floor. Balance comfortably, switch sides, and record each side separately.',
        targetSets: 2,
        targetReps: '30 seconds per side',
      },
    ],
    cooldown: [
      { id: 'cobra-stretch', name: 'Cobra stretch · 20–30 sec', instructions: 'Lie face down and gently lift your chest only as far as comfortable; keep the hips relaxed.' },
      { id: 'hip-flexor-stretch', name: 'Hip flexor stretch · 30 sec per side', instructions: 'Use a supported half-kneeling position and gently shift forward until the front of the hip feels mild tension.' },
      { id: 'hamstring-stretch', name: 'Hamstring stretch · 30 sec per side', instructions: 'Extend one leg and hinge gently at the hips until you feel a mild stretch; keep the back comfortable.' },
      { id: 'figure-four-glute-stretch', name: 'Figure-four glute stretch · 30 sec per side', instructions: 'Cross one ankle over the other thigh and draw in gently, stopping well before pain.' },
      { id: 'calf-stretch', name: 'Calf stretch · 30 sec per side', instructions: 'With hands supported on a wall, step one foot back and gently press the heel toward the floor.' },
    ],
  },
  {
    id: 'arnold-chest-back',
    name: 'Arnold — Chest & Back',
    focus: 'Chest · back',
    description: 'A paired chest and back session with a steady, controlled pace.',
    duration: '40–50 min',
    warmup: [
      { id: 'light-cardio', name: 'Light cycling or treadmill · 3–5 min', instructions: 'Move at an easy pace to warm up without tiring yourself.' },
      { id: 'arm-circles', name: 'Arm circles · 15 each direction', instructions: 'Make smooth, comfortable circles, gradually widening the range.' },
      { id: 'bench-warmup-sets', name: 'Bench press warm-up · 1–2 ramp-up sets', instructions: 'Start very light and add a little weight each set. These do not count as working sets.' },
    ],
    exercises: [
      { id: 'barbell-bench-press', name: 'Barbell Bench Press', focus: 'Chest', instructions: 'Keep your feet planted and wrists steady. Lower the bar under control; use safeties or a spotter where appropriate.', targetSets: 3, targetReps: '6–10' },
      { id: 'lat-pulldown', name: 'Lat Pulldown', focus: 'Back', instructions: 'Set the thigh pad securely and pull the bar toward your upper chest with control.', targetSets: 3, targetReps: '8–12' },
      { id: 'incline-dumbbell-press', name: 'Incline Dumbbell Press', focus: 'Chest', instructions: 'Set the bench to a modest incline. Lower the dumbbells with control through a comfortable range.', targetSets: 2, targetReps: '8–12' },
      { id: 'standing-t-bar-row', name: 'Standing T-Bar Row', focus: 'Back', instructions: 'Stand in a stable stance, hinge comfortably, and row the handle toward your torso without jerking.', targetSets: 3, targetReps: '8–12' },
      { id: 'pec-deck', name: 'Pec Deck', focus: 'Chest', instructions: 'Align the handles comfortably with your chest and bring the arms together under control.', targetSets: 2, targetReps: '12–15' },
    ],
    cooldown: [
      { id: 'doorway-chest-stretch', name: 'Doorway chest stretch · 30 sec per side', instructions: 'Rest your forearm on a doorframe and turn gently away until you feel a mild chest stretch.' },
      { id: 'lat-stretch', name: 'Lat stretch · 30 sec per side', instructions: 'Reach one arm overhead and lean gently to the other side without forcing your shoulder.' },
    ],
  },
  {
    id: 'arnold-shoulders-arms',
    name: 'Arnold — Shoulders & Arms',
    focus: 'Shoulders · biceps · triceps',
    description: 'Focused shoulder and arm work with controlled isolation movements.',
    duration: '35–45 min',
    warmup: [
      { id: 'light-cardio', name: 'Light cycling or treadmill · 3–5 min', instructions: 'Move at an easy pace to warm up without tiring yourself.' },
      { id: 'arm-circles', name: 'Arm circles · 15 each direction', instructions: 'Make smooth, comfortable circles, gradually widening the range.' },
      { id: 'band-pull-aparts', name: 'Band pull-aparts · 15 reps', instructions: 'Use light tension and draw the band apart with control.' },
    ],
    exercises: [
      { id: 'dumbbell-lateral-raises', name: 'Dumbbell Lateral Raises', focus: 'Side shoulders', instructions: 'Use a light load, lift smoothly to a comfortable height, and avoid swinging.', targetSets: 3, targetReps: '12–20' },
      { id: 'reverse-pec-deck', name: 'Reverse Pec Deck', focus: 'Rear shoulders', instructions: 'Set the seat so handles are around shoulder height. Sweep your arms back with control.', targetSets: 3, targetReps: '12–15' },
      { id: 'preacher-curls', name: 'Preacher Curls', focus: 'Biceps', instructions: 'Keep your upper arms supported and lower the weight slowly through a comfortable range.', targetSets: 3, targetReps: '8–12' },
      { id: 'overhead-cable-tricep-extensions', name: 'Overhead Cable Tricep Extensions', focus: 'Triceps', instructions: 'Choose a comfortable shoulder position and extend smoothly without forcing the stretch.', targetSets: 3, targetReps: '10–15' },
      { id: 'cable-curls', name: 'Cable Bicep Curls', focus: 'Biceps', instructions: 'Keep your elbows steady and curl through a comfortable range without swinging.', targetSets: 2, targetReps: '10–15' },
      { id: 'cable-tricep-pushdowns', name: 'Cable Tricep Pushdowns', focus: 'Triceps', instructions: 'Keep your elbows near your sides and straighten your arms without rocking your torso.', targetSets: 2, targetReps: '10–15' },
    ],
    cooldown: [
      { id: 'cross-body-shoulder-stretch', name: 'Cross-body shoulder stretch · 30 sec per side', instructions: 'Bring one arm across your chest and support it gently. Do not pull into pain.' },
      { id: 'overhead-triceps-stretch', name: 'Overhead triceps stretch · 30 sec per side', instructions: 'Raise one arm and bend the elbow; use the other hand lightly. Keep the stretch gentle and pain-free.' },
    ],
  },
]

export const weeklyGymSchedule = [
  { day: 'Monday', dayOfWeek: 1, workoutId: 'push' },
  { day: 'Tuesday', dayOfWeek: 2, workoutId: 'pull' },
  { day: 'Wednesday', dayOfWeek: 3, workoutId: 'core' },
  { day: 'Thursday', dayOfWeek: 4, workoutId: 'arnold-chest-back' },
  { day: 'Friday', dayOfWeek: 5, workoutId: 'arnold-shoulders-arms' },
  { day: 'Saturday', dayOfWeek: 6, workoutId: null },
  { day: 'Sunday', dayOfWeek: 0, workoutId: null },
] as const

export function getScheduledWorkoutForDate(date: Date): Workout | null {
  const scheduledId = weeklyGymSchedule.find((entry) => entry.dayOfWeek === date.getDay())?.workoutId
  return scheduledId ? workouts.find((item) => item.id === scheduledId) ?? null : null
}

export function getWorkout(workoutId: WorkoutId): Workout {
  const workout = workouts.find((item) => item.id === workoutId)
  if (!workout) {
    throw new Error(`Unknown workout: ${workoutId}`)
  }
  return workout
}

export function getLowerBodyExercises(workout: Workout): Exercise[] {
  return workout.exercises.filter((exercise) => exercise.isLowerBody)
}
