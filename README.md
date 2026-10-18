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
| Database | SQLite (WAL) via `better-sqlite3` — relational constraints and atomic transactions; schema in `src/server/schema.sql` |
| Auth | Email + password (scrypt), HttpOnly session cookies, invitations, owner-issued reset links, session revocation |
| Authorization | Deny-by-default role matrix (`src/server/permissions.ts`), enforced on the server for every request; studio always derived from the session |
| AI | Anthropic API, server-side only; structured output validated on the server; safe fixed templates on any failure |
| Jobs | In-process scheduler (`src/instrumentation.ts`): rule evaluation every 15 min + token cleanup |

```
src/server/services/   contacts · memberships · followups (rules R01–R07) · drafts · ai · tasks
                       attendance (sessions, QR, deductions) · public (registration, member identity)
                       imports · reports · team
src/app/(app)/         staff screens (S02–S07, S10–S14)
src/app/s/, src/app/m/ public member pages (S08, S09, activation)
src/app/api/           REST endpoints (API-01 contract: data/meta, error codes, Idempotency-Key)
```

Key guarantees covered by tests: one suggestion per event key, single deduction per attendance and single reversal, idempotent imports and balance adjustments, do-not-contact enforced before draft and handoff, facts re-checked before opening WhatsApp, tenant isolation.

## Production configuration still required

- **Hosting**: a Node server with a persistent disk for `DATABASE_PATH`, HTTPS, and daily encrypted backups (spec §36). Not serverless (SQLite file + in-process jobs).
- **AI**: set `ANTHROPIC_API_KEY`. Without it every draft uses the fixed templates (shown honestly in the UI). Provider data policy must be approved (spec D09).
- **Email**: no email provider is wired; invite and reset links are shown to the owner to share.
- **Booking app / Monday connectors**: not built — the app and API access are undecided (D01, INT-02). Data comes in through CSV import with freshness tracking.
- **WhatsApp**: Click-to-Chat only (WA-01). Sending from the platform via WhatsApp Business Platform is a separate phase.
- **Fonts**: Ploni is a commercial font (alefalefalef). Confirm the web licence before deploying publicly.
