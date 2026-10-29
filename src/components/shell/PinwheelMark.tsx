import { PW_PATH } from '../../lib/icons'

// The Pinwheel mark as a plain element (the path lives in lib/icons, which also serves it as the AI icon). Colour comes from CSS `fill` (tangerine by default).
export function PinwheelMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <path d={PW_PATH} />
    </svg>
  )
}
