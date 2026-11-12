import { describe, expect, it } from 'vitest'
import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import { dynamoStore } from '../api/_store-dynamo'
import { memoryStore, type DataStore } from '../api/_store'
import { handleData, handleProfiles } from '../api/_routes'

type Item = Record<string, AttributeValue>

/**
 * A small stand-in for DynamoDB that understands the calls the store makes. Queries return at most
 * PAGE_ITEMS items per call (like DynamoDB's 1 MB pages) so the paging loops are exercised, and the
 * first batch write leaves one item unprocessed so the retry is exercised.
 */
function fakeDynamo(PAGE_ITEMS = 3) {
  const items = new Map<string, Item>()
  const key = (i: Item) => `${i.pk.S}|${i.sk.S}`
  let refusedOnce = false
  const send = async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const input = cmd.input as Record<string, never>
    switch (cmd.constructor.name) {
      case 'QueryCommand': {
        const v = input.ExpressionAttributeValues as Record<string, AttributeValue>
        const bySrv = input.IndexName === 'bySrv'
        let rows = [...items.values()].filter((i) => i.pk.S === v[':p'].S)
        if (bySrv) rows = rows.filter((i) => Number(i.srv.N) > Number(v[':a'].N))
        rows.sort((a, b) => (bySrv ? Number(a.srv.N) - Number(b.srv.N) : a.sk.S!.localeCompare(b.sk.S!)))
        const start = input.ExclusiveStartKey as Item | undefined
        if (start) rows = rows.slice(rows.findIndex((i) => key(i) === key(start)) + 1)
        const n = Math.min(PAGE_ITEMS, (input.Limit as number | undefined) ?? Infinity)
        const page = rows.slice(0, n)
        return { Items: page, LastEvaluatedKey: rows.length > n ? page[page.length - 1] : undefined }
      }
      case 'UpdateItemCommand': {
        const k = input.Key as Item
        const v = input.ExpressionAttributeValues as Record<string, AttributeValue>
        const cur = items.get(key(k))
        if (input.ConditionExpression && !cur)
          throw Object.assign(new Error('no item'), { name: 'ConditionalCheckFailedException' })
        items.set(key(k), {
          ...k,
          ...cur,
          name: v[':n'],
          updatedAt: v[':u'],
          ...(v[':c'] ? { createdAt: cur?.createdAt ?? v[':c'] } : {}),
        })
        return {}
      }
      case 'TransactWriteItemsCommand': {
        const puts = (input.TransactItems as Array<{ Put: { Item: Item } }>).map((t) => t.Put.Item)
        if (puts.some((i) => items.has(key(i))))
          throw Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' })
        for (const i of puts) items.set(key(i), i)
        return {}
      }
      case 'DeleteItemCommand': {
        const k = key(input.Key as Item)
        const cur = items.get(k)
        const v = input.ExpressionAttributeValues as Record<string, AttributeValue> | undefined
        if (!cur || (v?.[':b'] && cur.by?.S !== v[':b'].S))
          throw Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' })
        items.delete(k)
        return {}
      }
      case 'GetItemCommand':
        return { Item: items.get(key(input.Key as Item)) }
      case 'PutItemCommand': {
        const item = input.Item as Item
        if (input.ConditionExpression && items.has(key(item)))
          throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' })
        items.set(key(item), item)
        return {}
      }
      case 'BatchWriteItemCommand': {
        const reqs = Object.values(
          input.RequestItems as Record<string, Array<Record<string, { Item?: Item; Key?: Item }>>>,
        )[0]
        const unprocessed = []
        for (const [n, r] of reqs.entries()) {
          if (!refusedOnce && n === reqs.length - 1 && reqs.length > 1) {
            refusedOnce = true
            unprocessed.push(r)
            continue
          }
          if (r.PutRequest) items.set(key(r.PutRequest.Item!), r.PutRequest.Item!)
          if (r.DeleteRequest) items.delete(key(r.DeleteRequest.Key!))
        }
        return { UnprocessedItems: unprocessed.length ? { t: unprocessed } : {} }
      }
    }
    throw new Error(`fake DynamoDB: ${cmd.constructor.name} not handled`)
  }
  return { send: send as (c: unknown) => Promise<unknown>, items }
}

const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const stores: Array<[string, () => DataStore]> = [
  ['memory', () => memoryStore()],
  ['DynamoDB', () => dynamoStore('t', fakeDynamo())],
]

