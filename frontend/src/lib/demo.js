/**
 * Public demo account, mirrored from backend/src/config/demo.js.
 *
 * These credentials ship in the bundle on purpose. The account is a VIEWER, so
 * RBAC already prevents it from changing anything — publishing them grants
 * exactly the access a reviewer is meant to have. The login endpoint itself is
 * protected by a global 30/hour cap on this account, separate from the per-IP
 * limiter.
 */

export const DEMO_EMAIL = 'demo@transactguard.com'
export const DEMO_PASSWORD = 'DemoView@2026'

/** True when the signed-in user is the shared demo account. */
export const isDemoUser = (user) => user?.email === DEMO_EMAIL
