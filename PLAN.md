# Leads Management — Architecture & Plan

A Clay-style workspace for turning your LinkedIn **1st-degree connections** into a filtered, scored lead list, without a heavy backend.

> Status: **Phases 0–6 built** (import, grid, filters, presets, keyword packs, saved views, lead editing, bulk actions, export, own-key AI, describe-to-filter, AI scoring, CSV company-data enrichment) with a premium Clay-style UI. Phase 7 (optional team mode) remains.
> Revision 2: **Vercel + React + Ant Design**, and **bring-your-own AI API key**.

---

## 1. Goals and non-goals

**Goals**
- Import your LinkedIn connections and view them in a fast, spreadsheet-like grid.
- **Filters first.** Build filters from chips (title, seniority, company, keywords and more) with no prompt needed.
- **AI as an extra.** Optionally type what you want in plain words, and the AI turns it into editable filters or scores the leads.
- **Bring your own AI key.** Each user pastes their own API key in Settings, so AI usage is billed to their own account.
- Show the details that matter for each lead (priority, reason, evidence) and export to `.xlsx`.
- **Near-zero running cost:** a static site on Vercel, with no servers or database to pay for.
- A friendly, well-structured UI that feels human, in the style of Clay.

**Non-goals (by design)**
- The app never logs in to LinkedIn, scrapes it or automates it. Doing so breaks LinkedIn's User Agreement and risks a ban; see hiQ v. LinkedIn (2022) and the Proxycurl shutdown (2025).
- No 2nd-degree crawling. 2nd-degree prospects come from Sales Navigator, searched by a person, and can be pasted or imported.

---

## 2. Where the data comes from

| Source | How | What you get |
|---|---|---|
| LinkedIn data export | *Settings → Data privacy → Get a copy of your data → Connections* → `Connections.csv` | First/last name, profile URL (usually), email (mostly blank), company, position, connected-on date |
| Manual / Sales Navigator | Paste rows or upload a CSV in the same shape | Same columns, marked `source: manual` |
| Enrichment (optional, Phase 6) | Apollo / People Data Labs, also with your own key | Location, industry, company website, company size, skills |

> **Important limitation:** `Connections.csv` has **no location, industry or skills**. Location filters (such as *Greater Boston*) work only after enrichment, or after you set the location by hand. The UI shows these fields as "unknown" and never guesses them silently.

---

## 3. Architecture

```
┌──────────────────────────── Browser (the whole app) ─────────────────────────────┐
│                                                                                  │
│  React + Vite + TypeScript SPA  ·  Ant Design                                    │
│                                                                                  │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────────────────────┐  │
│  │ CSV import   │──▶│ Normaliser +     │──▶│ IndexedDB (Dexie)                │  │
│  │ (PapaParse,  │   │ title classifier │   │ contacts · views · briefs ·      │  │
│  │  Web Worker) │   │ (rules, no AI)   │   │ ai_results · settings · 🔒key    │  │
│  └──────────────┘   └──────────────────┘   └───────────────┬──────────────────┘  │
│                                                            │                     │
│  ┌──────────────────────────────┐   ┌──────────────────────▼─────────────────┐   │
│  │ Filter engine (pure TS)      │◀──│ antd Table (virtual) · Lead Drawer     │   │
│  │ AND/OR groups, operators,    │   │ Saved views · Export (.xlsx, safe)     │   │
│  │ keyword packs, presets       │   └──────────────────────┬─────────────────┘   │
│  └──────────────────────────────┘                          │                     │
│                                    ┌───────────────────────▼─────────────────┐   │
│                                    │ AI client (provider adapter)            │   │
│                                    │ uses the user's own key from Settings   │   │
│                                    └───────────────────────┬─────────────────┘   │
└────────────────────────────────────────────────────────────┼─────────────────────┘
                                                             │ HTTPS, direct
                                                             │ (only when AI is used)
                                                     ┌───────▼────────┐
                                                     │  Claude API    │  (others later)
                                                     └────────────────┘

  Hosting: Vercel (static build, no server code needed)
  Optional later: Vercel Functions for a shared "team key" mode or enrichment proxy
```

