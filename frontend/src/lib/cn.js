import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge class names, letting later Tailwind utilities win over earlier ones. */
export const cn = (...inputs) => twMerge(clsx(inputs))
