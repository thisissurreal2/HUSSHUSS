import { useState } from 'react'
import { isSoundEnabled, playSound, setSoundEnabled } from './sound'

export function SoundToggle() {
  const [enabled, setEnabled] = useState(isSoundEnabled)

  function toggle() {
    const next = !enabled
    setSoundEnabled(next)
    setEnabled(next)
    if (next) {
      void playSound('set')
    }
  }

  return (
    <button className="timer-reset-button" onClick={toggle} aria-pressed={enabled}>
      Sound: {enabled ? 'On' : 'Off'}
    </button>
  )
}