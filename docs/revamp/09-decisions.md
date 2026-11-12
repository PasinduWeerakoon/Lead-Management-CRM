# 09 Decisions

| # | Decision | Reason | Status |
|---|---|---|---|
| D1 | Google sign-in only, no passwords | Everyone has a company Google account; nothing to store or reset | Agreed |
| D2 | Company domain only, no guests. The super admin may allow a single outside Google email, who becomes a normal user | Every user signs in with Google so all data and activity is tied to a person | Agreed |
| D3 | One super admin (Pasindu), everyone else is a user | Simple, no role management UI to secure | Agreed |
| D4 | Admin areas invisible to users, admin endpoints return 404 | Users shouldn't see admin details or know they exist | Agreed |
| D5 | Profiles owned per user, shared as Editor or Viewer, never merged | Each person keeps their own network clean | Agreed |
| D6 | Templates shared by all, versioned, managed by the super admin | Consistent searches; old runs stay reproducible | Agreed |
| D7 | Everything on Vercel. Research runs as small jobs in a MongoDB `jobs` collection, worked by a cron started function | One platform to run; needs Vercel Pro for minute cron and longer functions | Agreed |
| D8 | Company and person research is shared across profiles | Public business data; researching a company once is much cheaper | Proposed |
| D9 | Web search and public pages only for job and company data, no paid job data provider | Chosen by Pasindu; keeps cost low | Agreed |
| D10 | Never scrape LinkedIn, Indeed or Glassdoor | Their terms forbid it and accounts or IPs get blocked | Agreed |
| D11 | AI only judges saved facts and must cite fact ids | Stops made up results; every reason is checkable | Proposed |
| D12 | One organisation AI limit of $10 a day, shown per person | Chosen by Pasindu | Agreed |
| D13 | Company AI key on the server, users no longer bring their own | Needed for background research and the shared limit | Proposed |
| D14 | MongoDB Atlas as the main store | Already used for sync in v1 | Agreed, region pending |
| D15 | v2 replaces v1 in one switch-over | Chosen by Pasindu | Agreed |
| D16 | Email features later through a `notify()` hook | Keep v2 scope small, leave room to add | Agreed |
| D18 | Apollo kept, optional, only when a key is set | Emails and phones only from a licensed source | Agreed |
| D17 | No commits during the documents phase | Requested by Pasindu | Agreed |
