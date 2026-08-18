/**
 * Toasts.
 *
 * Every message is written by its caller and says what actually happened —
 * "3 transactions marked Confirmed Fraud", never "Success". A toast that does
 * not name the thing it did is noise.
 */

import { create } from 'zustand'

let nextId = 1

export const useToasts = create((set, get) => ({
  toasts: [],

  push: ({ tone = 'info', title, description, duration = 4200 }) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, tone, title, description }] }))
    if (duration > 0) setTimeout(() => get().dismiss(id), duration)
    return id
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (title, description) => useToasts.getState().push({ tone: 'success', title, description }),
  error: (title, description) => useToasts.getState().push({ tone: 'error', title, description, duration: 6500 }),
  info: (title, description) => useToasts.getState().push({ tone: 'info', title, description }),
}
