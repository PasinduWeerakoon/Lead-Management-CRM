import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { handleData, handleProfiles, routeApi } from '../api/_routes'

// A tiny localStorage for Node, used by the sync state and active profile.
const store = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
} as Storage

let mongo: MongoMemoryServer
let client: MongoClient
let mdb: Db

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  process.env.MONGODB_DB = 'leads_test'
  delete process.env.APP_ACCESS_KEY
  delete process.env.VERCEL
  client = await new MongoClient(mongo.getUri()).connect()
  mdb = client.db('leads_test')
  // The app's fetch('/api/...') goes straight to the real handlers.
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost')
    const res = await routeApi(url.pathname, new Request(url, init))
    return res ?? new Response('{}', { status: 404 })
  }) as typeof fetch
}, 120_000)

afterAll(async () => {
  await client?.close()
  await mongo?.stop()
})

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

describe('/api/profiles and /api/data on MongoDB', () => {
  beforeEach(async () => {
    await mdb.dropDatabase()
  })

  it('creates, lists, renames and deletes profiles — deleting removes all their data', async () => {
    await handleProfiles(req('POST', '/api/profiles', { id: 'team', name: 'Sales team network' }), mdb)
    await handleProfiles(req('POST', '/api/profiles', { id: 'me', name: 'Mine' }), mdb)
    await handleProfiles(req('PATCH', '/api/profiles', { id: 'me', name: 'Pasindu' }), mdb)
    await handleData(
      req('POST', '/api/data', {
        profileId: 'team',
        table: 'contacts',
        upserts: [{ id: 'c1', data: { id: 'c1', fullName: 'A' } }],
      }),
      mdb,
    )
    let list = await (await handleProfiles(req('GET', '/api/profiles'), mdb)).json()
    expect(list.profiles.map((p: { name: string }) => p.name).sort()).toEqual(['Pasindu', 'Sales team network'])

    await handleProfiles(req('DELETE', '/api/profiles?id=team'), mdb)
    list = await (await handleProfiles(req('GET', '/api/profiles'), mdb)).json()
    expect(list.profiles.map((p: { id: string }) => p.id)).toEqual(['me'])
    expect(await mdb.collection('contacts').countDocuments({ profileId: 'team' })).toBe(0)
  })

  it('keeps each profile’s data separate and returns only changes after a cursor', async () => {
    const save = (profileId: string, ids: string[]) =>
      handleData(
        req('POST', '/api/data', {
          profileId,
          table: 'contacts',
          upserts: ids.map((id) => ({ id, data: { id, fullName: id, _ts: 99 } })),
        }),
        mdb,
      )
    await save('a', ['1', '2'])
    await save('b', ['3'])
    const first = await (await handleData(req('GET', '/api/data?profileId=a&table=contacts&since=0'), mdb)).json()
    expect(first.records.map((r: { id: string }) => r.id)).toEqual(['1', '2'])
    expect(first.records[0].data).toEqual({ id: '1', fullName: '1' }) // the local _ts stamp isn't stored

    await handleData(req('POST', '/api/data', { profileId: 'a', table: 'contacts', deletes: ['1'] }), mdb)
    const later = await (
      await handleData(req('GET', `/api/data?profileId=a&table=contacts&since=${first.cursor + 20_000}`), mdb)
    ).json()
    expect(later.records).toEqual([])
    const withDelete = await (
      await handleData(req('GET', `/api/data?profileId=a&table=contacts&since=${first.cursor}`), mdb)
    ).json()
    expect(withDelete.records.find((r: { id: string }) => r.id === '1')).toEqual({ id: '1', deleted: true })
  })

  it('refuses bad input and unknown tables', async () => {
    for (const body of [
      { profileId: '../x', table: 'contacts' },
      { profileId: 'a', table: 'settings' },
      { profileId: 'a', table: 'contacts', upserts: [{ data: {} }] },
    ]) {
      expect((await handleData(req('POST', '/api/data', body), mdb)).status).toBe(400)
    }
    expect((await handleData(req('GET', '/api/data?profileId=a&table=settings&since=0'), mdb)).status).toBe(400)
  })

  it('requires the workspace access code only when one is set', async () => {
    process.env.APP_ACCESS_KEY = 'open-sesame-123'
    try {
      expect((await handleProfiles(req('GET', '/api/profiles'), mdb)).status).toBe(401)
      expect((await handleProfiles(req('GET', '/api/profiles', undefined, { 'x-app-key': 'nope' }), mdb)).status).toBe(
        401,
      )
      expect(
        (await handleProfiles(req('GET', '/api/profiles', undefined, { 'x-app-key': 'open-sesame-123' }), mdb)).status,
      ).toBe(200)
    } finally {
      delete process.env.APP_ACCESS_KEY
    }
    // Hosted without a code: open.
    process.env.VERCEL = '1'
    try {
      expect((await handleProfiles(req('GET', '/api/profiles'), mdb)).status).toBe(200)
    } finally {
      delete process.env.VERCEL
    }
  })
})

