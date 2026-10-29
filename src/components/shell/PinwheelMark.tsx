// The Pinwheel mark (8-blade peppermint pinwheel), drawn once here. Colour comes from CSS `fill` (tangerine by default).
export function PinwheelMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <path d="M60 60Q35.01 40.17 60.00 2.00A58 58 0 0 1 84.28 7.33Q49.01 38.26 60 60ZM60 60Q56.35 28.31 101.01 18.99A58 58 0 0 1 114.42 39.93Q67.60 36.86 60 60ZM60 60Q79.83 35.01 118.00 60.00A58 58 0 0 1 112.67 84.28Q81.74 49.01 60 60ZM60 60Q91.69 56.35 101.01 101.01A58 58 0 0 1 80.07 114.42Q83.14 67.60 60 60ZM60 60Q84.99 79.83 60.00 118.00A58 58 0 0 1 35.72 112.67Q70.99 81.74 60 60ZM60 60Q63.65 91.69 18.99 101.01A58 58 0 0 1 5.58 80.07Q52.40 83.14 60 60ZM60 60Q40.17 84.99 2.00 60.00A58 58 0 0 1 7.33 35.72Q38.26 70.99 60 60ZM60 60Q28.31 63.65 18.99 18.99A58 58 0 0 1 39.93 5.58Q36.86 52.40 60 60Z" />
    </svg>
  )
}
