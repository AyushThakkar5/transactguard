import { cn } from '../../lib/cn.js'

export function Skeleton({ className }) {
  return <div className={cn('skeleton rounded-[3px]', className)} />
}

export function SkeletonTable({ rows = 8, columns = 6 }) {
  return (
    <div role="status" aria-label="Loading results">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-hairline px-5 py-3.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn('h-3', c === 0 ? 'w-44' : c === columns - 1 ? 'w-20' : 'w-24')} />
          ))}
        </div>
      ))}
    </div>
  )
}
