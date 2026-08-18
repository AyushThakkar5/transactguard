/** Empty state — written in the product's voice, always says what to do next. */

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {Icon && <Icon className="mb-4 h-6 w-6 text-dim" strokeWidth={1.5} aria-hidden="true" />}
      <p className="display text-[17px] text-text">{title}</p>
      {description && <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-dim">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