describe.each(stores)('the %s store behind /api/profiles and /api/data', (_name, make) => {
  it('creates, lists, renames and deletes profiles, and deleting removes their data', async () => {
    const s = make()
    await handleProfiles(req('POST', '/api/profiles', { id: 'team', name: 'Sales team', createdAt: '2026-01-01' }), s)
    await handleProfiles(req('POST', '/api/profiles', { id: 'me', name: 'Mine', createdAt: '2026-02-01' }), s)
    expect((await handleProfiles(req('PATCH', '/api/profiles', { id: 'me', name: 'Renamed' }), s)).status).toBe(200)
    expect((await handleProfiles(req('PATCH', '/api/profiles', { id: 'nope', name: 'X' }), s)).status).toBe(404)
    await handleData(
      req('POST', '/api/data', {
        profileId: 'team',
        table: 'contacts',
        upserts: [{ id: 'a', data: { n: 1 } }],
        deletes: [],
      }),
      s,
    )
    let list = (await (await handleProfiles(req('GET', '/api/profiles'), s)).json()) as {
      profiles: Array<{ id: string; name: string }>
    }
    expect(list.profiles.map((p) => [p.id, p.name])).toEqual([
      ['team', 'Sales team'],
      ['me', 'Renamed'],
    ])
    await handleProfiles(req('DELETE', '/api/profiles?id=team'), s)
    list = (await (await handleProfiles(req('GET', '/api/profiles'), s)).json()) as typeof list
    expect(list.profiles.map((p) => p.id)).toEqual(['me'])
    const left = (await (
      await handleData(req('GET', '/api/data?profileId=team&table=contacts&since=0'), s)
    ).json()) as {
      records: unknown[]
    }
    expect(left.records).toEqual([])
  })

  it('pages through a big import saved within one second without repeating a page', async () => {
    const s = make()
    const upserts = Array.from({ length: 2400 }, (_, i) => ({ id: `c${i}`, data: { i } }))
    for (let i = 0; i < upserts.length; i += 500)
      await handleData(
        req('POST', '/api/data', {
          profileId: 'p',
          table: 'contacts',
          upserts: upserts.slice(i, i + 500),
          deletes: [],
        }),
        s,
      )
    const seen = new Set<string>()
    let since = 0
    for (let page = 0; page < 10; page++) {
      const r = (await (
        await handleData(req('GET', `/api/data?profileId=p&table=contacts&since=${since}${page ? '&cont=1' : ''}`), s)
      ).json()) as { records: Array<{ id: string }>; cursor: number; more: boolean }
      for (const x of r.records) seen.add(x.id)
      since = r.cursor
      if (!r.more) break
    }
    expect(seen.size).toBe(2400)
  })

  it('keeps deletes as markers and the latest write of a record', async () => {
    const s = make()
    await handleData(
      req('POST', '/api/data', { profileId: 'p', table: 'views', upserts: [{ id: 'v', data: { a: 1 } }], deletes: [] }),
      s,
    )
    await handleData(
      req('POST', '/api/data', {
        profileId: 'p',
        table: 'views',
        upserts: [{ id: 'v', data: { a: 2 } }],
        deletes: ['w'],
      }),
      s,
    )
    const r = (await (await handleData(req('GET', '/api/data?profileId=p&table=views&since=0'), s)).json()) as {
      records: Array<{ id: string; data?: { a: number }; deleted?: boolean }>
    }
    expect(r.records).toEqual([
      { id: 'v', data: { a: 2 } },
      { id: 'w', deleted: true },
    ])
  })
})

describe('the DynamoDB store', () => {
  it('refuses a record over the 400 KB item limit with a clear message', async () => {
    const res = await handleData(
      req('POST', '/api/data', {
        profileId: 'p',
        table: 'contacts',
        upserts: [{ id: 'big', data: { notes: 'x'.repeat(400_000) } }],
        deletes: [],
      }),
      dynamoStore('t', fakeDynamo()),
    )
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toMatch(/too big/)
  })
})

describe.each(stores)('accounts in the %s store', (_name, make) => {
  it('creates once, reads back, updates and lists', async () => {
    const s = make()
    const u = {
      email: 'a@example.com',
      username: 'A',
      passwordHash: 'scrypt$1$x$y',
      role: 'user' as const,
      status: 'pending' as const,
      createdAt: '2026-01-02',
      updatedAt: '2026-01-02',
    }
    expect(await s.putUser(u, { create: true })).toBe(true)
    expect(await s.putUser({ ...u, username: 'Other' }, { create: true })).toBe(false)
    await s.putUser({ ...u, email: 'b@example.com', createdAt: '2026-01-01' }, { create: true })
    await s.putUser({ ...u, status: 'active' })
    expect((await s.getUser('a@example.com'))?.status).toBe('active')
    expect(await s.getUser('nobody@example.com')).toBeUndefined()
    expect((await s.listUsers()).map((x) => x.email)).toEqual(['b@example.com', 'a@example.com'])
  })
})

describe.each(stores)('claims in the %s store', (_name, make) => {
  it('gives each connection to one person only, and gives back only your own', async () => {
    const s = make()
    const ids = Array.from({ length: 250 }, (_, i) => `c${i}`)
    expect(await s.addClaims('p', ids.slice(0, 120), 'a@x.com')).toHaveLength(120)
    // Overlapping request: only the ones nobody holds.
    expect(await s.addClaims('p', ids.slice(100, 150), 'b@x.com')).toEqual(ids.slice(120, 150))
    const claims = await s.listClaims('p')
    expect(claims).toHaveLength(150)
    expect(claims.filter((c) => c.by === 'b@x.com')).toHaveLength(30)
    expect(await s.removeClaims('p', ids.slice(0, 130), 'b@x.com')).toBe(10)
    expect(await s.removeClaims('p', ['c0', 'c1'])).toBe(2)
    expect(await s.listClaims('p')).toHaveLength(138)
    expect(await s.listClaims('other')).toEqual([])
  })
})
