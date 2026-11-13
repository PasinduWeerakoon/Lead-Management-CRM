/**
 * Free batch: officer and director roles from SEC EDGAR insider filings (Forms 3 and 4), added to each
 * person's work history. A filing counts only when the filer's name matches the person AND the company
 * matches their employer or a company already in their work history, so namesakes are never attached.
 * The title comes from the filing itself. SEC allows 10 requests a second; this stays well under.
 *
 *   DATA_TABLE=leadsapp-data AWS_REGION=ap-south-1 npx tsx scripts/fill-people-edgar.mts [--limit N] [--dry]
 */
import { getStore, type StoredRecord } from '../api/_store.ts'

const UA = 'LeadsManager/1.0 (1 Billion Technology; internal research tool)'
const args = process.argv.slice(2)
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity
const dry = args.includes('--dry')
type Obj = Record<string, any>

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let last = 0
async function sec(url: string): Promise<any> {
  const gap = 150 - (Date.now() - last) // under 7 requests a second
  if (gap > 0) await wait(gap)
  last = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/xml' } }).catch(
    () => undefined,
  )
  if (!res?.ok) return undefined
  return url.endsWith('.json') || url.includes('efts.sec.gov') ? res.json().catch(() => undefined) : res.text()
}

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|plc|lp|holdings?|group|the|n\.?v|s\.?a)\b/g
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const sameCompany = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  return x.length >= 3 && y.length >= 3 && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `))
}
/** "Alice Avanian, CFA" → ["alice", "avanian"]; credentials and middle initials are ignored. */
function nameParts(full: string) {
  const words = full
    .split(',')[0]
    .replace(/\b(dr|mr|mrs|ms|prof|jr|sr|ii|iii|iv|phd|mba|md|cfa|cpa|pmp)\b\.?/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
  return words.length >= 2 ? { first: words[0], last: words[words.length - 1] } : undefined
}
const title = (s: string) => s.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (_, a, b) => a + b.toUpperCase())

interface Role {
  company: string
  role: string
  from: string
  to: string
  url: string
}

/** The person's role in one Form 3/4, from its XML. */
async function roleIn(adsh: string, issuerCik: string): Promise<string | undefined> {
  const dir = `https://www.sec.gov/Archives/edgar/data/${Number(issuerCik)}/${adsh.replace(/-/g, '')}`
  const index = await sec(`${dir}/index.json`)
  const xml = (index?.directory?.item ?? []).map((i: Obj) => i.name).find((n: string) => /\.xml$/i.test(n))
  if (!xml) return undefined
  const doc: string = (await sec(`${dir}/${xml}`)) ?? ''
  const officer = doc.match(/<officerTitle>\s*([^<]+?)\s*<\/officerTitle>/i)?.[1]
  const director = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(doc)
  const owner10 = /<isTenPercentOwner>\s*(1|true)\s*<\/isTenPercentOwner>/i.test(doc)
  return officer
    ? title(officer) + (director ? ', Director' : '')
    : director
      ? 'Director'
      : owner10
        ? '10% owner'
        : undefined
}

