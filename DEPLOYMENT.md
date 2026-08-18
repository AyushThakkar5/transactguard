# Deployment

Deploying TransactGuard to free tiers: **Supabase** (Postgres), **Upstash** (Redis), **Render** (API, ML service), **Vercel** (frontend).

Work top to bottom — each step produces a value the next one needs. Budget about 40 minutes the first time.

> **Nothing in this repository contains a secret.** Every value below is created by you and pasted into a dashboard. If a step asks you to commit a credential, you have misread it.

---

## Before you start

Accounts needed (all free, all GitHub sign-in):
[supabase.com](https://supabase.com) · [upstash.com](https://upstash.com) · [render.com](https://render.com) · [vercel.com](https://vercel.com)

Keep a scratch file open. You will collect six values:

| | Value | From |
| --- | --- | --- |
| 1 | `DATABASE_URL` | Supabase |
| 2 | `REDIS_URL` | Upstash |
| 3 | `JWT_SECRET` | generated |
| 4 | `JWT_REFRESH_SECRET` | generated |
| 5 | `ML_SERVICE_API_KEY` | generated |
| 6 | `ADMIN_SEED_PASSWORD` | chosen |

Generate 3–6 now:

```bash
echo "JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
echo "JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
echo "ML_SERVICE_API_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
echo "ADMIN_SEED_PASSWORD=$(openssl rand -base64 18)"
echo "ANALYST_SEED_PASSWORD=$(openssl rand -base64 18)"
```

The two JWT values **must differ** — the API refuses to start otherwise, because reusing one secret would let a refresh token be replayed as an access token.

---

## 1 · Push to GitHub

```bash
cd /Users/ayush/Documents/transactgaurd
git add -A
git commit -m "Initial commit"
```

Create an **empty** repository at [github.com/new](https://github.com/new) — no README, no .gitignore, no license (they exist already). Then:

```bash
git remote add origin https://github.com/<your-username>/transactguard.git
git branch -M main
git push -u origin main
```

---

## 2 · Supabase — Postgres

1. **New project.** Name `transactguard`, choose a region near you, set a database password (save it).
2. Wait for provisioning (~2 min).
3. **Settings → Database → Connection string → URI.** Copy it.
4. Replace `[YOUR-PASSWORD]` with the password from step 1.

> Use the **Session pooler** connection string (port `6543`) rather than the direct one. Render's free tier recycles connections aggressively and the pooler handles that; the direct connection will exhaust its limit.

Append `?pgbouncer=true&connection_limit=1` to the pooled URL so Prisma does not open a pool behind a pooler:

```
postgresql://postgres.abcdefgh:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

**→ This is `DATABASE_URL`.**

---

## 3 · Upstash — Redis

1. **Create Database.** Name `transactguard`, type Regional, region matching Supabase.
2. Open it → **Connect → Node / ioredis** tab.
3. Copy the `rediss://` URL (TLS — note the double `s`).

**→ This is `REDIS_URL`.**

BullMQ needs `maxRetriesPerRequest: null`, which this codebase already sets. Upstash's free tier allows 10,000 commands/day; a few batch jobs and a browsing session sit well inside that.

---

## 4 · Render — two services

`render.yaml` at the repo root defines both. Use the Blueprint flow rather than creating them by hand.

> **Where did the worker go?** Render's free plan has no Background Worker service type — trying to create one fails with *"service type is not available for this plan"*. So the API sets `RUN_WORKER_INLINE=true` and starts the same BullMQ consumer inside its own process, at concurrency 2 instead of 5 so a running batch cannot starve request handling. Nothing else changes: jobs are still enqueued over Redis and progress still streams back over Redis pub/sub, so splitting the worker back out on a paid plan is a config change, not a rewrite. Locally it stays a separate process — see [Local development](#local-development-is-unaffected).

1. **New → Blueprint** → connect your GitHub account → pick the repo.
2. Render reads `render.yaml` and proposes **transactguard-api** and **transactguard-ml**.
3. It prompts for every `sync: false` variable. Fill them in:

**transactguard-ml** — deploy this one first, the others reference it:

| Variable | Value |
| --- | --- |
| `INTERNAL_API_KEY` | your `ML_SERVICE_API_KEY` |

**transactguard-api**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | from Supabase |
| `REDIS_URL` | from Upstash |
| `JWT_SECRET` | generated |
| `JWT_REFRESH_SECRET` | generated (different!) |
| `ML_SERVICE_API_KEY` | same value as `INTERNAL_API_KEY` above |
| `ADMIN_SEED_PASSWORD` | chosen |
| `ANALYST_SEED_PASSWORD` | chosen |
| `ALLOWED_ORIGIN` | *leave blank for now — step 6 fills it* |

`RUN_WORKER_INLINE=true` is already set in `render.yaml` — Render will not prompt for it.

4. **Apply**. First build takes ~5 minutes.

> `ML_SERVICE_URL` is wired automatically by `render.yaml` via `fromService`, so you never type the ML service's URL.

> **The API will fail to start until `ALLOWED_ORIGIN` is set.** That is deliberate — it refuses to run in production with an open CORS policy. It will come up at the end of step 6.

Note the API's URL: `https://transactguard-api.onrender.com`.

---

## 5 · Migrate and seed production

Run once, from your machine, against the production database:

```bash
cd backend
DATABASE_URL="<your Supabase URL>" npx prisma migrate deploy
DATABASE_URL="<your Supabase URL>" \
  ADMIN_SEED_PASSWORD="<chosen>" \
  ANALYST_SEED_PASSWORD="<chosen>" \
  NODE_ENV=production \
  npx prisma db seed
```

`migrate deploy` applies committed migrations without prompting — the production-safe counterpart to `migrate dev`.

**Optional — transaction data.** The full PaySim seed writes ~50,000 rows and will be slow over the network and may exceed Supabase's free 500 MB. Start smaller:

```bash
DATABASE_URL="<your Supabase URL>" node prisma/seedTransactions.js --target 5000
DATABASE_URL="<your Supabase URL>" node prisma/seedGeography.js
```

Then score them from the deployed app: sign in as admin → **Batch jobs → New job**.

---

## 6 · Vercel — frontend

1. **Add New → Project** → import the repo.
2. **Root Directory: `frontend`** ← easy to miss, and nothing works without it.
3. Framework preset: **Vite** (auto-detected). Build and output settings come from `frontend/vercel.json`.
4. **Environment Variables:**

| Name | Value |
| --- | --- |
| `VITE_API_URL` | `https://transactguard-api.onrender.com` (no trailing slash) |

5. **Deploy.** Note your URL: `https://transactguard.vercel.app`.

**Now close the loop:** go back to Render → **transactguard-api** → Environment → set

```
ALLOWED_ORIGIN = https://transactguard.vercel.app
```

Save. Render redeploys, and the API starts.

> `VITE_API_URL` is baked in at **build** time, not read at runtime. Change it and you must redeploy the frontend.

---

## 7 · Verify

```bash
curl https://transactguard-api.onrender.com/api/v1/health
# {"status":"ok","services":{"database":"ok","redis":"ok"},...}

curl https://transactguard-api.onrender.com/api/v1/analytics/public-stats
# {"success":true,"data":{"transactions":...,"modelVersion":"rule-based-v1"}}
```

Then open the Vercel URL and click **View live demo**. You should land on the dashboard as a read-only VIEWER.

Checklist:
- [ ] Login page shows live counters (proves the public-stats endpoint is reachable)
- [ ] Demo button signs you in without typing
- [ ] Dashboard KPIs populate
- [ ] Transactions list loads; opening a row shows the gauge
- [ ] Live feed shows "connected" (proves the WebSocket survives Render's proxy)
- [ ] Sign in as admin and queue a batch job — progress should stream live

---

## Free-tier realities

**Render spins services down after 15 minutes idle.** The first request wakes them and takes up to ~50 seconds. The frontend shows a "Waking up the server" notice after 2.5 seconds so a visitor is not left staring at a spinner — but the demo is best shared with a heads-up, or warmed by loading it a minute beforehand.

**Two services, two cold starts.** The API wakes on the first request, but the ML service only wakes when the API first calls it — so the *first* scoring action can be slow even after the app appears loaded.

**A sleeping API is a paused queue.** With the worker inline, nothing consumes the queue while the service is spun down. Jobs are not lost — they sit in Redis and drain as soon as the next request wakes the API — but a batch queued from a browser tab you then walk away from will not finish in the background the way it would with a dedicated worker.

**Supabase pauses a project after 7 days of inactivity.** Open the dashboard to resume it. Worth loading the app once a week if it is on your CV.

**Upstash allows 10,000 commands/day.** Rate limiting and the token denylist are a handful per request; a large batch job is the thing that could approach it.

**A cron ping keeps it warm.** A free [cron-job.org](https://cron-job.org) hit on `/api/v1/health` every 10 minutes largely eliminates cold starts, at the cost of using more of Render's 750 free instance-hours per month. Ping only the API — that also keeps the inline worker consuming.

---

## Local development is unaffected

Inline mode is opt-in and off by default (`RUN_WORKER_INLINE=false` in `backend/.env.example`). Locally the worker still runs as its own process, exactly as before:

```bash
npm run dev      # API only — no worker in-process
npm run worker   # the BullMQ consumer, separate process, concurrency 5
```

`./dev.sh` still starts them separately too. Both arrangements were verified end to end against Postgres, Redis and the ML service — a 250-transaction / 3-chunk job drains to `COMPLETED 250/250` either way, at concurrency 2 inline and 5 standalone.

---

## Troubleshooting

**Blueprint fails: `service type is not available for this plan`** — you are on an old `render.yaml` that still declares `type: worker`. Pull the latest; the worker now runs inside the API.

**Build fails: `prisma: not found` / `npx` tries to download prisma** — `NODE_ENV=production` makes npm set `omit=dev`, so `npm ci` skips devDependencies. The Prisma CLI is needed by the build, so it lives in `dependencies`, not `devDependencies`. If you moved it, move it back.

**API deploy fails: `ALLOWED_ORIGIN is not set`** — expected before step 6. Set it to your Vercel URL.

**API fails: `JWT_SECRET and JWT_REFRESH_SECRET must be different`** — you pasted the same value twice.

**Frontend loads, every request fails with CORS** — `ALLOWED_ORIGIN` does not exactly match the browser's origin. It must include the scheme and no trailing slash.

**Frontend loads but the API is unreachable** — `VITE_API_URL` was set after the build. Redeploy the frontend.

**Login works, live feed never connects** — check `ALLOWED_ORIGIN` on the API. Socket.IO uses the same allow-list, and it starts on HTTP polling before upgrading, so a proxy that blocks the upgrade degrades rather than fails.

**`prisma migrate deploy` hangs** — you are using the direct connection string. Switch to the Session pooler (port 6543).

**502 from Render** — the service is waking. Wait 60 seconds.

**Everything works but there is no data** — you skipped the optional transaction seed in step 5. The app is correct but empty.
