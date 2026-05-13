import blackbirdMark from '@/assets/blackbird-mark.png'

/**
 * Vector wrapper around the Blackbird icon raster (icon-only mark, no wordmark).
 */
export function BlackbirdMark({ className = 'h-5 w-auto' }) {
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 89 50"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <image
        href={blackbirdMark}
        width="89"
        height="50"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  )
}
