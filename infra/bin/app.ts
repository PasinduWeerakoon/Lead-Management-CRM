import * as cdk from 'aws-cdk-lib'
import { LeadsStack } from '../lib/leads-stack'

/**
 * Deploy with:
 *   APP_ACCESS_KEY='a-long-random-code' npm run deploy        (from the project root)
 * Optional: MONGODB_URI='mongodb+srv://…' to switch on the shared database.
 * Optional: OPENAI_API_KEY='sk-…' for a company GPT key kept on the server (AI_DAILY_CAP_USD, default 10).
 * Region and account come from your AWS CLI profile (AWS_PROFILE / AWS_REGION).
 */
const accessKey = process.env.APP_ACCESS_KEY?.trim()
if (!accessKey || accessKey.length < 12) {
  throw new Error(
    'Set APP_ACCESS_KEY (at least 12 characters) before deploying — it protects the app, which has no login.',
  )
}

const app = new cdk.App()
new LeadsStack(app, process.env.LEADS_STACK_NAME ?? 'LeadsApp', {
  accessKey,
  mongodbUri: process.env.MONGODB_URI?.trim() || undefined,
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  aiDailyCapUsd: Number(process.env.AI_DAILY_CAP_USD) > 0 ? Number(process.env.AI_DAILY_CAP_USD) : 10,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION },
  description: 'Leads — LinkedIn connections to scored leads (S3 + CloudFront + one Arm64 Lambda)',
  tags: { app: 'leads', costCenter: '1BT' },
})
