/**
 * Free batch: one Brave web search per person who has no profile data yet, saved to the shared database.
 * Only what the search results show is kept (headline, current role, location, profile and personal
 * pages), each with its link. No AI, no LinkedIn login, no scraping of the pages themselves.
 *
 * Stays inside Brave's free monthly credit ($5, about 1,000 searches): a hard cap of MONTHLY_CAP
 * searches per calendar month, counted in .brave-usage.json before each search is sent. Brave's own
 * headers don't report credit use, so this count is the guard. Rerun each month to continue.
 *
 *   DATA_TABLE=leadsapp-data AWS_REGION=ap-south-1 BRAVE_API_KEY=… npx tsx scripts/fill-people-brave.mts [--limit N] [--dry]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getStore, type StoredRecord } from '../api/_store.ts'
import { careerFromText, validEmployer } from './career-from-snippets.mts'

const MONTHLY_CAP = 900
const LEDGER = new URL('../.brave-usage.json', import.meta.url)
const args = process.argv.slice(2)
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity
const dry = args.includes('--dry')
const key = process.env.BRAVE_API_KEY?.trim()
if (!key) throw new Error('Set BRAVE_API_KEY.')

type Obj = Record<string, any>
const month = new Date().toISOString().slice(0, 7)
const ledger: Record<string, number> = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {}
const used = () => ledger[month] ?? 0
/** Counted before the request goes out, so a crash can never let the count fall behind. */
function spend() {
  if (used() >= MONTHLY_CAP) return false
  ledger[month] = used() + 1
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))
  return true
}

const plain = (s: unknown) =>
  typeof s === 'string'
    ? s
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
const slug = (u?: string) => u?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function search(q: string): Promise<Obj[] | undefined> {
  if (!spend()) return undefined
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q, count: '10' })}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key! },
  })
  if (res.status === 429) {
    await wait(2000)
    return []
  }
  if (res.status === 401 || res.status === 402 || res.status === 403)
    throw new Error(`Brave refused the request (${res.status}). Stopping.`)
  if (!res.ok) return []
  return ((await res.json()) as Obj).web?.results ?? []
}

/** "Name - Role - Company | LinkedIn" or "Name - Role at Company | LinkedIn". */
function fromLinkedIn(r: Obj, name: string) {
  const title = plain(r.title).replace(/\s*\|\s*LinkedIn.*$/i, '')
  const parts = title.split(/\s+[-–]\s+/).map((s) => s.trim())
  if (parts[0]?.toLowerCase() !== name.toLowerCase()) parts.unshift(name)
  const headline = parts.slice(1).join(' - ') || undefined
  const at = headline?.match(/^(.*?)\s+at\s+(.+)$/i)
  const role = at ? at[1] : parts[1]
  const company = at ? at[2] : parts[2]
  const desc = plain(r.description)
  const location = desc.match(/Location:\s*([^·|]+?)(?:\s*[·|]|$)/i)?.[1]?.trim()
  return { headline, role, company, location, desc }
}

/** Work history from the LinkedIn result's title and every snippet, checked so places and schools never count as jobs. */
function careerOf(c: Obj, p: ReturnType<typeof fromLinkedIn> | undefined, li: Obj | undefined, others: Obj[]) {
  const text = [p?.desc, ...others.map((r) => plain(r.description))].filter(Boolean).join('. ')
  const jobs = careerFromText(text, li?.url ?? others[0]?.url ?? '', c)
  if (
    p?.company &&
    validEmployer(p.company, p.role) &&
    !jobs.some((j) => j.company.toLowerCase() === p.company!.toLowerCase())
  )
    jobs.unshift({ company: p.company, ...(p.role ? { role: p.role } : {}), years: 'present', url: li!.url })
  return jobs.length ? jobs.slice(0, 10) : undefined
}

function personWeb(c: Obj, results: Obj[]) {
  const at = new Date().toISOString()
  const name: string = c.fullName
  const first = name.split(/\s+/)[0]?.toLowerCase() ?? ''
  const last = name.split(/\s+/).slice(-1)[0]?.toLowerCase() ?? ''
  const mine = slug(c.profileUrl)
  const li = results.find((r) => mine && slug(r.url) === mine)
  // Other pages about this person: their name in the title, and their company or role on the page.
  const company = (c.company ?? '').toLowerCase().split(/\s+/)[0] ?? ''
  const others = results
    .filter((r) => r !== li && !/linkedin\.com\/in\//i.test(r.url))
    .filter((r) => {
      const t = plain(r.title).toLowerCase()
      const text = `${t} ${plain(r.description).toLowerCase()}`
      return t.includes(first) && t.includes(last) && (!company || text.includes(company))
    })
    .slice(0, 6)
  if (!li && !others.length)
    return {
      status: 'not_found',
      note: 'Nothing about this person was found in web search results.',
      at,
      model: 'brave',
    }
  const p = li ? fromLinkedIn(li, name) : undefined
  const github = others.map((r) => r.url.match(/github\.com\/([A-Za-z0-9-]{1,39})\/?$/)?.[1]).find(Boolean)
  const summary =
    [p?.headline, ...others.slice(0, 2).map((r) => plain(r.description))].filter(Boolean).join('. ').slice(0, 400) ||
    undefined
  return Object.fromEntries(
    Object.entries({
      status: 'found',
      match: li ? 'confident' : 'likely',
      summary,
      location: p?.location,
      career: careerOf(c, p, li, others),
      github,
      sources: [...(li ? [li.url] : []), ...others.map((r) => r.url)].slice(0, 8),
      note: 'From web search results (Brave): headline and pages that mention this person. No full work history.',
      model: 'brave',
      at,
    }).filter(([, v]) => v !== undefined),
  )
}

const store = (await getStore())!
let searched = 0
let found = 0
outer: for (const profile of await store.listProfiles()) {
  const people: StoredRecord[] = []
  for (let after = 0; ;) {
    const { records, more } = await store.changes(profile.id, 'contacts', after, 1000)
    people.push(...records.filter((r) => !r.deleted && r.data))
    if (!more || !records.length) break
    after = records[records.length - 1].srv
  }
  // People with no profile yet; those at companies we have data for first, then the rest.
  const todo = people
    .filter((r) => {
      const w = (r.data as Obj).web
      return !w || (w.status !== 'found' && w.model !== 'brave')
    })
    .sort(
      (a, b) =>
        Number((b.data as Obj).research?.status === 'found') - Number((a.data as Obj).research?.status === 'found'),
    )
    .slice(0, limit)
  console.log(`${profile.name}: ${todo.length} people to search; ${used()} of ${MONTHLY_CAP} used this month`)
  for (const r of todo) {
    const c = r.data as Obj
    const q = `"${c.fullName}" ${c.company ?? ''}`.trim()
    const results = await search(q)
    if (!results) {
      console.log(`Monthly free limit reached (${MONTHLY_CAP}). Stopping; run again next month.`)
      break outer
    }
    searched++
    const web = personWeb(c, results)
    if (web.status === 'found') found++
    if (!dry) await store.write(profile.id, 'contacts', [{ id: r.id, data: { ...c, web } }])
    console.log(
      `${used()}/${MONTHLY_CAP} ${c.fullName}: ${web.status}${web.summary ? ` | ${web.summary.slice(0, 80)}` : ''}`,
    )
    await wait(1100) // Brave's free rate is about 1 search a second.
  }
}
console.log(JSON.stringify({ searched, found, usedThisMonth: used(), cap: MONTHLY_CAP }))
