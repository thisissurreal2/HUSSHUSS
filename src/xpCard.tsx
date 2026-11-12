import { getXpSummary } from './xp'
import type { WorkoutRecord } from './workoutStorage'
import type { ExtraSessionRecord } from './extras'

export function XpCard({ history, extras = [] }: { history: WorkoutRecord[]; extras?: ExtraSessionRecord[] }) {
  const xp = getXpSummary(history, extras)
  const percent = Math.round(xp.progress * 100)

  return (
    <section className="panel xp-card" aria-label="Level and experience">
      <div className="xp-top">
        <div className="xp-level">
          <span className="xp-level-label">LEVEL</span>
          <strong>{xp.level}</strong>
        </div>
        <div className="xp-title">
          <strong>{xp.title}</strong>
          <span>{xp.totalXp.toLocaleString()} XP total</span>
        </div>
        {xp.lastWorkoutXp !== null && <div className="xp-gain">+{xp.lastWorkoutXp} XP</div>}
      </div>
      <div
        className="xp-bar"
        role="progressbar"
        aria-label="Progress to next level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="xp-foot">
        <span>{xp.nextLevelXp - xp.totalXp} XP to level {xp.level + 1}</span>
        {xp.leveledUpLastWorkout && <strong className="xp-levelup">LEVEL UP!</strong>}
      </div>
    </section>
  )
}