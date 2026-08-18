import { cn } from '../../lib/cn.js'

export function Field({ label, htmlFor, children, className, hint }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="label-caps text-dim">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] text-dim">{hint}</p>}
    </div>
  )
}

const FIELD = [
  'h-9 rounded-control border border-hairline bg-surface px-2.5 text-[13px] text-text',
  'placeholder:text-dim/60',
  'transition-[border-color,box-shadow] duration-150',
  'hover:border-accent/50',
  'focus:border-accent focus:outline-none focus:shadow-[var(--accent-glow)]',
].join(' ')

export function Input({ className, mono = false, ...props }) {
  return <input className={cn(FIELD, mono && 'num', className)} {...props} />
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(FIELD, 'px-2', className)} {...props}>
      {children}
    </select>
  )
}

/** Segmented control — few mutually exclusive options, all visible at once. */
export function Segmented({ options, value, onChange, name, disabled = false }) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="inline-flex rounded-control border border-hairline bg-surface p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-all duration-150',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'bg-accent text-white shadow-[var(--accent-glow)]' : 'text-dim hover:text-text',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
