# Deploying Leads to AWS

Lowest-cost setup: the web app is static files in a private **S3** bucket served by **CloudFront**, and every `/api/*` route runs in **one Arm64 Lambda** behind a **Function URL** that only CloudFront can call. No API Gateway, VPC, NAT gateway or always-on server.

```
Browser ──► CloudFront ──┬─► S3 (web app, private)
                         └─► /api/*  ──► Lambda (Node.js 22, Arm64, 512 MB, 60 s)
                                           ├─► company websites + job boards
                                           ├─► Apollo (your key)
                                           └─► MongoDB Atlas (optional)
AI providers (Claude, GPT, Gemini, Groq, OpenRouter) are called straight from the browser with each user's key.
```

## What it costs

At an internal team's usage, expect **about $0–5 a month**:

| Service | Usage | Cost |
|---|---|---|
| Lambda (Arm64) | Thousands of requests a month | Within the always-free tier (1M requests, 400,000 GB-seconds) |
| CloudFront | A few GB a month | Within the always-free tier (1 TB, 10M requests); CloudFront Function a fraction of a cent |
| S3 | ~5 MB of app files | Under $0.01 |
| CloudWatch Logs | Kept 14 days | Cents |

AI and Apollo usage is billed to each user's own key, not to AWS. Check current AWS pricing for your region before committing to a budget.

## One-time setup (about 15 minutes)

1. **Node.js 22** is recommended (the AWS tools warn on Node 20).
2. **AWS CLI credentials** for the company account, with permission to create CloudFormation, S3, CloudFront, Lambda, IAM roles and Logs:
   ```bash
   aws configure --profile leads
   ```
   Use a real region code, e.g. `ap-south-1` (Mumbai, closest to Sri Lanka) or `us-east-1`. *The CLI on this machine currently points at an invalid endpoint (`sts.codify.amazonaws.com`); check `~/.aws/config` for a wrong `region` or `endpoint_url`.*
   ```bash
   aws sts get-caller-identity --profile leads
   ```
3. **Install the deploy tools** (once):
   ```bash
   npm install
   npm --prefix infra install
   ```
4. **Bootstrap CDK** in the account and region (once per account/region):
   ```bash
   AWS_PROFILE=leads npm --prefix infra run bootstrap
   ```

## Deploy

No access code is needed: anyone with the app's address can use it. The company GPT key is protected by its daily limit. (Optional: add `APP_ACCESS_KEY='a-long-random-code'` to the command to make everyone enter a code once per browser.)

```bash
AWS_PROFILE=leads OPENAI_API_KEY='sk-…' npm run deploy
```

This builds the web app and the Lambda, then creates or updates everything in one CloudFormation stack (`LeadsApp`). The first deploy takes **10–15 minutes** (mostly CloudFront). When it finishes it prints:

- **AppUrl** — the address to share, e.g. `https://d1234abcd.cloudfront.net`
- BucketName and ApiFunction — for reference

Open AppUrl, click **Access code needed** in the sidebar footer, and enter the code. Each person adds their own AI key under **AI assistant**.

**Company GPT key (recommended):** add `OPENAI_API_KEY='sk-…'` to the deploy command. The key goes only into the Lambda's settings; the browser never receives it. Everyone with the access code can then use GPT without their own key, up to **$10 a day in total** (change with `AI_DAILY_CAP_USD=…`). Today's spend is kept in a small DynamoDB table (cents a month at most) and resets at midnight Sri Lanka time. When the limit is reached, AI requests stop with a clear message and a notice in the app.

```bash
AWS_PROFILE=leads OPENAI_API_KEY='sk-…' npm run deploy
```

Optional shared database: add `MONGODB_URI='mongodb+srv://…'` to the deploy command. In Atlas → Network Access, Lambda needs `0.0.0.0/0` (with a strong database password), because Lambda has no fixed IP without a paid NAT gateway.

## Updating

Run the same deploy command after any change. Hashed app files are cached for a year; `index.html` is never cached and is refreshed automatically, so users get the new version on their next page load.

**Access code (optional):** deploy with `APP_ACCESS_KEY='…'` to require one, or without it to keep the app open.

## Custom domain (optional)

Add a certificate in **ACM in us-east-1** for e.g. `leads.yourcompany.com`, then add `domainNames` and `certificate` to the `Distribution` in `infra/lib/leads-stack.ts` and point a DNS CNAME at the CloudFront domain. Ask before doing this; it's not needed to start.

## Removing it

```bash
AWS_PROFILE=leads npm --prefix infra run destroy
```

This deletes the stack, the bucket and the logs. Contacts live in each user's browser (or MongoDB if enabled), so they are not affected.

## Security notes

- The Lambda refuses any request without CloudFront's secret `x-origin-verify` header, so its Function URL can't be used directly.
- An access code is optional (`APP_ACCESS_KEY`). Without it, the API is open to anyone with the address, so the company GPT key's daily limit is what caps spending.
- CloudFront adds the same security headers as `vercel.json`: Content-Security-Policy, HSTS, no-referrer, nosniff, frame-deny and Permissions-Policy.
- The S3 bucket is private; only CloudFront can read it (Origin Access Control).
- No API keys are in the build. The company GPT key exists only in the Lambda's environment; personal AI and Apollo keys stay in each user's browser.
- The app never reads LinkedIn; company research reads public company websites and job-board feeds, respecting robots.txt.

## Troubleshooting

| Problem | Fix |
|---|---|
| `APP_ACCESS_KEY must be at least 12 characters` | Use a longer code, or leave it out |
| `Could not connect to the endpoint URL` | Fix the AWS CLI region or endpoint (setup step 2) |
| `This stack uses assets, so the toolkit stack must be deployed` | Run the bootstrap step |
| App asks for an access code | `APP_ACCESS_KEY` is set; enter it once, or deploy without it |
| Research is slow for some companies | Each company is capped at ~40 s; sites that block bots show "No website found" |
| Lambda errors | CloudWatch → Log groups → the `LeadsApp-ApiLogs…` group (kept 14 days) |

---

*Created by **Pasindu Weerakoon***
