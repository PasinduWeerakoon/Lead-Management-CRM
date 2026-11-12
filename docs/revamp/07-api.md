# 07 API

All endpoints are under `/api`, take and return JSON, and need a session unless marked public. Writes need the header `X-Requested-With: leads`.

Errors: `{ "error": { "code": "not_allowed", "message": "..." } }` with status 400, 401, 404, 409, 429 or 500. Admin routes return 404 to non admins.

## Auth
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/google` | public | Exchange Google ID token for a session |
| POST | `/auth/signout` | any | End session |
| GET | `/me` | any | Current user, role, AI remaining today |

## Profiles and sharing
| Method | Path | Who |
|---|---|---|
| GET | `/profiles` | any (own and shared with them) |
| POST | `/profiles` | any |
| PATCH | `/profiles/:id` | owner |
| DELETE | `/profiles/:id` | owner |
| GET | `/profiles/:id/shares` | owner |
| PUT | `/profiles/:id/shares/:email` `{access}` | owner |
| DELETE | `/profiles/:id/shares/:email` | owner |

## Contacts and imports
| Method | Path | Who |
|---|---|---|
| POST | `/profiles/:id/imports` `{rows[]}` | owner, editor |
| GET | `/profiles/:id/contacts?filter&cursor&limit` | any member |
| PATCH | `/profiles/:id/contacts` `{ids[], status?, tags?}` | owner, editor |
| POST | `/profiles/:id/contacts/:cid/notes` | owner, editor |
| GET | `/profiles/:id/contacts/:cid/research` | any member (person and company facts with sources) |
| POST | `/profiles/:id/export` | any member |

CSV parsing stays in the browser (existing `csv.worker.ts`), which sends clean rows in pages of 500.

## Research
| Method | Path | Who |
|---|---|---|
| GET | `/profiles/:id/research/status` | any member (counts, running, paused, cost so far) |
| POST | `/profiles/:id/research` `{scope: 'missing' \| 'all', kinds[]}` | owner, editor |
| POST | `/research/refresh` `{subject}` | owner, editor (once per day per subject) |

## Templates and searches
| Method | Path | Who |
|---|---|---|
| GET | `/templates` | any |
| POST | `/templates`, PUT `/templates/:id` (new version) | super admin |
| GET | `/profiles/:id/searches` | any member |
| POST | `/profiles/:id/searches` | owner, editor |
| POST | `/searches/:id/check` | any member (data check and cost estimate, no cost) |
| POST | `/searches/:id/runs` | owner, editor |
| GET | `/searches/:id/runs` | any member |
| GET | `/runs/:id/results?rating&change` | any member |

## Admin (super admin only, 404 for others)
| Method | Path |
|---|---|
| GET, POST, DELETE | `/admin/allow-list` |
| GET | `/admin/users` |
| PATCH | `/admin/users/:id` `{status}` |
| GET, PUT | `/admin/ai-limit` |
| GET | `/admin/jobs` (queue status, failed jobs) |
| GET | `/admin/spend?from&to` |
| GET | `/admin/activity?user&action&from&to&q&cursor` |
| GET | `/admin/activity.csv` |

## Worker
| Method | Path | Who |
|---|---|---|
| GET | `/worker` | Vercel Cron only (`Authorization: Bearer CRON_SECRET`) |
| GET | `/worker/refresh` | Vercel Cron only, hourly: adds jobs for facts due a refresh |

## Rate limits
- 60 writes a minute per user
- 1 search run in progress per search
- Research start: once per 10 minutes per profile
