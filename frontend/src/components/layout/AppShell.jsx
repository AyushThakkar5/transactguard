/**
 * Application shell.
 *
 * The ambient grid sits behind everything at z-0; the sidebar and content sit
 * above it. The detail drawer is mounted here rather than per-page, so opening
 * it never navigates away.
 */

import { Sidebar, MobileNav } from './Sidebar.jsx'
import { TransactionDrawer } from '../TransactionDrawer.jsx'
import { AmbientGrid } from '../AmbientGrid.jsx'
import { DemoBanner } from '../DemoBanner.jsx'

export function AppShell({ children }) {
  return (
    <div className="relative flex min-h-screen bg-void">
      <AmbientGrid />
      <Sidebar />
      <main className="relative z-10 min-w-0 flex-1 pb-20 md:pb-0">
        <DemoBanner />
        {children}
      </main>
      <MobileNav />
      <TransactionDrawer />
    </div>
  )
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline px-6 py-6 md:px-8 md:py-7">
      <div>
        <h1 className="display text-[25px] leading-tight text-text">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[13px] text-dim">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

export function PageBody({ children, className = '' }) {
  return <div className={`px-6 py-6 md:px-8 ${className}`}>{children}</div>
}
