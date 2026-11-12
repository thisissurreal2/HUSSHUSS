export type SoundName = 'timer' | 'set' | 'finish' | 'levelUp'

const STORAGE_KEY = 'husshuss.sound.v1'
const LEGACY_STORAGE_KEY = 'soundEnabled'

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } }
type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }
type Note = [frequency: number, offset: number, duration: number, volume: number, wave: OscillatorType]

const PATTERNS: Record<SoundName, Note[]> = {
  timer: [
    [880, 0, 0.2, 0.4, 'triangle'],
    [880, 0.3, 0.2, 0.4, 'triangle'],
    [1175, 0.6, 0.5, 0.45, 'triangle'],
  ],
  set: [
    [988, 0, 0.09, 0.22, 'sine'],
    [1319, 0.07, 0.14, 0.22, 'sine'],
  ],
  finish: [
    [523, 0, 0.16, 0.35, 'triangle'],
    [659, 0.14, 0.16, 0.35, 'triangle'],
    [784, 0.28, 0.16, 0.35, 'triangle'],
    [1047, 0.42, 0.5, 0.4, 'triangle'],
  ],
  levelUp: [
    [523, 0, 0.12, 0.25, 'square'],
    [659, 0.1, 0.12, 0.25, 'square'],
    [784, 0.2, 0.12, 0.25, 'square'],
    [1047, 0.3, 0.12, 0.25, 'square'],
    [1319, 0.4, 0.12, 0.25, 'square'],
    [1568, 0.5, 0.6, 0.3, 'square'],
  ],
}

let context: AudioContext | null = null
let sessionSetting: boolean | null = null

export function isSoundEnabled(): boolean {
  if (sessionSetting !== null) return sessionSetting
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored !== 'off'

    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy === null) return true

    const enabled = legacy !== 'false'
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
    } catch {
      // Keep the legacy setting for this session if storage is unavailable.
    }
    return enabled
  } catch {
    return true
  }
}

export function setSoundEnabled(enabled: boolean): void {
  sessionSetting = enabled
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Sound still follows the choice for this session if storage is unavailable.
  }
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (context) return context
  const AudioContextClass = typeof window.AudioContext !== 'undefined'
    ? window.AudioContext
    : (window as WebkitWindow).webkitAudioContext
  if (!AudioContextClass) return null
  try {
    context = new AudioContextClass()
  } catch {
    return null
  }
  return context
}

export async function unlockSound(): Promise<boolean> {
  if (!isSoundEnabled()) return false
  try {
    const session = typeof navigator === 'undefined'
      ? undefined
      : (navigator as AudioSessionNavigator).audioSession
    if (session) session.type = 'playback'
  } catch {
    // audioSession is optional and only exists on some browsers.
  }
  const audio = getContext()
  if (!audio) return false
  try {
    if (audio.state !== 'running') await audio.resume()
    return audio.state === 'running'
  } catch {
    return false
  }
}

function tone(audio: AudioContext, note: Note): void {
  const [frequency, offset, duration, volume, wave] = note
  const start = audio.currentTime + offset
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = wave
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain)
  gain.connect(audio.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

export async function playSound(name: SoundName): Promise<boolean> {
  if (!isSoundEnabled()) return false
  const audio = getContext()
  if (!audio) return false
  try {
    if (audio.state !== 'running') await audio.resume()
    if (audio.state !== 'running') return false
    for (const note of PATTERNS[name]) tone(audio, note)
    return true
  } catch {
    return false
  }
}