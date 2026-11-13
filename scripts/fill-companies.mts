/**
 * One-off batch: fills company data for every connection in the shared database, at no cost.
 *  - People Data Labs company lookup, only while free company credits remain (stops at the first 402).
 *  - SEC EDGAR and Wikidata (free, open records).
 *  - The company's own site: job boards it links to (Greenhouse, Lever, Workable, Ashby…), read
 *    directly. No OpenAI, no Adzuna.
 * Companies with the most people go first. Each company is saved as soon as it's done, and a rerun
 * skips companies already found or already checked by this script, so it can stop and continue.
 *
 *   DATA_TABLE=leadsapp-data AWS_REGION=ap-south-1 PDL_API_KEY=… npx tsx scripts/fill-companies.mts [--limit N] [--dry]
 */
import { getStore, type StoredRecord } from '../api/_store.ts'
import { Pdl, PdlError, pdlCompany } from '../api/_pdl.ts'
import { edgarLookup, wikidataLookup } from '../api/_sources.ts'
import { readSite } from '../api/_research.ts'
import { companyKey } from '../src/lib/company-hq.ts'
import { mergeExtras } from '../src/lib/research/sources.ts'

const PLACEHOLDER =
  /^\s*(self[\s-]?employed|freelanc\w*|independent( consultant| contractor)?|stealth( mode| startup| start-up| company)?|retired|student|unemployed|open to work|looking for (new )?opportunities|confidential|private|n\/?a|none|-+|various|career break|sabbatical|pekerja lepas)\s*$/i
const BATCH = 'batch-free'
const args = process.argv.slice(2)
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity
const dry = args.includes('--dry')

type Obj = Record<string, any>
const store = (await getStore())!
if (!store) throw new Error('Set DATA_TABLE (and AWS credentials) first.')

async function all(profileId: string): Promise<StoredRecord[]> {
  const out: StoredRecord[] = []
  let after = 0
  for (;;) {
    const { records, more } = await store.changes(profileId, 'contacts', after, 1000)
    out.push(...records.filter((r) => !r.deleted && r.data))
    if (!more || !records.length) return out
    after = records[records.length - 1].srv
  }
}

