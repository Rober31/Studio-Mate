# StudioMate

מערכת למעקב לקוחות ומנויים לסטודיואים — מי צריך מעקב היום ולמה, הודעת וואטסאפ מוכנה לעריכה, תיעוד תוצאה, והרשמה ונוכחות ב-QR.

Web app (mobile + desktop), Hebrew / RTL, built from the system specification *StudioMate · אפיון מערכת v0.9*.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional: set ANTHROPIC_API_KEY, APP_URL
npm run dev                    # http://localhost:3000 → first-run setup screen
```

Demo data (synthetic, for development only):

```bash
npm run seed
# owner:       demo@studiomate.app / studiomate-demo
# staff:       staff@studiomate.app / studiomate-demo
# instructor:  instructor@studiomate.app / studiomate-demo
# public registration page: /s/neshima
```

Checks:

```bash
npm run lint     # TypeScript
npm test         # acceptance tests (spec §38–§39) on an isolated temp DB
npm run build && npm start
```

## Architecture (spec §25, ARC-01)

| Layer | Choice |
|---|---|
| App | Next.js (App Router) + React, one server with clear modules |
| Database | libSQL: a local SQLite file in development, Turso in production. Schema in `src/server/schema.ts` (idempotent, applied automatically) |
| Auth | Email + password (scrypt), HttpOnly session cookies, invitations, owner-issued reset links, session revocation |
| Authorization | Deny-by-default role matrix (`src/server/permissions.ts`), enforced on the server for every request; studio always derived from the session |
| AI | Anthropic API, server-side only; structured output validated on the server; safe fixed templates on any failure |
| Jobs | Rules are re-evaluated on demand (at most every 5 min per studio). Daily maintenance via Vercel Cron (`/api/cron/jobs`), or in-process when self-hosted |

```
src/server/services/   contacts · memberships · followups (rules R01–R07) · drafts · ai · tasks
                       attendance (sessions, QR, deductions) · public (registration, member identity)
                       imports · reports · team
src/app/(app)/         staff screens (S02–S07, S10–S14)
src/app/s/, src/app/m/ public member pages (S08, S09, activation)
src/app/api/           REST endpoints (API-01 contract: data/meta, error codes, Idempotency-Key)
```

Key guarantees covered by tests: one suggestion per event key, single deduction per attendance and single reversal (also under concurrent requests), idempotent imports and balance adjustments, do-not-contact enforced before draft and handoff, facts re-checked before opening WhatsApp, tenant isolation.

## Deploy to Vercel

1. **Database** — in Vercel: *Storage → Create → Turso* (Marketplace), or create a database at turso.tech. Choose the Frankfurt region (`aws-eu-central-1`) to match `regions: ["fra1"]` in `vercel.json`. Connect it to the project so `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set.
2. **Project** — *Add New → Project → Import* `Rober31/Studio-Mate`. Framework is detected automatically.
3. **Environment variables** (Production):
   - `SETUP_CODE` — any secret phrase; asked once on the first-run screen so nobody else can claim the instance.
   - `CRON_SECRET` — random string; Vercel Cron sends it to `/api/cron/jobs`.
   - `ANTHROPIC_API_KEY` — optional, enables AI drafting.
4. **Deploy**, open the site, and create the studio on `/setup` using the `SETUP_CODE`.

The schema is created automatically on first request. Do not run `npm run seed` against production.

## Production configuration still required

- **Backups**: Turso keeps point-in-time recovery depending on plan; confirm it meets the RPO/RTO in spec §36.
- **Rate limits** are in-memory per server instance; on Vercel they are best-effort. Add a shared store (e.g. Upstash) if abuse appears.
- **AI**: set `ANTHROPIC_API_KEY`. Without it every draft uses the fixed templates (shown honestly in the UI). Provider data policy must be approved (spec D09).
- **Email**: no email provider is wired; invite and reset links are shown to the owner to share.
- **Booking app / Monday connectors**: not built — the app and API access are undecided (D01, INT-02). Data comes in through CSV import with freshness tracking.
- **WhatsApp**: Click-to-Chat only (WA-01). Sending from the platform via WhatsApp Business Platform is a separate phase.
- **Fonts**: Ploni is a commercial font (alefalefalef). Confirm the web licence before deploying publicly.
