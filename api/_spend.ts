import { getDb } from './_db'

/**
 * Today's spend on the company AI key, shared by every server instance where possible:
 *  - AWS: a DynamoDB table (SPEND_TABLE), one item per day, added to atomically
 *  - Vercel with MONGODB_URI: a `ai_spend` collection
 *  - otherwise: this server instance's memory (fine for the dev server; on Vercel each warm
 *    instance counts separately, so the status reports `shared: false`)
 * Days run on Sri Lanka time, so the limit resets at midnight in Colombo.
 */

export const DEFAULT_DAILY_CAP_USD = 10

export function dailyCapUsd(): number {
  const n = Number(process.env.AI_DAILY_CAP_USD)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP_USD
}

/** "2026-10-27" in Asia/Colombo. */
export function spendDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(now)
}

export interface SpendStore {
  readonly shared: boolean
  get(day: string): Promise<number>
  add(day: string, usd: number): Promise<number>
}

export function memorySpend(): SpendStore {
  const days = new Map<string, number>()
  return {
    shared: false,
    get: async (day) => days.get(day) ?? 0,
    add: async (day, usd) => {
      const next = (days.get(day) ?? 0) + usd
      days.set(day, next)
      return next
    },
  }
}

function dynamoSpend(table: string): SpendStore {
  // The AWS SDK ships with the Lambda runtime; loaded only when this store is used.
  const client = import('@aws-sdk/client-dynamodb').then((m) => ({ m, c: new m.DynamoDBClient({}) }))
  return {
    shared: true,
    get: async (day) => {
      const { m, c } = await client
      const out = await c.send(new m.GetItemCommand({ TableName: table, Key: { day: { S: day } }, ConsistentRead: true }))
      return Number(out.Item?.usd?.N ?? 0)
    },
    add: async (day, usd) => {
      const { m, c } = await client
      const out = await c.send(
        new m.UpdateItemCommand({
          TableName: table,
          Key: { day: { S: day } },
          UpdateExpression: 'ADD usd :u SET expiresAt = if_not_exists(expiresAt, :t)',
          ExpressionAttributeValues: {
            ':u': { N: usd.toFixed(8) },
            // Rows delete themselves after ~40 days.
            ':t': { N: String(Math.floor(Date.now() / 1000) + 40 * 86_400) },
          },
          ReturnValues: 'UPDATED_NEW',
        }),
      )
      return Number(out.Attributes?.usd?.N ?? usd)
    },
  }
}

function mongoSpend(): SpendStore {
  const col = async () => (await getDb())!.collection<{ _id: string; usd: number }>('ai_spend')
  return {
    shared: true,
    get: async (day) => (await (await col()).findOne({ _id: day }))?.usd ?? 0,
    add: async (day, usd) => {
      const doc = await (await col()).findOneAndUpdate(
        { _id: day },
        { $inc: { usd } },
        { upsert: true, returnDocument: 'after' },
      )
      return doc?.usd ?? usd
    },
  }
}

let store: SpendStore | undefined

export function spendStore(): SpendStore {
  store ??= process.env.SPEND_TABLE
    ? dynamoSpend(process.env.SPEND_TABLE)
    : process.env.MONGODB_URI
      ? mongoSpend()
      : memorySpend()
  return store
}

/** For tests. */
export function setSpendStore(s: SpendStore | undefined) {
  store = s
}
