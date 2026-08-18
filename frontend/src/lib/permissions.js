/**
 * Role capabilities, in one place.
 *
 * The API is the authority — every one of these is enforced server-side by
 * requireRole, and the UI reading them differently changes nothing about what
 * is actually allowed. What this file buys is honesty in the interface: a
 * button that will certainly 403 should not be offered in the first place.
 *
 * Roles, narrowest first:
 *   VIEWER   read-only. Sees everything, changes nothing.
 *   ANALYST  the working role — ingest, score, triage, simulate.
 *   ADMIN    everything an analyst can do, plus destructive and
 *            account-management actions.
 */

export const ROLES = { ADMIN: 'ADMIN', ANALYST: 'ANALYST', VIEWER: 'VIEWER' }

export const isAdmin = (user) => user?.role === ROLES.ADMIN
export const isAnalyst = (user) => user?.role === ROLES.ANALYST
export const isViewer = (user) => user?.role === ROLES.VIEWER

/** Can act on data at all — analysts and admins, never viewers. */
export const canWrite = (user) => user?.role === ROLES.ADMIN || user?.role === ROLES.ANALYST

export const can = {
  // Shared by ADMIN and ANALYST.
  createTransaction: canWrite,
  uploadCsv: canWrite,
  rescore: canWrite,
  decideCase: canWrite,
  queueJob: canWrite,
  runSimulator: canWrite,

  // ADMIN only — destructive, or account management.
  deleteTransaction: isAdmin,
  retryJob: isAdmin,
  manageUsers: isAdmin,
  viewDeleted: isAdmin,
}

/** Display treatment for a role chip. ADMIN is the one worth spotting. */
export const roleStyle = (role) => {
  switch (role) {
    case ROLES.ADMIN:
      return { color: 'var(--accent)', glow: 'var(--accent-glow)', border: 'rgba(99,102,241,0.45)' }
    case ROLES.ANALYST:
      return { color: 'var(--text-dim)', glow: undefined, border: 'var(--hairline)' }
    default:
      return { color: 'var(--text-dim)', glow: undefined, border: 'var(--hairline)' }
  }
}
