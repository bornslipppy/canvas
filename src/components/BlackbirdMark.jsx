import blackbirdMark from '@/assets/blackbird-mark.png'

import { cn } from '@/lib/utils'

/** Toolbar mark: PNG masked and filled with `tint` (default `#000000`), with a white “eye” dot. */
export function BlackbirdMark({ className = 'h-5 w-auto', tint = '#000000' }) {
  const url = `url("${blackbirdMark}")`
  const maskStyle = {
    backgroundColor: tint,
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  }

  return (
    <span
      className={cn(
        'relative inline-block shrink-0 align-middle aspect-[89/50]',
        className
      )}
      aria-hidden
    >
      <span className="pointer-events-none block h-full w-full" style={maskStyle} />
      {/* Highlights the eye cavity in the mark (approx. upper-right); tweak % if asset shifts. */}
      <span
        className="pointer-events-none absolute aspect-square rounded-full bg-white top-[11%] right-[16%] w-[9%] max-w-[4px]"
        aria-hidden
      />
    </span>
  )
}
