# 10 Risks and open questions

## Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Many people have no public career data | Alumni style searches find fewer people than users expect | High | Data check states coverage before running; "not found" shown honestly; set expectations with users |
| Company websites block bots or need scripts | Missing jobs and tech | Medium | Playwright fallback; ATS feeds; web search fallback |
| Wrong person matched by web search | Wrong career facts | Medium | Identity check needs a matching company or title; confidence shown; users can flag a fact |
| AI cost higher than estimated | Research takes longer | Medium | Daily limit pauses, never fails; pre-filter before AI; company research shared |
| OpenAI web search changes or price rises | Pipeline stops or costs more | Low | Search call isolated in one module (`webSearchCall`), can switch provider |
| Users still expect AI to know everything | Complaints about results | High | Templates only, evidence links, clear empty states, short in-app help |
| Sites object to being read | Legal or reputation | Low | robots.txt respected, rate limited, identifying user agent, public pages only, takedown on request |
| Personal data concerns | Privacy complaints | Low | Work related facts only; source on every fact; delete on request |
| Chromium inside a Vercel function is heavy | Slow jobs or size limit hit | Medium | Plain fetch first; Chromium only when needed; `@sparticuz/chromium` is built for this size limit |
| Vercel plan limits | Worker can't run often enough on Hobby | High if on Hobby | Use Vercel Pro |

## Open questions

| # | Question | Needed by | Owner |
|---|---|---|---|
| Q1 | MongoDB Atlas cluster region and tier | Phase 1 | Pasindu |
| Q2 | ~~Hosting~~ Decided: everything on Vercel (D7) | | |
| Q3 | Google Cloud project for the OAuth client (which account owns it) | Phase 1 | Pasindu |
| Q4 | ~~Apollo~~ Decided: keep, optional (D18) | | |
| Q5 | Which AI model for extraction and scoring (cost versus quality) | Phase 2 | Decide after a test on 50 companies |
| Q6 | ~~Guest access~~ Decided: no guests (D2) | | |
| Q8 | Is the Vercel team on the Pro plan | Phase 2 | Pasindu |
| Q7 | Final list of starting templates and their wording | Phase 4 | Pasindu with users |