### Why this shape
- **Local-first.** The contact list lives in the browser (IndexedDB). There is no database to pay for or secure, and filtering 5,000–30,000 rows in memory takes milliseconds.
- **No backend needed in v1.** Each user's own key is used straight from the browser. Anthropic allows browser calls through the SDK's `dangerouslyAllowBrowser` option, which is meant for exactly this bring-your-own-key case. Vercel only serves static files.
- **No server-side secrets, so nothing to steal or abuse.** The site holds no key and no data, so it doesn't need login protection to prevent cost abuse.
- **Upgrade path.** Add Vercel Functions later for a **team key** (your company key stored as a Vercel environment variable and used through `/api/ai`) or for enrichment. Add Vercel Postgres/Neon or Supabase if a team needs to share one list (Phase 7).

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | React + Vite + TypeScript | Fast, simple static build that deploys to Vercel with no config |
| UI kit | **Ant Design (antd, latest major)** + `@ant-design/icons` | Rich components (Table, Drawer, Select, Tag, Form, Modal, Steps, Empty), theming via `ConfigProvider` tokens |
| Grid | antd `Table` with `virtual` and a sticky first column | Spreadsheet feel; virtual scrolling handles thousands of rows |
| Motion | Framer Motion (light use) | Gentle transitions on top of antd's built-in motion |
| State | Zustand | Tiny, no boilerplate |
| Local DB | Dexie (IndexedDB) | Persistent and indexed; survives reloads |
| CSV / Excel | PapaParse · ExcelJS | Parsing in a Web Worker; styled `.xlsx` export |
| Validation | Zod | One schema for CSV rows, filters and AI output |
| AI | `@anthropic-ai/sdk` in the browser, behind a small `AiProvider` interface | Bring your own key; other providers can be added later |
| Hosting | **Vercel** | Git push to deploy, preview URL per branch |

**antd theme for a Clay-like feel:** set `ConfigProvider` tokens (`borderRadius: 10`, `fontFamily: Inter`, `colorPrimary` a calm indigo, `colorBgLayout` an off-white), compact `Table` size, `Tag` pills for status and priority, and a dark theme via `theme.darkAlgorithm`.

---

## 5. Data model (IndexedDB)

```ts
Contact {
  id: string                    // hash(profileUrl || name+company)
  firstName, lastName, fullName: string
  profileUrl?: string
  email?: string
  company?: string
  position?: string
  connectedOn?: string          // ISO date
  source: 'linkedin_export' | 'manual' | 'sales_nav'
  importedAt: string

  // derived locally by rules (no AI, free, instant)
  seniority: 'C-level' | 'VP' | 'Director' | 'Head' | 'Manager' | 'IC' | 'Unknown'
  function:  'Technology' | 'Operations' | 'Digital' | 'Executive' | 'Finance' | 'Sales' | 'Other'
  titleTags: string[]           // e.g. ['CTO', 'IT Director']

  // user-owned
  status: 'new' | 'shortlisted' | 'contacted' | 'not_a_fit'
  tags: string[]
  notes?: string
  location?: { value: string, origin: 'manual' | 'enriched' }

  // optional enrichment (Phase 6), each field carries its source
  enrichment?: { location?, industry?, website?, companySize?, skills?: string[],
                 vendor: string, fetchedAt: string }
}

AiResult {                       // one per contact per brief
  contactId, briefId: string
  priority: 'High' | 'Medium' | 'Low'
  score: number                 // 0–100
  reason: string                // 1–2 sentences, human-readable
  confirmed: string[]           // evidence found in the person's own data
  inferred: string[]            // company-level guesses, labelled as such
  model: string, createdAt: string
}

AiSettings {                     // stored separately, never exported or backed up
  provider: 'anthropic'          // adapter allows more later
  model: string                  // e.g. 'claude-opus-5-5'
  keyStorage: 'session' | 'device-encrypted'
  encryptedKey?: ArrayBuffer     // AES-GCM, key derived from a passphrase (PBKDF2)
  monthlySoftLimitUsd?: number   // local usage guard
}

SavedView { id, name, filter: FilterGroup, columns: string[], sort }
Brief     { id, name, text, filter?: FilterGroup }   // reusable AI briefs, e.g. "Boston D365"
```

---

## 6. Filters (the core feature, no AI needed)

**Filter builder** (works like Clay or Notion, built from antd `Select`, `Tag` and `Popover`):
```
Where  [Seniority ▾]  [is any of ▾]  [C-level] [VP] [Director] [x]
And    [Position  ▾]  [contains any ▾] [Dynamics] [D365] [Power Platform]
And    [Company   ▾]  [is not ▾]      [Microsoft]
Or-group …
```

