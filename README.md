# Leads

A Clay-style workspace for turning your LinkedIn 1st-degree connections into a filtered, scored lead list.
Everything runs in the browser. Contacts are stored in IndexedDB and never leave the device.

See [PLAN.md](PLAN.md) for the architecture and roadmap.

## Run locally

```bash
npm install
npm run dev
```

Other scripts:

| Script | What it does |
|---|---|
| `npm test` | Unit tests (Vitest): title classifier, CSV parsing, import merge, backup |
| `npm run lint` | ESLint |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run preview` | Serve the build with the same security headers (CSP) as Vercel |

## Deploy to AWS (recommended for the company)

See **[DEPLOY-AWS.md](DEPLOY-AWS.md)**: S3 + CloudFront + one Arm64 Lambda, deployed with one command (`npm run deploy`).

## Company GPT key

Set `OPENAI_API_KEY` (and optionally `AI_DAILY_CAP_USD`, default 10) on the server: in `.env.local` for local development, in Vercel → Settings → Environment Variables, or in the AWS deploy command. The key stays on the server (`/api/ai`); the browser never receives it. Spending stops for the day once the limit is reached and the app shows a notice. On Vercel, set `MONGODB_URI` too if you want the limit counted across all server instances; without it each instance counts on its own.

## Deploy to Vercel

1. Push this folder to a Git repository.
2. In Vercel, **Add New → Project**, import the repository. The Vite preset is detected automatically.
3. Deploy. `vercel.json` adds the SPA rewrite and security headers (CSP, HSTS, no-referrer).

AI and Apollo keys are entered by each user in the app and never stored on the server.

To share data between browsers and people, connect MongoDB Atlas (see **Shared database and profiles** below)
and set `MONGODB_URI`, `MONGODB_DB` and `APP_ACCESS_KEY` under Settings → Environment Variables.

> Vercel's Hobby plan is for personal, non-commercial use. Company use needs Vercel Pro.

## Getting your LinkedIn data

LinkedIn → **Me → Settings & Privacy → Data privacy → Download your data** → tick **Connections** under *Select the data files you're most interested in* — or, if Connections isn't listed for your account, choose **Download larger data archive** (it includes connections) → **Request archive**. The email arrives in ~10 minutes for Connections only, or up to 24 hours for the larger archive; then return to the same page and click **Download archive** and use `Connections.csv` from the zip.
Unzip the archive and import `Connections.csv`. You can also click **Try with sample data** on the Import page.

## What's in Phase 1

- Import wizard: drop a CSV, auto-matched columns, review (new / updated / unchanged / skipped), import.
- Re-import updates LinkedIn details but keeps your status, tags and notes.
- Title classifier: seniority (C-level, VP, Head, Director, Manager, Individual) and function, from the job title.
- Contacts grid: virtual scrolling, sortable columns, search, detail drawer.
- Settings: theme, backup to JSON, restore, delete all data.

## What's in Phase 2

- **Filter builder:** chips you click to edit (field → condition → value), AND/OR connectors you click to flip, and one level of groups for "this AND (that OR other)".
- **Fields:** name, email, location, job title, seniority, function, role tags, company, keywords, keyword pack, status, your tags, source, connected on.
- **Keywords** match whole words in the job title and company ("CTO" never matches "Director"). Matches are highlighted in the grid.
- **Presets:** C-suite, Senior decision-makers, Tech & digital leaders, Dynamics 365 decision-makers, Mentions the Microsoft stack, Connected in the last 2 years.
- **Keyword packs** (Settings): reusable keyword lists. Four starter packs, including Microsoft Dynamics & Power Platform. Editable.
- **Saved views** in the sidebar, with live counts. Unsaved edits are flagged, with "Save changes" or "Save as a new view".
- Unfinished filters (no value yet) are shown dashed and ignored, so they never hide everyone.
- Shortcuts: `/` search, `f` add a filter.
- Backups now include keyword packs and saved views (older backups still restore).

## What's in Phase 3

- **Lead drawer editing:** status, priority (High / Medium / Low), tags, location and notes. Everything saves automatically. Notes save as you pause typing.
- **Move through leads** with the ↑ / ↓ buttons or keys (also `j` / `k`). `S` toggles Shortlisted.
- **Bulk actions:** tick rows (or the header box for everyone shown). A floating bar sets status or priority, adds or removes tags, or exports the selection.
- **Export** to Excel (.xlsx) or CSV, for everyone in the list or just the selection.
  - Brief columns first: Full Name, Job Title, Company, Location, LinkedIn URL, Connection Degree, Skill Match, Company Website, Lead Priority, Reason for Match. Then seniority, function, status, tags, email, connected on, and notes (opt-in).
  - **Skill Match** lists the filter's keywords (or all pack keywords) found as whole words in the title or company.
  - **Reason for Match** is a rule-based sentence built only from the data. Company Website stays empty until enrichment.
  - **Formula-safe:** every cell is plain text, and anything starting with `= + - @` is quote-prefixed, so names or titles can't run as spreadsheet formulas (CSV injection).
  - The .xlsx has a frozen header, filters, clickable LinkedIn links, priority colours, and an "About this export" sheet listing the filters used.
- ExcelJS loads only when you export, so the app stays fast to open.

## What's in Phase 4

- **AI settings** (Settings → AI assistant): paste your own Anthropic API key, then **Test and save**. The test is a free model lookup that spends no tokens.
  - **Remember it:** "Only while this tab is open" (default, safest) or "On this device", encrypted with your passphrase (PBKDF2-SHA256 600k + AES-GCM). A device key is unlocked once per tab.
  - **Model:** Claude Opus 5.5 (default), Sonnet 5.5 or Haiku 5.5, with prices shown. **Effort:** Low (default), Medium or High.
  - **Monthly soft limit** (default $10): spend is estimated from token usage and shown with a progress bar. AI requests pause when the limit is reached.
  - The key goes only to `api.anthropic.com`, straight from the browser. It's never in backups or exports. Removing it deletes it from the browser.
- **Describe-to-filter** (the ✨ box on the contacts page): type who you want. The AI returns ordinary filter chips you can edit, a one-line explanation, and notes on anything your data can't express (industry, company size, most locations). One-click **Undo** restores your previous filters.
  - Only your sentence and the list of fields and keyword packs are sent, never your contacts.
  - The answer must match a strict JSON schema (structured outputs), and every condition is checked against the real fields. Anything invalid is dropped and listed.
  - With Opus and Sonnet, requests use Anthropic's server-side refusal fallback (`fallbacks: "default"`), so a safety-classifier decline is retried on Anthropic's recommended model in the same call. Haiku has no server-side fallback.
- The Anthropic SDK (and ExcelJS) load only when first used.

## Look and feel (Clay-style refresh)

A calm, spreadsheet-like interface: white surfaces, thin borders, near-black text, and one blue for primary actions.

- **Top bar:** breadcrumb (People / view name ▾ with rename, duplicate and delete), with Import and Export on the right.
- **Toolbar:** shown/total count, a columns picker (10/11), filter (with a count badge), sort, and search (`/`). Presets and **Ask AI** sit on the right.
- **Grid:**
  - row numbers that turn into checkboxes on hover
  - full gridlines, and column headers with type icons
  - a completeness row under each header: ✓, a fill meter with %, or a short count such as "63 senior"
  - LinkedIn links shown as dotted URLs
  - status and priority shown as a coloured dot with plain text
- **View tabs** along the bottom (All people plus each saved view, with an unsaved-changes dot), "+ Save view", and a live "44 of 77 people shown" meter.
- **Sidebar:** People and Import, then Setup (Keyword packs and AI assistant, each now its own page), then Settings and a theme toggle.

## What's in Phase 5

- **Score with AI** (toolbar): rate everyone in the current list, or just the selected rows, against a **brief**.
  - A brief describes the offer and the ideal buyer. A Dynamics 365 template is provided. Briefs are saved and reusable.
  - People already scored with the same brief are skipped by default. Up to 500 people per run.
  - Before running you see the number of batches, an **estimated cost range** and this month's spend. Each batch also checks the monthly soft limit.
  - **Progress** shows batch X of Y, people scored and cost so far. **Stop** ends the run and keeps finished batches. Results appear in the table as each batch lands.
- **What's sent:** name, title, company, location, seniority, function and connection year. **Never** email, notes or LinkedIn URL.
  - Batches of 25. The brief and rules sit in a cached system prompt, and answers must follow a strict JSON schema.
- **Evidence, kept honest:**
  - **Confirmed:** exact quotes from the person's title, company or location. The app checks every quote against the data and removes any it can't find (the run summary says how many).
  - **Inferred:** at most three guesses, such as "company likely uses Dynamics 365", clearly marked "check before relying on it".
  - Score 0–100 becomes a priority: 70+ High, 40–69 Medium, under 40 Low.
- **Where results show:**
  - **AI score** and **AI reason** grid columns, with "% scored" in the header.
  - "AI score (high first)" sort, and an "AI priority" filter.
  - An AI card in the lead drawer with "Use as priority".
  - "Use AI priority" in bulk actions.
  - Export: AI Score, Confirmed Evidence and Inferred (verify) columns. Lead Priority falls back to the AI priority, and Reason for Match uses the AI reason.
- **The AI never overwrites your own priority.** It only suggests one.
- People the AI skips are retried once. A declined or unreadable batch is reported without stopping the run, while a bad key, the budget limit or Stop ends it.

## Design system (premium refresh)

- **Type:** Geist (sans) and Geist Mono, self-hosted. A 12 / 13 / 14 px scale, weights 400 / 500 / 600, slight negative tracking, and numbers that line up in columns.
- **Icons:** Tabler (MIT) thin outline icons at a 1.5 stroke, close to Clay's style, wrapped in `src/components/icons.tsx` so every screen uses one set. Column headers use type icons: T for text, # for numbers, link, building, map pin.
- **Colour:** zinc neutrals with a Clay-style bright blue (`#1a6cf5`) for primary buttons (Export, Score with AI), the active view tab, filter counts and the logo. Green and amber only carry meaning (scores, status).
- **Surfaces:** 8 px controls, 12 px panels, 14 px dialogs, and soft layered shadows. The selected sidebar item is a raised white tile, and bulk actions use a dark floating bar.
- **Tokens:** everything is set in `src/app/theme.ts` (antd component tokens plus CSS variables). `npm run format` applies Prettier.