const domainOf = (u?: string) => {
  if (!u) return undefined
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/** Same rules as the app: fills empty fields only, never replaces a record already found. */
function apply(c: Obj, r: Obj): Obj {
  if (c.research?.status === 'found') return c
  const next = { ...c, research: r }
  if (r.status !== 'found') return next
  const e = c.enrichment ?? {}
  const website = r.siteUrl && r.domain ? `https://${r.domain}` : undefined
  if ((website && !e.website) || (r.industry && !e.industry) || (r.size && !e.companySize))
    next.enrichment = {
      ...e,
      ...(website && !e.website ? { website } : {}),
      ...(r.industry && !e.industry ? { industry: r.industry.value } : {}),
      ...(r.size && !e.companySize ? { companySize: r.size.value } : {}),
      source: e.source ?? 'Company website',
      updatedAt: r.at,
    }
  if (r.hq && !c.companyHq)
    next.companyHq = { status: 'found', value: r.hq.value, origin: 'web', source: r.hq.url, at: r.at }
  return next
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[,.]|\b(inc|llc|ltd|plc|corp|corporation|co|gmbh|limited)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A website for a company with none known: only a Wikidata item whose English name is exactly this
 * company's name and that lists an official website. Anything less certain is left alone.
 */
async function wikidataDomain(name: string): Promise<string | undefined> {
  const get = async (u: string) =>
    (await fetch(u, { headers: { 'User-Agent': 'LeadsManager/1.0 (batch)' } }).catch(() => undefined))
      ?.json()
      .catch(() => undefined)
  const found = await get(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(name)}`,
  )
  const ids: string[] = (found?.search ?? []).map((x: Obj) => x.id)
  if (!ids.length) return undefined
  const data = await get(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|claims&languages=en&ids=${ids.join('|')}`,
  )
  const hits = Object.values((data?.entities ?? {}) as Record<string, Obj>).filter(
    (e) => squash(e.labels?.en?.value ?? '') === squash(name) && e.claims?.P856?.length,
  )
  // Two items with the same name (say, two "Atlas" companies) is ambiguous, so neither is used.
  return hits.length === 1 ? domainOf(hits[0].claims.P856[0].mainsnak?.datavalue?.value) : undefined
}

const pdl = new Pdl(fetch)
let pdlOn = !!process.env.PDL_API_KEY?.trim()
const stats = { companies: 0, found: 0, pdl: 0, wiki: 0, edgar: 0, jobs: 0, none: 0, people: 0 }

async function research(name: string, hint?: string): Promise<Obj> {
  const at = new Date().toISOString()
  let facts: Obj | undefined
  if (pdlOn) {
    try {
      facts = await pdlCompany(pdl, { name, domain: hint })
      if (facts) stats.pdl++
    } catch (err) {
      if (err instanceof PdlError && err.status === 402) {
        pdlOn = false
        console.log('PDL free company credits used up; continuing with free sources only.')
      }
    }
  }
  const domain0 = facts?.domain ?? hint ?? (await wikidataDomain(name))
  const [edgar, wikidata] = await Promise.all([
    edgarLookup(name).catch(() => undefined),
    wikidataLookup(name, domain0).catch(() => undefined),
  ])
  if (edgar) stats.edgar++
  if (wikidata) stats.wiki++
  facts = mergeExtras(facts as never, { edgar: edgar ?? null, wikidata: wikidata ?? null, jobs: [] } as never) as Obj
  const domain = facts?.domain ?? domain0
  if (domain) {
    const site = await readSite(domain).catch(() => undefined)
    if (site?.ok) {
      const jobs = site.jobs.slice(0, 40).map((j) => Object.fromEntries(Object.entries(j).filter(([, v]) => v)))
      if (jobs.length) stats.jobs++
      facts = {
        ...facts,
        domain,
        siteUrl: facts?.siteUrl ?? site.url,
        ...(jobs.length ? { hiring: jobs, jobsTotal: site.jobs.length } : {}),
        sources: [...new Set([...(facts?.sources ?? []), site.url].filter(Boolean))].slice(0, 30),
      }
    }
  }
  if (!facts || !Object.keys(facts).some((k) => k !== 'sources')) {
    stats.none++
    return { status: 'no_site', note: 'No company record was found in free sources.', at, model: BATCH }
  }
  stats.found++
  return {
    status: 'found',
    ...facts,
    note: 'From free sources: People Data Labs (free credits), SEC EDGAR, Wikidata and the company’s job boards.',
    model: BATCH,
    at,
  }
}

for (const profile of await store.listProfiles()) {
  const records = await all(profile.id)
  const groups = new Map<string, { name: string; hint?: string; people: StoredRecord[] }>()
  for (const r of records) {
    const c = r.data as Obj
    if (!c.company || PLACEHOLDER.test(c.company)) continue
    const key = companyKey(c as never)
    if (!key) continue
    const g = groups.get(key) ?? { name: c.company, people: [] }
    g.hint ??= domainOf(c.enrichment?.website) ?? c.research?.domain
    g.people.push(r)
    groups.set(key, g)
  }
  const todo = [...groups.values()]
    .filter((g) => !g.people.some((p) => (p.data as Obj).research?.status === 'found'))
    .filter((g) => !g.people.every((p) => (p.data as Obj).research?.model === BATCH))
    .sort((a, b) => b.people.length - a.people.length)
    .slice(0, limit)
  console.log(`${profile.name}: ${records.length} people, ${groups.size} companies, ${todo.length} to fill`)

  const queue = [...todo]
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift()!
      const r = await research(g.name, g.hint)
      stats.companies++
      stats.people += g.people.length
      if (!dry)
        await store.write(
          profile.id,
          'contacts',
          g.people.map((p) => ({ id: p.id, data: apply(p.data as Obj, r) })),
        )
      console.log(
        `${stats.companies}/${todo.length} ${g.name} (${g.people.length}): ${r.status}${r.domain ? ` ${r.domain}` : ''}${r.hiring?.length ? `, ${r.hiring.length} jobs` : ''}`,
      )
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
}
console.log(JSON.stringify({ ...stats, pdlCreditsUsed: pdl.credits, pdlLeft: pdl.remaining }))