describe('syncing a profile between this browser and MongoDB', () => {
  // Imported after localStorage exists: the local database name depends on the active profile.
  const load = async () => {
    const { db } = await import('../src/lib/db')
    const engine = await import('../src/lib/sync/engine')
    const profiles = await import('../src/lib/profiles')
    const { appDb } = await import('../src/lib/app-db')
    engine.installChangeTracking()
    return { db, engine, profiles, appDb }
  }
  const remote = async (table = 'contacts', profileId = 'default') =>
    mdb
      .collection(table)
      .find({ profileId })
      .toArray()
      .then((d) => new Map(d.map((x) => [x.id, x])))
  const person = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    firstName: id,
    lastName: '',
    fullName: id,
    source: 'linkedin_export',
    importedAt: '',
    updatedAt: '',
    status: 'new',
    tags: [],
    seniority: 'Unknown',
    function: 'Other',
    titleTags: [],
    ...extra,
  })

  beforeEach(async () => {
    await mdb.dropDatabase()
    const { db, appDb } = await load()
    await db.contacts.clear()
    await appDb.profiles.clear()
    store.clear()
  })

  it('uploads local data the first time, then only what changed', async () => {
    const { db, engine } = await load()
    await db.contacts.bulkAdd([person('a'), person('b')] as never)
    expect((await engine.syncOnce()).pushed).toBeGreaterThanOrEqual(2)
    expect([...(await remote()).keys()].sort()).toEqual(['a', 'b'])

    await db.contacts.update('a', { notes: 'Met at a conference' })
    const second = await engine.syncOnce()
    expect(second.pushed).toBe(1)
    expect((await remote()).get('a')?.data.notes).toBe('Met at a conference')
  })

  it('brings down changes made elsewhere without sending them back, and lets unsent local edits win', async () => {
    const { db, engine } = await load()
    await db.contacts.bulkAdd([person('a'), person('b')] as never)
    await engine.syncOnce()

    // Another browser edits both people…
    await handleData(
      req('POST', '/api/data', {
        profileId: 'default',
        table: 'contacts',
        upserts: [
          { id: 'a', data: person('a', { notes: 'from elsewhere' }) },
          { id: 'b', data: person('b', { notes: 'from elsewhere' }) },
        ],
      }),
      mdb,
    )
    // …while this browser has an unsent edit to b.
    await db.contacts.update('b', { notes: 'mine' })
    const res = await engine.syncOnce()
    expect((await db.contacts.get('a'))?.notes).toBe('from elsewhere')
    expect((await db.contacts.get('b'))?.notes).toBe('mine')
    expect((await remote()).get('b')?.data.notes).toBe('mine')
    expect(res.pushed).toBe(1) // only b went back up, not the pulled a
  })

  it('sends deletes, and applies deletes made elsewhere', async () => {
    const { db, engine } = await load()
    await db.contacts.bulkAdd([person('a'), person('b')] as never)
    await engine.syncOnce()
    await db.contacts.delete('a')
    await engine.syncOnce()
    expect((await remote()).get('a')?.deleted).toBe(true)

    await handleData(req('POST', '/api/data', { profileId: 'default', table: 'contacts', deletes: ['b'] }), mdb)
    await engine.syncOnce()
    expect(await db.contacts.count()).toBe(0)
  })

  it('sends "delete all" and backup restores to the database', async () => {
    const { db, engine } = await load()
    const backup = await import('../src/lib/backup')
    await db.contacts.bulkAdd([person('a'), person('b'), person('c')] as never)
    await engine.syncOnce()

    // Restore a backup that has only a and b: c is deleted, a and b are saved (not deleted).
    await backup.restoreBackup({
      app: 'leads-management',
      version: 2,
      exportedAt: '',
      contacts: [person('a', { notes: 'restored' }), person('b')] as never,
      imports: [],
    })
    await engine.syncOnce()
    let server = await remote()
    expect(server.get('a')?.data.notes).toBe('restored')
    expect(server.get('b')?.deleted).toBeUndefined()
    expect(server.get('c')?.deleted).toBe(true)

    await backup.deleteAllData()
    await engine.syncOnce()
    server = await remote()
    expect([...server.values()].every((d) => d.deleted)).toBe(true)
  })

  it('lets the database win when a browser first links a profile that already has data', async () => {
    const { db, engine } = await load()
    await handleData(
      req('POST', '/api/data', {
        profileId: 'default',
        table: 'contacts',
        upserts: [{ id: 'shared', data: person('shared') }],
      }),
      mdb,
    )
    await db.contacts.add(person('stale-local') as never)
    await engine.syncOnce()
    expect((await db.contacts.toArray()).map((c) => c.id)).toEqual(['shared'])
    expect([...(await remote()).keys()]).toEqual(['shared'])
  })

  it('links profiles both ways: local ones are saved, ones made elsewhere appear', async () => {
    const { profiles, appDb } = await load()
    await profiles.ensureDefaultProfile()
    await handleProfiles(req('POST', '/api/profiles', { id: 'team', name: 'Sales team network' }), mdb)
    await profiles.ensureProfilesLinked()
    expect((await appDb.profiles.toArray()).map((p) => p.id).sort()).toEqual(['default', 'team'])
    const server = await (await handleProfiles(req('GET', '/api/profiles'), mdb)).json()
    expect(server.profiles.map((p: { id: string }) => p.id).sort()).toEqual(['default', 'team'])
  })
})

describe('access code on AWS Lambda', () => {
  it('is optional on Lambda, and enforced when set', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'leads-api'
    try {
      expect((await handleProfiles(req('GET', '/api/profiles'), mdb)).status).toBe(200)
      process.env.APP_ACCESS_KEY = 'open-sesame-123'
      expect((await handleProfiles(req('GET', '/api/profiles'), mdb)).status).toBe(401)
    } finally {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME
      delete process.env.APP_ACCESS_KEY
    }
  })
})