## What's in Phase 6 — company data

- **Company data** (sidebar, or the button after an import): drop any CSV, such as an Apollo, ZoomInfo or Sales Navigator export or your own sheet, to fill in **website, industry, company size and location** for people you already have.
  - Columns are matched automatically (Apollo-style headers such as "Person Linkedin Url", "# Employees" and "City" work) and you can adjust them.
  - People are matched by LinkedIn URL first, then name plus company, then name alone if it's unique. Ambiguous or unknown rows are listed, never guessed.
  - A location you typed yourself is never overwritten. Websites are cleaned to `https://domain`, and `javascript:`, `mailto:`, `data:` or credential-bearing URLs are rejected.
  - **Try sample company data** fills the 77 sample people with fictional `.example` websites and some Boston-area locations.
- **No API keys, server or vendor contract needed.** Data providers usually block browser calls, so CSV is the cheapest route that works with any vendor.
- **Where it shows:**
  - Company Website (link), Industry and Company Size grid columns.
  - Company website, Industry and Company size filters. The Location filter now works for Boston.
  - An editable Company section in the lead drawer.
  - Export: Company Website is filled, and Industry and Company Size columns are added.
  - AI scoring receives industry and size, and can quote them as confirmed evidence.

## AI providers: Anthropic or Groq