- **Fields:** name, position, company, seniority, function, title tags, keywords (position + company), connected-on (before/after/within), status, tags, location*, industry*, website*, AI priority*. Fields marked * appear once that data exists.
- **Operators:** is / is not / is any of / contains / contains any / does not contain / is empty / is not empty / before / after.
- **AND/OR groups**, one level deep. Keeping it to one level keeps the UI friendly.
- **Presets** are one-click starting points: *C-suite*, *Tech decision-makers*, *Microsoft stack keywords*, *Connected in last 2 years*.
- **Keyword packs** are reusable lists, e.g. the "Microsoft Dynamics" pack: D365, Dynamics CRM, Power Apps, Power BI, Dataverse, Azure… Matching ignores case and handles word boundaries (so "CTO" doesn't match "Director").
- **Saved views** store filters, columns and sort, and appear in the left sidebar.
- **Title classifier:** a rules dictionary with about 150 patterns (`/\b(chief|c)[ -]?(technology|tech)\b|\bCTO\b/` → C-level + Technology). It's deterministic, free and testable. Unknown titles go into an "Unclassified" bucket that you can fix by hand.

---

## 7. AI features (optional, with your own key)

The AI never touches data the user can't see, and it never silently filters. If no key is set, the AI buttons show a friendly "Add your API key in Settings to unlock AI" prompt, and the rest of the app works fully.

### 7a. Settings → AI key (bring your own key)
```
┌ AI settings ─────────────────────────────────────────────┐
│ Provider   [ Anthropic (Claude) ▾ ]                      │
│ API key    [ sk-ant-••••••••••••3f9a ]  [Test] [Remove]  │
│ Model      [ Claude Opus 5.5 ▾ ]   effort [ low ▾ ]      │
│ Remember   (•) This session only                         │
│            ( ) On this device, encrypted with passphrase │
│ Soft limit [ $10 / month ]  · used so far: $0.42         │
│ ⓘ Tip: create a dedicated key with a spend limit in the  │
│   Anthropic Console.                                     │
└──────────────────────────────────────────────────────────┘
```
- **Test** sends one tiny request and reports ✅ or a clear error (invalid key, no credit, rate limited).
- **Session only (default):** the key stays in memory and `sessionStorage`, and is gone when the tab closes.
- **On this device:** the key is encrypted with WebCrypto AES-GCM using a key derived from a passphrase you type (PBKDF2). It's never saved in plain text.
- The key is **never** included in backups or exports, never logged, and only ever sent to `api.anthropic.com`.
- A **provider adapter** (`AiProvider.generateFilters()`, `AiProvider.scoreLeads()`) keeps the code ready for other providers later.

### 7b. "Describe it" → filters
The user types *"CIOs and IT directors who mention Dynamics or Power Platform"*. Claude returns the `FilterGroup` JSON through structured outputs, and it shows up as **ordinary filter chips** the user can see and edit. Sends **no contact data**, only the sentence plus the list of available fields.

### 7c. AI scoring column (Clay's "AI column")
- Runs **only on the currently filtered rows**, so you score 120 rows, not 5,000.
- Sends only the minimal fields: name, position, company, and enrichment if present. Never emails or notes.
- Sends batches of about 25 rows per request. The brief and rubric form a cached system prompt (prompt caching), and the output must match a strict schema → `AiResult[]`. A progress bar shows "Scoring 3 of 5 batches…" with a Cancel button.
- **Cost preview before every run:** "Score 120 leads ≈ $0.0X on your key — Run".
- Each result's `confirmed` items must quote text from the input. A post-check drops any claim it can't find there, which enforces the brief's "do not fabricate" rule in code.

### 7d. Model choice (a setting you can change)
| Model | ID | $/1M in · out | Fit |
|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | $4 · $20 | Best judgement for scoring and reasons. Run at `effort: low` |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 · $10 | Strong middle ground |
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 · $0.50 | Cheapest. Likely enough for prompt → filters |

---

## 8. UI / UX (Clay-style, human-friendly, built with antd)

```
┌────────────┬───────────────────────────────────────────────────────────────┐
│ ◉ Leads    │  All connections · 2,341        [Search…]   [Import] [Export] │
│            ├───────────────────────────────────────────────────────────────┤
│ VIEWS      │  Filters: (C-level ×) (Tech ×) (+ Dynamics pack ×)  + Add     │
│  All       │  ✨ Describe what you want…                  [Score with AI]  │
│  ★ Boston  ├───┬──────────────────┬──────────────┬─────────┬──────┬───────┤
│  ★ D365    │ ☐ │ Name             │ Title        │ Company │ Prio │ Status│
│            │ ☐ │ (JD) Jane Doe    │ CIO          │ Acme    │ ●High│ New   │
│ BRIEFS     │ ☐ │ (MK) Mark Kim    │ IT Director  │ Contoso │ ●Med │ Short…│
│  Boston D365│ … virtual rows, sticky name column, resizable columns        │
│            │                                                               │
│ ⚙ Settings │                                    ┌── Lead Drawer ─────────┐ │
└────────────┴────────────────────────────────────│ Jane Doe · CIO, Acme   │─┘
                                                  │ [LinkedIn ↗] [Website] │
                                                  │ Why a match (AI)       │
                                                  │ ✔ Confirmed  ~ Inferred│
                                                  │ Status · Tags · Notes  │
                                                  └────────────────────────┘
```

**antd building blocks:** `Layout.Sider` (views, briefs, settings), `Table` (virtual), `Drawer` (lead detail), `Steps` + `Upload.Dragger` (import wizard), `Select`/`Tag`/`Popover` (filter chips), `Avatar` (initials), `Badge`/`Tag` (priority and status), `Progress` (AI runs), `Modal` (cost preview), `Empty` (empty states), `message`/`notification` (feedback).

**What makes it feel human**
- **Guided first run:** a 3-step empty state ("1. Download your LinkedIn export → 2. Drop the file here → 3. Pick a starter view").
- **Plain language:** labels like "Who are you looking for?" and "Why they match" instead of "Query" and "Rationale".
- **Avatars with initials**, soft colour per company, rounded pill tags for priority and status.
- **Instant feedback:** the row count animates as filters change, chips slide in, and the drawer springs open.
- **Keyboard first:** `/` search, `f` add filter, `↑↓` move between rows, `Enter` open lead, `s` shortlist.
- **Honest data:** unknown fields show a muted "Unknown" (never blank), and inferred values get a dotted underline with a tooltip "Inferred from company data".
- **Light and dark** theme, responsive down to tablet.

---

## 9. Security

| Risk | Mitigation |
|---|---|
| **API key theft from the browser** | Session-only by default. The "remember" option is AES-GCM encrypted with a passphrase. Strict CSP (`connect-src 'self' https://api.anthropic.com`) so no other host can receive data. No third-party scripts, analytics or CDNs. Recommend a dedicated key with a spend limit in the Anthropic Console. |
| Key leaking via backups or logs | `AiSettings` excluded from backup/export. Key never logged, and errors are scrubbed before display. |
| Runaway AI spend | Cost preview before each run, a local monthly soft limit, batch caps (e.g. max 500 rows per run), Cancel button. |
| Contact data leaving the device | Local-first. Only the minimal fields go to the AI provider, and only when you press an AI button. |
| Prompt injection via profile text | Profile data sent as delimited data, never as instructions. No tools given to the model. Strict output schema. Results validated with Zod. You review before export. |
| AI hallucination | URLs and websites never come from the AI. `confirmed` claims must quote the input or they're dropped. Confirmed and inferred are labelled separately. |
| Formula injection in export | Escape cells starting with `= + - @ \t \r`. Write all cells as text type. |
| Malicious or huge CSV | Size cap (e.g. 20 MB), parsing in a Web Worker, column whitelist, Zod row validation, rejected rows shown to the user. |
| Data loss (browser cleared) | One-click **Backup / Restore** (JSON, without the key). Reminder after import. |
| XSS (the main way a stored key could be stolen) | React escaping, no `dangerouslySetInnerHTML`, CSP + security headers via `vercel.json`, dependencies pinned and audited (`npm audit` in CI). |
| Privacy and compliance | Data stays local. A "Delete all data" button. Outreach follows CAN-SPAM and honours opt-outs. GDPR applies if EU contacts are present. |

---

## 10. Cost estimate

| Item | Monthly |
|---|---|
| Vercel hosting (static) | **$0 on Hobby**. ⚠️ Vercel Hobby is for **personal, non-commercial use only**. Company use needs **Pro (~$20 per member per month)**. Confirm which applies. |
| AI usage | Billed to **each user's own key**. Prompt → filters costs fractions of a cent. Scoring 500 leads costs low single-digit dollars or less, depending on model. |
| Enrichment (optional) | Vendor plan, roughly $0–$100+. Off by default |
| **Typical total for the app owner** | **$0 (personal) or ~$20 (Vercel Pro, commercial)** |

---

## 11. Project structure

```
leeds_management/
├─ PLAN.md
├─ package.json
├─ vite.config.ts
├─ vercel.json                  # SPA rewrites + security headers (CSP)
├─ src/
│  ├─ app/                      # App shell, antd ConfigProvider theme, routes
│  ├─ features/
│  │  ├─ import/                # Upload.Dragger, column mapping, Web Worker parser
│  │  ├─ grid/                  # antd Table config, columns, cell renderers
│  │  ├─ filters/               # builder UI + engine + presets + keyword packs
│  │  ├─ lead-drawer/
│  │  ├─ ai/                    # describe-to-filter, scoring column, cost preview
│  │  ├─ settings/              # AI key, model, limits, backup/restore, delete all
│  │  └─ export/
│  ├─ lib/
│  │  ├─ db.ts                  # Dexie schema
│  │  ├─ classify-title.ts
│  │  ├─ filter-engine.ts
│  │  ├─ crypto.ts              # WebCrypto key encryption
│  │  ├─ ai/
│  │  │  ├─ provider.ts         # AiProvider interface
│  │  │  └─ anthropic.ts        # Claude implementation (browser, own key)
│  │  └─ schemas.ts             # Zod: Contact, FilterGroup, AiResult
│  └─ components/               # shared UI pieces
├─ api/                         # (later, optional) Vercel Functions: team key, enrichment
└─ tests/                       # Vitest: classifier, filter engine, export escaping
```

---

## 12. Delivery plan

| Phase | Scope | Done when |
|---|---|---|
| **0. Setup** | Vite + React + TS + antd theme, ESLint/Prettier, Vitest, `vercel.json` with CSP, Vercel deploy | Empty app shell is live on Vercel |
| **1. Import + grid** | Import wizard, column mapping, Dexie storage, virtual antd Table, search, backup/restore | Your real `Connections.csv` loads and scrolls smoothly |
| **2. Filters** | Title classifier, filter builder, presets, keyword packs, saved views, unit tests | "C-level + Microsoft keywords" view works with no AI |
| **3. Lead workflow** | Lead drawer, status/tags/notes, bulk actions, formula-safe `.xlsx` export with your spreadsheet columns | Exported file matches your sample output |
| **4. AI settings + AI → filters** | Settings page (key, test, model, storage mode, soft limit), provider adapter, describe-to-filter | Your own key works and a sentence becomes correct chips |
| **5. AI scoring** | Batching, caching, cost preview, progress/cancel, confirmed/inferred evidence, anti-fabrication post-check | 100 leads scored with reasons you'd trust |
| **6. Enrichment (opt.)** | Your own Apollo or PDL key in Settings, per-field source, location/industry/website filters | Boston filter works on enriched rows |
| **7. Team mode (opt.)** | Vercel Functions + shared DB, team key in a Vercel environment variable, login, shared views | Two people work on one list with a company key |

Phases 1–3 alone give you a useful, $0 tool. AI and enrichment are layered on top.

---

## 13. Decisions

| # | Decision | Status |
|---|---|---|
| 1 | Hosting | ✅ Vercel |
| 2 | UI stack | ✅ React + Ant Design |
| 3 | AI key | ✅ Bring your own key (Settings), browser-direct |
| 4 | Single user or team? | ❓ Decides whether Phase 7 is needed |
| 5 | Vercel plan | ❓ Hobby (personal) vs Pro (company/commercial use) |
| 6 | Default AI model | ❓ Opus 5.5 at low effort vs Sonnet/Haiku. Measure in Phase 4 |
| 7 | Other AI providers (e.g. OpenAI, Gemini)? | ❓ The adapter is ready; add only if needed |
| 8 | Enrichment vendor and budget | ❓ Needed only for location, industry and website filters |
