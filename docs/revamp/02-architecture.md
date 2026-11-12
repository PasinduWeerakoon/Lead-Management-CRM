# 02 Architecture

## Overview

```mermaid
flowchart TB
  subgraph Browser
    UI[React 19 + antd 6 SPA]
  end

  subgraph Web["Web host (Vercel today)"]
    API["/api/* functions<br/>auth, profiles, contacts,<br/>searches, admin"]
  end

  subgraph Worker["Research worker (Vercel functions)"]
    Q[(jobs collection<br/>in MongoDB)]
    CRON[Vercel Cron<br/>every minute]
    W[Worker function<br/>company, jobs, tech, person]
    PW[Headless Chromium<br/>for script heavy sites]
  end

  subgraph Data
    DB[(MongoDB Atlas)]
  end

  subgraph External
    G[Google sign-in]
    WS[OpenAI web search]
    AI[AI models<br/>scoring and extraction]
    SITES[Company websites<br/>careers pages, ATS feeds]
    APO[Apollo<br/>optional, contact details]
  end

  UI -->|HTTPS, session cookie| API
  UI -->|Sign in| G
  API --> DB
  API -->|enqueue| Q
  API --> AI
  CRON --> W
  W -->|claim jobs| Q
  W --> PW
  W --> SITES
  W --> WS
  W --> AI
  W --> DB
  API --> APO
```

## Components

| Component | Tech | Responsibility |
|---|---|---|
| Web app | React 19, Vite, antd 6, Geist, Tabler icons | All screens. No direct database access. Keeps a small Dexie cache for fast tables only |
| API | TypeScript functions in `api/`, same handlers on Vercel and the dev server | Sessions, permissions, reads and writes, enqueueing research, running searches, activity log writes |
| Research worker | Vercel function `api/worker.ts`, started by Vercel Cron every minute (and kicked right after an import) | Claims jobs from the `jobs` collection, works for up to about 4 minutes, then stops. One job is one company or one person, so each is short and retried on its own |
| Headless browser | `playwright-core` with `@sparticuz/chromium` inside the worker function | Only for sites whose content appears after scripts run. Plain fetch is tried first |
| Scheduler | Vercel Cron, hourly | Finds facts past their refresh date and adds jobs |
| Database | MongoDB Atlas (region to be confirmed) | Users, profiles, contacts, companies, facts, searches, runs, templates, activity, spend |
| AI | OpenAI Responses with `web_search` for finding pages; a model for extraction and scoring | Company key on the server. Users no longer paste their own key |

### Why a queue, all on Vercel

Everything runs on Vercel (decision D7). A single function can't research 1,000+ companies because functions stop after a few minutes. So the work is split into small jobs saved in a MongoDB `jobs` collection. Every minute Vercel Cron starts the worker function, which claims a few jobs, runs them, and stops before its time limit. Failed jobs are retried, and jobs pause at the AI limit and continue the next day.

Requirements:
- **Vercel Pro plan.** Hobby only allows cron once a day and shorter functions
- Worker function `maxDuration` 300 seconds, memory 2 GB (for Chromium)
- Cron calls carry `CRON_SECRET`, so nobody else can start the worker
- The AWS files (`infra/`, `lambda/`, `DEPLOY-AWS.md`) are not used by v2 and can be removed at switch-over

## Main flows

### Sign in

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant G as Google
  participant D as MongoDB
  B->>G: Google sign-in (OAuth, PKCE)
  G-->>B: ID token
  B->>A: POST /api/auth/google {idToken}
  A->>G: Verify token signature and audience
  A->>D: Check allow list, upsert user
  A->>D: Write activity: signed in
  A-->>B: Set httpOnly session cookie
```

### Import and automatic research

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant D as MongoDB
  participant Q as jobs collection
  participant W as Worker
  B->>A: POST /api/profiles/:id/imports (parsed CSV rows)
  A->>D: Upsert contacts, link or create companies
  A->>Q: Add company jobs (new or stale companies only)
  A->>Q: Add person jobs
  A->>W: Kick the worker (no wait)
  A-->>B: Import summary
  W->>Q: Claim company job
  W->>W: Find site, read pages, jobs, tech
  W->>D: Save facts with sources, mark company researched
  W->>Q: Claim person job (after its company)
  W->>D: Save career and mention facts
  B->>A: GET /api/research/status (polls every 10 s)
```

### Search

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant D as MongoDB
  participant M as AI model
  B->>A: POST /api/searches/:id/runs
  A->>D: Load template version, contacts, saved facts
  A->>A: Data check and free pre-filter
  A->>M: Score remaining people in batches, facts only
  M-->>A: Rating, score, reason, cited fact ids
  A->>A: Drop reasons that cite no saved fact
  A->>D: Save run and results, compare with previous run
  A-->>B: Run id, then results
```

Long searches run as a worker job too, using the same queue, when the candidate count after pre-filtering is above 300.

## Environments

| Environment | Web and API | Worker | Database |
|---|---|---|---|
| Local | `npm run dev` | `npm run worker` loop | `leads_dev` |
| Preview | Vercel preview of `revamp-v2` | Same deployment, cron off; started by hand | `leads_staging` |
| Production | Vercel production | Same deployment, cron on | `leads` |

## Security

- Session: signed, httpOnly, Secure, SameSite=Lax cookie, 14 day expiry, renewed on use
- Every API call checks the session, then the user's role on the profile involved
- CSRF: SameSite cookie plus a required `X-Requested-With` header on writes
- Worker endpoint only runs with the `CRON_SECRET` header
- Outbound fetches: blocked list (LinkedIn, Indeed, Glassdoor, private IP ranges), 10 s timeout, 2 MB page limit, robots.txt respected
- Secrets: `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `OPENAI_API_KEY`, `APOLLO_API_KEY` in environment variables only
