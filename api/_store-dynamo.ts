import {
  BatchWriteItemCommand,
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
  type WriteRequest,
} from '@aws-sdk/client-dynamodb'
import { nextStamp, SYNCED_TABLES } from './_db.js'
import { StoreError, type DataStore, type StoredRecord } from './_store.js'

/**
 * The shared data in ONE on-demand DynamoDB table (DATA_TABLE), so there is nothing to pay while idle.
 *
 *   profiles:  pk "P"                       sk <profile id>   name, createdAt, updatedAt
 *   records:   pk "R#<profile>#<table>"     sk <record id>    srv (write stamp), d (JSON), del
 *
 * A local secondary index "bySrv" (pk + srv) answers "changed since…" in order without a scan.
 * The record itself is kept as one JSON string, so any shape the app saves fits without mapping.
 * Set DYNAMODB_ENDPOINT to use DynamoDB Local (e.g. http://localhost:8000).
 */

type Item = Record<string, AttributeValue>
interface Client {
  send(command: unknown): Promise<unknown>
}

/** DynamoDB's item limit is 400 KB; leave room for the keys and stamp. */
const MAX_ITEM_BYTES = 390_000
const BATCH = 25

const recordPk = (profileId: string, table: string) => `R#${profileId}#${table}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function dynamoClient(): Client {
  const endpoint = process.env.DYNAMODB_ENDPOINT
  return new DynamoDBClient(
    endpoint
      ? {
          endpoint,
          region: process.env.AWS_REGION || 'local',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {},
  )
}

export function dynamoStore(table: string, client: Client = dynamoClient()): DataStore {
  const send = <T>(c: unknown) => client.send(c) as Promise<T>

  /** Every key in one partition, page by page. */
  async function* keys(pk: string) {
    let start: Item | undefined
    do {
      const out = await send<{ Items?: Item[]; LastEvaluatedKey?: Item }>(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :p',
          ExpressionAttributeValues: { ':p': { S: pk } },
          ProjectionExpression: 'pk, sk',
          ExclusiveStartKey: start,
        }),
      )
      yield* out.Items ?? []
      start = out.LastEvaluatedKey
    } while (start)
  }

  /** Writes in batches of 25, retrying whatever DynamoDB hands back as unprocessed. */
  async function batchWrite(requests: WriteRequest[]) {
    for (let i = 0; i < requests.length; i += BATCH) {
      let pending: WriteRequest[] = requests.slice(i, i + BATCH)
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt > 6) throw new StoreError(503, 'The database is busy. Try again in a minute.')
        if (attempt) await sleep(50 * 2 ** attempt)
        const out = await send<{ UnprocessedItems?: Record<string, WriteRequest[]> }>(
          new BatchWriteItemCommand({ RequestItems: { [table]: pending } }),
        )
        pending = out.UnprocessedItems?.[table] ?? []
      }
    }
  }

  return {
    kind: 'dynamo',

    listProfiles: async () => {
      const out = await send<{ Items?: Item[] }>(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'pk = :p',
          ExpressionAttributeValues: { ':p': { S: 'P' } },
          Limit: 500,
        }),
      )
      return (out.Items ?? [])
        .map((i) => ({
          id: i.sk.S!,
          name: i.name?.S ?? '',
          createdAt: i.createdAt?.S ?? '',
          updatedAt: i.updatedAt?.S ?? '',
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    saveProfile: async (id, name, createdAt) => {
      await send(
        new UpdateItemCommand({
          TableName: table,
          Key: { pk: { S: 'P' }, sk: { S: id } },
          UpdateExpression: 'SET #n = :n, updatedAt = :u, createdAt = if_not_exists(createdAt, :c)',
          ExpressionAttributeNames: { '#n': 'name' },
          ExpressionAttributeValues: {
            ':n': { S: name },
            ':u': { S: new Date().toISOString() },
            ':c': { S: createdAt },
          },
        }),
      )
    },

    renameProfile: async (id, name) => {
      try {
        await send(
          new UpdateItemCommand({
            TableName: table,
            Key: { pk: { S: 'P' }, sk: { S: id } },
            UpdateExpression: 'SET #n = :n, updatedAt = :u',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeNames: { '#n': 'name' },
            ExpressionAttributeValues: { ':n': { S: name }, ':u': { S: new Date().toISOString() } },
          }),
        )
        return true
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false
        throw err
      }
    },

    deleteProfile: async (id) => {
      for (const t of SYNCED_TABLES) {
        const dels: WriteRequest[] = []
        for await (const k of keys(recordPk(id, t))) dels.push({ DeleteRequest: { Key: { pk: k.pk, sk: k.sk } } })
        await batchWrite(dels)
      }
      await batchWrite([{ DeleteRequest: { Key: { pk: { S: 'P' }, sk: { S: id } } } }])
    },

    changes: async (profileId, t, after, limit) => {
      const records: StoredRecord[] = []
      let start: Item | undefined
      // DynamoDB returns at most 1 MB per call, so keep reading until the page is full.
      do {
        const out = await send<{ Items?: Item[]; LastEvaluatedKey?: Item }>(
          new QueryCommand({
            TableName: table,
            IndexName: 'bySrv',
            KeyConditionExpression: 'pk = :p AND srv > :a',
            ExpressionAttributeValues: { ':p': { S: recordPk(profileId, t) }, ':a': { N: String(after) } },
            ScanIndexForward: true,
            Limit: limit + 1 - records.length,
            ExclusiveStartKey: start,
          }),
        )
        for (const i of out.Items ?? [])
          records.push(
            i.del?.BOOL
              ? { id: i.sk.S!, deleted: true, srv: Number(i.srv.N) }
              : { id: i.sk.S!, data: JSON.parse(i.d?.S ?? '{}') as Record<string, unknown>, srv: Number(i.srv.N) },
          )
        start = out.LastEvaluatedKey
      } while (start && records.length <= limit)
      return { records: records.slice(0, limit), more: records.length > limit || !!start }
    },

    write: async (profileId, t, recs) => {
      const pk = { S: recordPk(profileId, t) }
      const puts: WriteRequest[] = recs.map((r) => {
        const item: Item = { pk, sk: { S: r.id }, srv: { N: String(nextStamp()) } }
        if (r.deleted) item.del = { BOOL: true }
        else {
          const d = JSON.stringify(r.data ?? {})
          if (Buffer.byteLength(d) > MAX_ITEM_BYTES)
            throw new StoreError(413, `Record ${r.id.slice(0, 60)} is too big to save (over 390 KB).`)
          item.d = { S: d }
        }
        return { PutRequest: { Item: item } }
      })
      // One record written twice in a batch is refused by DynamoDB; the last write wins.
      const last = new Map(puts.map((p) => [p.PutRequest!.Item!.sk.S!, p]))
      await batchWrite([...last.values()])
    },
  }
}
