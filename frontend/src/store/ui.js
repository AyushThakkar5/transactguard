/**
 * Client-only UI state: things the server has no opinion about.
 */

import { create } from 'zustand'

export const useUI = create((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

  /** The transaction whose detail drawer is open, or null. */
  drawerTransactionId: null,
  openDrawer: (transactionId) => set({ drawerTransactionId: transactionId }),
  closeDrawer: () => set({ drawerTransactionId: null }),

  transactionFilters: {
    search: '',
    txnType: '',
    from: '',
    to: '',
    sortBy: 'txnTimestamp',
    sortOrder: 'desc',
  },
  setTransactionFilter: (patch) =>
    set((s) => ({ transactionFilters: { ...s.transactionFilters, ...patch } })),
  clearTransactionFilters: () =>
    set({
      transactionFilters: {
        search: '',
        txnType: '',
        from: '',
        to: '',
        sortBy: 'txnTimestamp',
        sortOrder: 'desc',
      },
    }),
}))
