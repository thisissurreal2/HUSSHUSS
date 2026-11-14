export type JinGuSectionId = 'preparation' | 'stances' | 'yi-jin-jing' | 'balance' | 'meditation'
export type JinGuTarget =
  | { kind: 'duration'; seconds: number; sets: number }
  | { kind: 'duration-sides'; seconds: number; sets: number; sides: string[] }
  | { kind: 'reps'; reps: number; sets: number }
  | { kind: 'reps-sides'; reps: number; sets: number; sides: string[] }
  | { kind: 'free-duration'; minSeconds: number; maxSeconds: number }

export type JinGuExercise = {
  id: string
  section: JinGuSectionId
  name: string
  description: string
  instructions: string[]
  safety: string
  target: JinGuTarget
  restSeconds: number
}

export type JinGuSessionStatus = 'completed' | 'partial'
export type JinGuSession = {
  id: string
  date: string
  startedAt: number
  completedAt: number
  durationSeconds: number
  completedExerciseIds: string[]
  skippedExerciseIds: string[]
  status: JinGuSessionStatus
  lightPractice: boolean
  horseStanceTargetSeconds: number
  difficulty: number | null
  discomfortReported: boolean
  notes: string
}

export type ActiveJinGuSession = {
  id: string
  date: string
  startedAt: number
  currentExerciseIndex: number
  completedExerciseIds: string[]
  skippedExerciseIds: string[]
  lightPractice: boolean
  horseStanceTargetSeconds: number
  timerDeadline: number | null
  timerRemainingSeconds: number
}

export const JIN_GU_ROUTINE_VERSION = 1 as const