**AI assistant → Provider** switches between **Anthropic (Claude)** and **Groq**. Each provider keeps its own key, so switching never loses a key, and the model list follows the provider:

| Provider | Models | Price per M tokens (in / out) |
|---|---|---|
| Anthropic | Claude Opus 5.5 · Sonnet 5.5 · Haiku 5.5 | $4/$20 · $2/$10 · $0.10/$0.50 |
| Groq | **GPT-OSS 120B** (default) · GPT-OSS 20B · Qwen 3.8 27B | $0.15/$0.60 · $0.075/$0.30 · $0.80/$4.00 |

- Groq calls go straight from the browser to `api.groq.com`, which is added to the CSP. They use strict JSON-schema output and the same validation and "confirmed vs inferred" checks as Claude.
- **Development key:** put `VITE_DEV_GROQ_KEY` and `VITE_DEV_GROQ_KEY_EXPIRES=YYYY-MM-DD` in `.env.local` (ignored by git). `npm run dev` then uses it automatically until that date. Production builds never include it.

## Shared database and profiles (MongoDB Atlas)

**Profiles** keep separate LinkedIn networks apart (yours, a colleague's…): each has its own people, AI results,
company HQs, briefs, presets and views. Switch, add, rename or delete profiles from the top of the sidebar.
Settings and API keys are shared by all profiles in a browser and never leave it.

**Shared database.** With `MONGODB_URI` set, every change is saved to MongoDB Atlas in the background and
other browsers receive it (on open, on focus, and every minute). AI results are updated in place — a new run
replaces the old result. The sidebar footer shows the state: *Saved to database*, *Syncing…*,
*Offline — saved here* (sent later), *Access code needed*, or *Stored only in this browser* (no database set up).

Setup:

1. In Atlas, create a cluster (the free M0 tier is enough to start) and a database user.
2. Atlas → Network Access: allow Vercel to connect (Vercel's IPs change, so `0.0.0.0/0` with a strong
   database password is the usual setting; tighten with Vercel's static IPs on paid plans).
3. Set `MONGODB_URI`, `MONGODB_DB` and `APP_ACCESS_KEY` in Vercel (and in `.env.local` to try it locally —
   see `.env.example`). Restart `npm run dev` after editing `.env.local`.
4. Open the app and enter the access code when asked. The first browser to connect uploads its data;
   a browser opening a profile that already has data in the database takes the database's copy.

There's no login: anyone with the app URL **and** the access code can read and change all profiles,
including emails and phone numbers. Share the code only with your team and change it if someone leaves.

How it's stored: one collection per kind of data (`contacts`, `briefs`, `presets`, `views`, `keywordPacks`,
`imports`) plus `profiles`; each document carries its `profileId`. Deleting a profile deletes its data.
