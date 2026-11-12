# 08 Migration and rollout

## Where v1 data lives

v1 stores everything in each user's browser (Dexie / IndexedDB): contacts, imports, keyword packs, views, briefs, presets, score runs. Some users also used the optional MongoDB sync (`api/_db.ts`, `SYNCED_TABLES`). Nobody else can see a user's v1 data, so each user must move their own.

## Moving v1 data

1. v2 adds a one-time screen: "Bring your v1 data". It shows only while the browser still has v1 data
2. The browser reads its local Dexie tables and sends them to `POST /api/migrate/v1` in pages
3. The server creates one profile per v1 profile, owned by the signed in user, and maps:

| v1 | v2 |
|---|---|
| contacts | contacts, plus persons and companies (merged by key) |
| contact company research fields | facts with `sourceKind: 'site'` or `'search'`, only those with a source URL |
| contact status, notes, tags | same fields on contacts |
| scoreRuns | searches (with a "v1 prompt" template) and runs, read only |
| keywordPacks, presets, views | dropped (replaced by templates); listed in the migration summary |
| briefs | kept as notes on the search |

4. A summary shows what moved and what was dropped. Local data is left in place for 30 days, then the app offers to clear it

Migration is idempotent: running it twice doesn't create duplicates (keys are v1 ids).

## Rollout steps

| Step | Action | Check |
|---|---|---|
| 1 | Deploy `revamp-v2` to a Vercel preview with the staging database (worker started by hand) | Pasindu signs in, imports a test export |
| 2 | Run research on the test profile | Coverage numbers match [04](04-research-pipeline.md) targets |
| 3 | Pilot with 2 users on staging | They complete the CTP style search end to end |
| 4 | Create production database, set env vars, turn on cron (Vercel Pro) | Health check passes, worker runs every minute |
| 5 | Merge `revamp-v2` into `main`, production deploy | Sign in works on the live URL |
| 6 | Users move their v1 data | Activity log shows each migration |
| 7 | After one week with no blocking bug, remove v1 only code and the unused AWS files | |

## Rollback

- Before step 6: redeploy the previous `main` commit. Nothing is lost because v1 data is still in browsers
- After step 6: same, since v1 local data is kept for 30 days. v2 data stays in MongoDB for a later retry

## Environment variables (new)

| Name | Where |
|---|---|
| `GOOGLE_CLIENT_ID` | web, API |
| `SESSION_SECRET` | API |
| `SUPERADMIN_EMAIL` | API |
| `ALLOWED_DOMAIN` (`1billiontech.com`) | API |
| `MONGODB_URI`, `MONGODB_DB` | API, worker |
| `OPENAI_API_KEY` | API, worker |
| `CRON_SECRET` | worker |
| `AI_DAILY_CAP_USD` (existing, default 10) | API, worker |
| `APOLLO_API_KEY` (optional) | API |