export function getJinGuRoutine(horseStanceTargetSeconds = 20): JinGuExercise[] {
  return [
    { id: 'gentle-shaking', section: 'preparation', name: 'Gentle full-body shaking', description: 'Loosen up with small, relaxed movements.', instructions: ['Stand comfortably and softly shake out your hands, arms, shoulders, legs and feet.', 'Keep the movement light and let your breathing stay easy.'], safety: 'Keep your feet grounded and make the movement small if you feel unsteady.', target: { kind: 'duration', seconds: 60, sets: 1 }, restSeconds: 0 },
    { id: 'wrist-circles-waves', section: 'preparation', name: 'Wrist circles and waves', description: 'Move the wrists gently through a comfortable range.', instructions: ['Make slow circles in both directions.', 'Finish with relaxed wrist waves; do not force the range.'], safety: 'Stop short of pinching or painful movement.', target: { kind: 'duration', seconds: 30, sets: 1 }, restSeconds: 0 },
    { id: 'shoulder-arm-rotations', section: 'preparation', name: 'Shoulder and arm rotations', description: 'Warm the shoulders with smooth, easy circles.', instructions: ['Roll the shoulders gently, then make comfortable arm circles.', 'Keep the neck relaxed and avoid swinging forcefully.'], safety: 'Use a smaller circle if your shoulders feel stiff or uncomfortable.', target: { kind: 'duration', seconds: 30, sets: 1 }, restSeconds: 0 },
    { id: 'spinal-rotations', section: 'preparation', name: 'Spinal rotations', description: 'Turn the upper body slowly without forcing the twist.', instructions: ['Stand tall with knees soft and arms relaxed.', 'Turn gently from side to side, letting the hips follow only as comfortable.'], safety: 'Do not force the end range or twist through pain.', target: { kind: 'duration', seconds: 60, sets: 1 }, restSeconds: 0 },
    { id: 'ankle-circles-weight-shifts', section: 'preparation', name: 'Ankle circles and gentle weight shifts', description: 'Prepare the ankles and feel your balance over both feet.', instructions: ['Circle each ankle slowly in both directions.', 'Shift weight gently from foot to foot while staying upright.'], safety: 'Use a wall or sturdy support if balance feels uncertain.', target: { kind: 'duration', seconds: 60, sets: 1 }, restSeconds: 0 },
    { id: 'ma-bu', section: 'stances', name: 'Ma Bu · horse stance', description: 'Practise a comfortable, upright horse stance.', instructions: ['Stand with feet wider than hip width and toes turned slightly out.', 'Bend the knees only as far as comfortable; keep them tracking with the toes.', 'Keep the chest easy and breathe steadily for each hold.'], safety: 'Use a shallow stance. Stand up if you feel pain, dizziness or unusual pressure.', target: { kind: 'duration', seconds: horseStanceTargetSeconds, sets: 2 }, restSeconds: 25 },
    { id: 'gong-bu', section: 'stances', name: 'Gong Bu · bow stance', description: 'Practise a short, stable bow stance on each side.', instructions: ['Step into a comfortable split stance and bend the front knee slightly.', 'Keep the front knee aligned with the foot and the torso upright.', 'Complete both holds on each side, changing sides slowly.'], safety: 'Keep the stance short and shallow; do not force the knee or hip.', target: { kind: 'duration-sides', seconds: 15, sets: 2, sides: ['Left', 'Right'] }, restSeconds: 20 },
    { id: 'xu-bu', section: 'stances', name: 'Xu Bu · empty stance', description: 'Practise a light, balanced empty stance on each side.', instructions: ['Shift most of your weight onto one leg and place the other foot lightly ahead.', 'Keep the supporting knee soft and use a nearby wall if needed.', 'Switch sides carefully and repeat both holds.'], safety: 'Keep the range small and hold support when balance is uncertain.', target: { kind: 'duration-sides', seconds: 15, sets: 2, sides: ['Left', 'Right'] }, restSeconds: 20 },
    { id: 'hold-heavens', section: 'yi-jin-jing', name: 'Two hands hold the heavens', description: 'A slow, Yi Jin Jing-inspired overhead reach.', instructions: ['Begin with hands relaxed near the lower ribs.', 'Raise both hands overhead comfortably, lengthen gently, then lower with control.', 'Move slowly and breathe naturally; this is one repetition.'], safety: 'Do not arch the lower back or force the arms overhead.', target: { kind: 'reps', reps: 5, sets: 1 }, restSeconds: 20 },
    { id: 'drawing-bow', section: 'yi-jin-jing', name: 'Drawing the bow', description: 'A slow, Yi Jin Jing-inspired alternating reach.', instructions: ['Stand comfortably and reach one arm forward while drawing the other back.', 'Turn only as far as comfortable, return to centre and change sides.', 'Complete five controlled repetitions on each side.'], safety: 'Keep the shoulders relaxed and avoid a forceful twist.', target: { kind: 'reps-sides', reps: 5, sets: 1, sides: ['Left', 'Right'] }, restSeconds: 20 },
    { id: 'separate-heaven-earth', section: 'yi-jin-jing', name: 'Separate heaven and earth', description: 'A gentle alternating upward and downward reach.', instructions: ['Place one palm facing up and the other facing down.', 'Reach in opposite directions without locking the elbows, then return and switch sides.', 'Complete five slow repetitions on each side.'], safety: 'Use a comfortable shoulder range and keep the ribs relaxed.', target: { kind: 'reps-sides', reps: 5, sets: 1, sides: ['Left', 'Right'] }, restSeconds: 20 },
    { id: 'turn-head-look-back', section: 'yi-jin-jing', name: 'Turn the head and look back', description: 'A gentle, Yi Jin Jing-inspired head turn.', instructions: ['Stand tall with shoulders relaxed and eyes level.', 'Turn your head comfortably to one side, return to centre and change sides.', 'Complete five controlled repetitions on each side.'], safety: 'Keep the turn small; stop if you feel pain, dizziness or tingling.', target: { kind: 'reps-sides', reps: 5, sets: 1, sides: ['Left', 'Right'] }, restSeconds: 20 },
    { id: 'crane-stance', section: 'balance', name: 'Crane stance · single-leg balance', description: 'Practise steady, supported balance on each leg.', instructions: ['Stand beside a wall or sturdy support.', 'Lift one foot only as high as comfortable and keep your gaze steady.', 'Complete both holds, then change legs.'], safety: 'Keep a hand near support; place the foot down whenever needed.', target: { kind: 'duration-sides', seconds: 20, sets: 2, sides: ['Left leg', 'Right leg'] }, restSeconds: 20 },
    { id: 'controlled-weight-transfers', section: 'balance', name: 'Slow controlled weight transfers', description: 'Move your weight gently between both feet.', instructions: ['Stand with feet comfortable and knees soft.', 'Shift weight slowly from one foot to the other without leaning or rushing.', 'Return to the middle between repetitions.'], safety: 'Use support if needed and keep each shift small and controlled.', target: { kind: 'reps', reps: 10, sets: 1 }, restSeconds: 15 },
    { id: 'slow-stance-transitions', section: 'balance', name: 'Slow stance transitions', description: 'Move calmly between comfortable upright and stance positions.', instructions: ['Move from upright into a shallow Ma Bu and return to upright five times.', 'Then move into a shallow Gong Bu on each side and return to upright five times each way.', 'Keep every transition smooth and controlled.'], safety: 'Use a small range; stop before balance or knee alignment becomes difficult.', target: { kind: 'reps-sides', reps: 5, sets: 1, sides: ['Into stance', 'Return to upright'] }, restSeconds: 20 },
    { id: 'wuji-standing', section: 'meditation', name: 'Relaxed Wuji standing', description: 'Finish with quiet, comfortable standing and breathing.', instructions: ['Stand with feet grounded, knees unlocked, shoulders relaxed and spine naturally upright.', 'Let the breath stay slow and comfortable; do not hold or force it.', 'Finish whenever you feel ready, allowing about three to five minutes.'], safety: 'Sit or stop if you feel unwell, unsteady or uncomfortable.', target: { kind: 'free-duration', minSeconds: 180, maxSeconds: 300 }, restSeconds: 0 },
  ]
}

