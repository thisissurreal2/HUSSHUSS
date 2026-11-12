
import { mascots } from './mascots'

export function BrandMark({ variant = 'default' }: { variant?: 'default' | 'avatar' | 'hero' }) {
  return (
    <span className={`brand-mark brand-mark-${variant}`} aria-hidden="true">
      <img
        src={mascots.main}
        alt=""
        className={`brand-mark-image brand-mark-image-${variant}`}
      />
    </span>
  )
}

export function BrandWordmark() {
  return (
    <span className="brand-wordmark" aria-label="HUSHHUSS">
      <span>HUSS</span><span>HUSS</span>
    </span>
  )
}
