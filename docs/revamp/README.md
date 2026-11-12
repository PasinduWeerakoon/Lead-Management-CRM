# Leads Manager v2 revamp

Design documents for the v2 revamp, written before any code changes. Work happens on the `revamp-v2` branch. Everything runs on Vercel. v2 replaces v1 in one switch-over (no long period of running both).

Screen designs: Leads Manager v2 Screens canvas (Artifact, private to Pasindu).

| # | Document | What it answers |
|---|---|---|
| 01 | [Product plan](01-product-plan.md) | Who it's for, the workflow, scope, phases, what "done" means |
| 02 | [Architecture](02-architecture.md) | System diagram, components, hosting, request and job flows |
| 03 | [Data model](03-data-model.md) | MongoDB collections, fields, indexes, retention |
| 04 | [Research pipeline](04-research-pipeline.md) | How company, job, tech and person data is collected, checked, saved and refreshed |
| 05 | [Auth, roles and sharing](05-auth-roles-sharing.md) | Google sign-in, allow list, super admin, profiles, sharing, activity log |
| 06 | [Searches and templates](06-searches-templates.md) | Templates, the search flow, scoring, run history, guardrails |
| 07 | [API](07-api.md) | Endpoints, payloads, errors, permissions |
| 08 | [Migration and rollout](08-migration-rollout.md) | Moving v1 browser data to v2, switch-over steps, rollback |
| 09 | [Decisions](09-decisions.md) | Decisions made so far and their reasons |
| 10 | [Risks and open questions](10-risks-open-questions.md) | What could go wrong and what is still undecided |

## Fixed rules

- LinkedIn, Indeed and Glassdoor are never scraped or automated.
- Every collected fact keeps its source link. A fact without a source is not stored.
- Work related facts only. No home addresses, family, health, politics or personal social accounts.
- AI only judges saved facts. It is never asked to "know" something about a person.
- No real client names in the app's text, examples, tests or docs.
- Secrets live only in environment variables (Vercel or AWS), never in the repo.