export const jinGuSections: { id: JinGuSectionId; title: string; estimate: string }[] = [
  { id: 'preparation', title: 'Standing preparation', estimate: 'about 4 min' },
  { id: 'stances', title: 'Traditional stance training', estimate: 'about 7 min' },
  { id: 'yi-jin-jing', title: 'Yi Jin Jing-inspired movements', estimate: 'about 7 min' },
  { id: 'balance', title: 'Balance and coordination', estimate: 'about 4 min' },
  { id: 'meditation', title: 'Standing meditation and breathing', estimate: '3–5 min' },
]

export function getJinGuTarget(exercise: JinGuExercise, lightPractice: boolean): JinGuTarget {
  if (!lightPractice) return exercise.target
  const reduce = (seconds: number) => Math.max(10, Math.round(seconds / 2))
  const reduceReps = (reps: number) => Math.max(1, Math.ceil(reps / 2))
  switch (exercise.target.kind) {
    case 'duration': return { ...exercise.target, seconds: reduce(exercise.target.seconds) }
    case 'duration-sides': return { ...exercise.target, seconds: reduce(exercise.target.seconds) }
    case 'reps': return { ...exercise.target, reps: reduceReps(exercise.target.reps) }
    case 'reps-sides': return { ...exercise.target, reps: reduceReps(exercise.target.reps) }
    case 'free-duration': return { ...exercise.target, minSeconds: 180, maxSeconds: 180 }
  }
}

export function getJinGuTargetLabel(target: JinGuTarget): string {
  switch (target.kind) {
    case 'duration': return `${target.sets} × ${target.seconds} sec`
    case 'duration-sides': return `${target.sets} × ${target.seconds} sec each side`
    case 'reps': return `${target.sets > 1 ? `${target.sets} × ` : ''}${target.reps} reps`
    case 'reps-sides': return `${target.reps} reps each side`
    case 'free-duration': return target.minSeconds === target.maxSeconds ? `${Math.round(target.minSeconds / 60)} min · finish when ready` : '3–5 min · finish when ready'
  }
}

export function getJinGuTimerSeconds(target: JinGuTarget): number | null {
  return target.kind === 'duration' || target.kind === 'duration-sides'
    ? target.seconds
    : target.kind === 'free-duration' ? target.minSeconds : null
}

export function createActiveJinGuSession(lightPractice: boolean, horseStanceTargetSeconds: number, date: string, startedAt = Date.now()): ActiveJinGuSession {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `jin-gu-${startedAt}-${Math.random().toString(36).slice(2)}`,
    date,
    startedAt,
    currentExerciseIndex: 0,
    completedExerciseIds: [],
    skippedExerciseIds: [],
    lightPractice,
    horseStanceTargetSeconds,
    timerDeadline: null,
    timerRemainingSeconds: 0,
  }
}

export function moveToJinGuExercise(session: ActiveJinGuSession, index: number): ActiveJinGuSession {
  if (!Number.isInteger(index) || index < 0 || index >= getJinGuRoutine(session.horseStanceTargetSeconds).length || index === session.currentExerciseIndex) return session
  return { ...session, currentExerciseIndex: index, timerDeadline: null, timerRemainingSeconds: 0 }
}

export function setJinGuExerciseStatus(session: ActiveJinGuSession, exerciseId: string, status: 'completed' | 'skipped'): ActiveJinGuSession {
  if (!getJinGuRoutine(session.horseStanceTargetSeconds).some((exercise) => exercise.id === exerciseId)) return session
  const opposite = status === 'completed' ? 'skippedExerciseIds' : 'completedExerciseIds'
  const selected = status === 'completed' ? 'completedExerciseIds' : 'skippedExerciseIds'
  return {
    ...session,
    [selected]: [...new Set([...session[selected].filter((id) => id !== exerciseId), exerciseId])],
    [opposite]: session[opposite].filter((id) => id !== exerciseId),
  }
}

export function startJinGuTimer(session: ActiveJinGuSession, targetSeconds: number, now = Date.now()): ActiveJinGuSession {
  if (!Number.isInteger(targetSeconds) || targetSeconds < 1 || session.timerDeadline !== null) return session
  const remaining = session.timerRemainingSeconds > 0 ? session.timerRemainingSeconds : targetSeconds
  return { ...session, timerDeadline: now + remaining * 1000, timerRemainingSeconds: remaining }
}

