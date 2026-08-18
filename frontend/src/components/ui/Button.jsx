/**
 * Button.
 *
 * Indigo is the accent, so "primary" is a filled accent surface. Everything
 * interactive carries the shared `lift` treatment — accent glow plus a 2%
 * scale on hover — so the interface feels responsive rather than static.
 */

import { cn } from '../../lib/cn.js'

const VARIANTS = {
  primary: 'bg-accent text-white border border-accent hover:bg-[#7275f5] disabled:bg-hairline disabled:border-hairline disabled:text-dim',
  outline: 'bg-surface text-text border border-hairline hover:bg-raised',
  ghost: 'bg-transparent text-dim border border-transparent hover:text-text hover:bg-raised',
  danger: 'bg-surface text-critical border border-critical/40 hover:border-critical',
}

const SIZES = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-9 px-3.5 text-[13px]',
  lg: 'h-10 px-5 text-[14px]',
}

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  loading = false,
  disabled,
  children,
  ...props
}) {
  return (
    <button
      className={cn(
        'lift inline-flex items-center justify-center gap-2 rounded-control font-sans font-medium',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 disabled:hover:shadow-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

export function Spinner({ className }) {
  return (
    <svg className={cn('h-3.5 w-3.5 animate-spin', className)} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
