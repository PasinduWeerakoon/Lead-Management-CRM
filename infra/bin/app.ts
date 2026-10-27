import * as cdk from 'aws-cdk-lib'
import { LeadsStack } from '../lib/leads-stack'

/**
 * Deploy with:
 *   npm run deploy        (from the project root)
 * Optional: APP_ACCESS_KEY='a-long-random-code' to require a workspace access code.
 * Optional: MONGODB_URI='mongodb+srv://…' to switch on the shared database.
 * Optional: OPENAI_API_KEY='sk-…' for a company GPT key kept on the server (AI_DAILY_CAP_USD, default 10).
 * Region and account come from your AWS CLI profile (AWS_PROFILE / AWS_REGION).
 */
// Optional: with APP_ACCESS_KEY set, the app asks for that code; without it, it's open to anyone with the URL.
const accessKey = process.env.APP_ACCESS_KEY?.trim() || undefined
if (accessKey && accessKey.length < 12) throw new Error('APP_ACCESS_KEY must be at least 12 characters.')

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