export function pauseJinGuTimer(session: ActiveJinGuSession, now = Date.now()): ActiveJinGuSession {
  if (session.timerDeadline === null) return session
  return { ...session, timerDeadline: null, timerRemainingSeconds: Math.max(0, Math.ceil((session.timerDeadline - now) / 1000)) }
}

export function createJinGuSessionRecord(
  active: ActiveJinGuSession,
  completedAt: number,
  details: { difficulty: number | null; discomfortReported: boolean; notes: string },
): JinGuSession {
  const routineIds = new Set(getJinGuRoutine(active.horseStanceTargetSeconds).map((item) => item.id))
  const completedExerciseIds = [...new Set(active.completedExerciseIds)].filter((id) => routineIds.has(id))
  const skippedExerciseIds = [...new Set(active.skippedExerciseIds)].filter((id) => routineIds.has(id) && !completedExerciseIds.includes(id))
  const complete = completedExerciseIds.length === routineIds.size && skippedExerciseIds.length === 0
  return {
    id: active.id,
    date: active.date,
    startedAt: active.startedAt,
    completedAt,
    durationSeconds: Math.max(0, Math.floor((completedAt - active.startedAt) / 1000)),
    completedExerciseIds,
    skippedExerciseIds,
    status: complete ? 'completed' : 'partial',
    lightPractice: active.lightPractice,
    horseStanceTargetSeconds: active.horseStanceTargetSeconds,
    difficulty: details.difficulty,
    discomfortReported: details.discomfortReported,
    notes: details.notes.trim(),
  }
}

export function getNextHorseStanceTarget(
  currentTarget: number,
  history: JinGuSession[],
  now = Date.now(),
  lastTargetChangeAt: number | null = null,
  readinessCategory?: 'ready' | 'caution' | 'recovery' | 'missing',
): number | null {
  if (![20, 25, 30].includes(currentTarget) || (readinessCategory !== undefined && readinessCategory !== 'ready')) return null
  const completed = history.filter((session) => session.status === 'completed')
  if (!completed.length || now - Math.min(...completed.map((session) => session.completedAt)) < 7 * 86_400_000) return null
  if (lastTargetChangeAt !== null && now - lastTargetChangeAt < 7 * 86_400_000) return null
  const recent = history.filter((session) => session.completedAt >= now - 7 * 86_400_000 && session.completedAt <= now)
  if (recent.length < 4 || recent.some((session) => session.status !== 'completed' || session.lightPractice || session.discomfortReported || session.difficulty === null || session.difficulty > 3)) return null
  return currentTarget + 5
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0) && new Set(value).size === value.length
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isJinGuSession(value: unknown): value is JinGuSession {
  if (!isObject(value)) return false
  const completedIds = value.completedExerciseIds
  const skippedIds = value.skippedExerciseIds
  if (!uniqueStrings(completedIds) || !uniqueStrings(skippedIds)
    || completedIds.some((id) => skippedIds.includes(id))
    || typeof value.id !== 'string' || !value.id || !isDate(value.date)
    || !Number.isFinite(value.startedAt) || !Number.isFinite(value.completedAt)
    || (value.completedAt as number) < (value.startedAt as number)
    || !Number.isInteger(value.durationSeconds) || (value.durationSeconds as number) < 0
    || (value.status !== 'completed' && value.status !== 'partial') || typeof value.lightPractice !== 'boolean'
    || ![20, 25, 30, 35].includes(value.horseStanceTargetSeconds as number)
    || !(value.difficulty === null || Number.isInteger(value.difficulty) && (value.difficulty as number) >= 1 && (value.difficulty as number) <= 5)
    || typeof value.discomfortReported !== 'boolean' || typeof value.notes !== 'string' || value.notes.length > 1000) return false
  return true
}

export function isActiveJinGuSession(value: unknown): value is ActiveJinGuSession {
  if (!isObject(value)) return false
  const completedIds = value.completedExerciseIds
  const skippedIds = value.skippedExerciseIds
  return uniqueStrings(completedIds) && uniqueStrings(skippedIds)
    && !completedIds.some((id) => skippedIds.includes(id))
    && typeof value.id === 'string' && Boolean(value.id) && isDate(value.date)
    && Number.isFinite(value.startedAt) && Number.isInteger(value.currentExerciseIndex)
    && (value.currentExerciseIndex as number) >= 0 && (value.currentExerciseIndex as number) < getJinGuRoutine().length
    && typeof value.lightPractice === 'boolean'
    && [20, 25, 30, 35].includes(value.horseStanceTargetSeconds as number)
    && (value.timerDeadline === null || Number.isFinite(value.timerDeadline))
    && Number.isInteger(value.timerRemainingSeconds) && (value.timerRemainingSeconds as number) >= 0 && (value.timerRemainingSeconds as number) <= 3600
}
