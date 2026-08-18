/**
 * Public demo account.
 *
 * One place defining the demo identity, so the seed script, the rate limiter
 * and the login page cannot drift apart.
 *
 * WHY PUBLISHING THESE CREDENTIALS IS ACCEPTABLE: the account is seeded as a
 * VIEWER. That role can read the queue, the dashboards and the transaction
 * list, and can do nothing else — RBAC already blocks it from creating,
 * deleting, uploading, scoring, retrying jobs, running the simulator and
 * listing users. Anyone holding these credentials has exactly the access a
 * reviewer is meant to have.
 *
 * What the credentials do not protect against is abuse of the login endpoint
 * itself, which is what middleware/demoAccountLimit.js exists for.
 */

export const DEMO_EMAIL = 'demo@transactguard.com'

/** Public by design. Still satisfies the same password rules as any account. */
export const DEMO_PASSWORD = 'DemoView@2026'

export const DEMO_NAME = 'Demo Reviewer'

/**
 * Cap on demo logins, counted globally rather than per IP.
 *
 * The existing limiter already stops one address hammering /auth/login. This is
 * the other half: without a global cap, a distributed attempt could still use
 * the published credentials to grind bcrypt on every request, since each login
 * costs a ~250ms hash by design. Thirty an hour is far more than any real
 * review session needs and far less than is useful as an attack surface.
 */
export const DEMO_LOGIN_LIMIT = 30
export const DEMO_LOGIN_WINDOW_SECONDS = 3600
