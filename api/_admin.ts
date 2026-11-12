import { forgetCachedUser, requireSuperAdmin } from './_auth.js'
import { json } from './_db.js'
import { getStore, type DataStore, type UserRecord } from './_store.js'

/**
 * /api/admin, for the super admin only.
 *   GET  ?op=users                     → every account (never the password hash)
 *   POST { op: 'set', email, status?, role? } → approve, turn off, or change role
 *   GET  ?op=searches                  → every saved search in every profile, newest first (summary)
 *   GET  ?op=search&profileId=&id=     → one search in full: prompt, conditions and scored people
 */

const publicUser = ({ passwordHash: _h, failedSignIns: _f, ...u }: UserRecord) => (void _h, void _f, u)

/** Every saved search in a profile (search results sync like the other tables). */
async function profileSearches(store: DataStore, profileId: string) {
  const runs: Array<Record<string, unknown> & { id: string }> = []
  let after = 0
  for (;;) {
    const { records, more } = await store.changes(profileId, 'scoreRuns', after, 1000)
    for (const r of records) if (!r.deleted && r.data) runs.push({ ...r.data, id: r.id })
    if (!more || !records.length) return runs
    after = records[records.length - 1].srv
  }
}

type Person = { priority?: string; checks?: Array<{ status?: string }> }
const shortlisted = (people: Person[]) => people.filter((p) => p.priority === 'High' || p.priority === 'Medium').length

export async function handleAdmin(request: Request): Promise<Response> {
  const admin = await requireSuperAdmin(request)
  if (admin instanceof Response) return admin
  const store = await getStore()
  if (!store) return json(503, { error: 'The shared database isn’t set up.', code: 'no_db' })
  const q = new URL(request.url).searchParams

  if (request.method === 'GET' && q.get('op') === 'users')
    return json(200, { users: (await store.listUsers()).map(publicUser) })

  if (request.method === 'GET' && q.get('op') === 'searches') {
    const profiles = await store.listProfiles()
    const searches = []
    for (const p of profiles)
      for (const r of await profileSearches(store, p.id)) {
        const people = Array.isArray(r.people) ? (r.people as Person[]) : []
        searches.push({
          id: r.id,
          profileId: p.id,
          profileName: p.name,
          by: r.by ?? null,
          at: r.at,
          name: r.briefName,
          prompt: typeof r.briefText === 'string' ? r.briefText.slice(0, 600) : '',
          criteria: r.criteria ?? [],
          total: r.total ?? people.length,
          scored: people.length,
          shortlisted: shortlisted(people),
          partly: people.filter((x) => !shortlisted([x]) && x.checks?.some((c) => c.status === 'met')).length,
        })
      }
    searches.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return json(200, { searches })
  }

  if (request.method === 'GET' && q.get('op') === 'search') {
    const profileId = q.get('profileId') ?? ''
    const id = q.get('id') ?? ''
    const run = (await profileSearches(store, profileId)).find((r) => r.id === id)
    return run ? json(200, { search: run }) : json(404, { error: 'No such search.' })
  }

  if (request.method === 'POST') {
    let body: { op?: unknown; email?: unknown; status?: unknown; role?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return json(400, { error: 'Request body must be JSON.' })
    }
    if (body.op !== 'set' || typeof body.email !== 'string') return json(400, { error: 'Unknown action.' })
    const email = body.email.trim().toLowerCase()
    if (email === admin.email) return json(400, { error: 'You can’t change your own account here.' })
    const user = await store.getUser(email)
    if (!user) return json(404, { error: 'No such account.' })
    const status = body.status
    const role = body.role
    if (status !== undefined && status !== 'active' && status !== 'disabled' && status !== 'pending')
      return json(400, { error: 'Unknown status.' })
    if (role !== undefined && role !== 'user' && role !== 'super_admin') return json(400, { error: 'Unknown role.' })
    const next: UserRecord = {
      ...user,
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      ...(status === 'active' && user.status !== 'active' ? { approvedBy: admin.email } : {}),
      updatedAt: new Date().toISOString(),
    }
    await store.putUser(next)
    forgetCachedUser(email)
    return json(200, { user: publicUser(next) })
  }

  return json(400, { error: 'Unknown request.' })
}