async function edgarRoles(c: Obj, employers: string[]): Promise<Role[]> {
  const n = nameParts(c.fullName)
  if (!n || !employers.length) return []
  const q = new URLSearchParams({ q: `"${n.first} ${n.last}"`, forms: '3,4' })
  const res = await sec(`https://efts.sec.gov/LATEST/search-index?${q}`)
  const hits: Obj[] = res?.hits?.hits ?? []
  // Group this person's filings by company: [owner, issuer] in display_names.
  const byCompany = new Map<string, { name: string; cik: string; dates: string[]; adsh: string }>()
  for (const h of hits) {
    const names: string[] = h._source?.display_names ?? []
    const owner = names.find((x) => {
      const t = x.toLowerCase()
      return t.includes(n.first) && t.includes(n.last)
    })
    if (!owner) continue
    for (const other of names) {
      if (other === owner) continue
      const m = other.match(/^(.*?)\s+(?:\([A-Z.\-]+\)\s+)?\(CIK (\d+)\)/)
      if (!m) continue
      const company = m[1].trim()
      if (!employers.some((e) => sameCompany(e, company))) continue
      const g = byCompany.get(m[2]) ?? { name: company, cik: m[2], dates: [], adsh: String(h._id).split(':')[0] }
      g.dates.push(h._source.file_date)
      // The newest filing gives the current title.
      if (h._source.file_date >= g.dates.reduce((a, b) => (a > b ? a : b))) g.adsh = String(h._id).split(':')[0]
      byCompany.set(m[2], g)
    }
  }
  const out: Role[] = []
  for (const g of byCompany.values()) {
    const role = await roleIn(g.adsh, g.cik)
    if (!role) continue
    const dates = g.dates.sort()
    out.push({
      company: title(g.name),
      role,
      from: dates[0].slice(0, 4),
      // A filing in the last 18 months means they still hold the role.
      to:
        Date.now() - Date.parse(dates[dates.length - 1]) < 548 * 86_400_000
          ? 'present'
          : dates[dates.length - 1].slice(0, 4),
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${g.cik}&type=4&owner=include`,
    })
  }
  return out
}

const store = (await getStore())!
const stats = { checked: 0, matched: 0, roles: 0 }
for (const profile of await store.listProfiles()) {
  const people: StoredRecord[] = []
  for (let after = 0; ;) {
    const { records, more } = await store.changes(profile.id, 'contacts', after, 1000)
    people.push(...records.filter((r) => !r.deleted && r.data))
    if (!more || !records.length) break
    after = records[records.length - 1].srv
  }
  const todo = people.filter((r) => !(r.data as Obj).web?.secAt).slice(0, limit)
  console.log(`${profile.name}: checking ${todo.length} people in SEC EDGAR`)
  for (const r of todo) {
    const c = r.data as Obj
    const employers = [c.company, ...((c.web?.career ?? []) as Obj[]).map((j) => j.company)].filter(Boolean)
    const roles = await edgarRoles(c, employers).catch(() => [])
    stats.checked++
    const at = new Date().toISOString()
    const prev: Obj = c.web ?? {}
    const career: Obj[] = [...(prev.career ?? [])]
    for (const x of roles) {
      const same = career.find((j) => sameCompany(String(j.company), x.company))
      // SEC returns the most relevant filings, not all of them, so an old last filing doesn't prove the role ended.
      const years = x.to === 'present' ? `${x.from}–present` : `from ${x.from}`
      if (same)
        Object.assign(same, {
          role: same.role ?? x.role,
          years: same.years && same.years !== 'present' ? same.years : years,
        })
      else career.push({ company: x.company, role: x.role, years, url: x.url })
    }
    if (roles.length) {
      stats.matched++
      stats.roles += roles.length
      console.log(
        `${stats.checked} ${c.fullName}: ${roles.map((x) => `${x.role} @ ${x.company} (${x.from}–${x.to})`).join('; ')}`,
      )
    }
    // People with no SEC role are left exactly as they were.
    if (roles.length && !dry) {
      const web = {
        ...prev,
        status: 'found',
        ...(prev.status === 'found'
          ? {}
          : {
              match: 'confident',
              model: 'sec-edgar',
              note: 'Officer or director roles from SEC EDGAR insider filings.',
            }),
        career: career.slice(0, 15),
        sources: [...new Set([...(prev.sources ?? []), ...roles.map((x) => x.url)])].slice(0, 12),
        at: prev.at ?? at,
        secAt: at,
      }
      await store.write(profile.id, 'contacts', [{ id: r.id, data: { ...c, web } }])
    }
    if (stats.checked % 200 === 0) console.log(`… ${stats.checked} checked, ${stats.matched} with SEC roles`)
  }
}
console.log(JSON.stringify(stats))
