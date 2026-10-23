import { classifyTitle } from './classify-title'
import type { ColumnMapping } from './csv'
import type { Contact, ContactSource } from './schemas'

const LEGAL_SUFFIX =
  /\b(inc|incorporated|llc|ltd|limited|plc|corp|corporation|co|company|gmbh|pvt|private|pte|sa|ag|bv)\b\.?/g

/** "Contoso, Inc." and "contoso" are the same company. */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,()'’"]/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/[^\p{L}\p{N}&+]+/gu, ' ')
    .trim()
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Accepts LinkedIn's "15 Oct 2024", ISO "2024-10-15", and "Oct 15, 2024". Returns ISO date or undefined. */
export function parseConnectedOn(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim()
  if (!s) return undefined

  let m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS[m[2].toLowerCase()]
    if (month) return valid(+m[3], month, +m[1])
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS[m[1].toLowerCase()]
    if (month) return valid(+m[3], month, +m[2])
  }
  return undefined
}

function valid(y: number, mo: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return undefined
  return `${y}-${pad(mo)}-${pad(d)}`
}

// Control characters never belong in names or titles, so imported text is stripped of them.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

const clean = (s: string | undefined, max: number) =>
  (s ?? '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** Only real LinkedIn profile URLs are kept; anything else is dropped rather than trusted. */
export function normalizeProfileUrl(raw: string | undefined): string | undefined {
  const s = clean(raw, 500)
  if (!s) return undefined
  try {
    const url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return undefined
    if (!/^\/(in|pub|sales\/lead|sales\/people)\//i.test(url.pathname)) return undefined
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}

export function normalizeEmail(raw: string | undefined): string | undefined {
  const s = clean(raw, 320).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined
}

/** FNV-1a 64-bit (as two 32-bit halves) — stable, sync, good enough for de-duplication keys. */
export function stableId(key: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

export function contactKey(c: { profileUrl?: string; fullName: string; company?: string }): string {
  if (c.profileUrl) return `url:${c.profileUrl.toLowerCase()}`
  return `name:${c.fullName.toLowerCase()}|${(c.company ?? '').toLowerCase()}`
}

export type RowResult = { ok: true; contact: Contact } | { ok: false; reason: string }

export function rowToContact(row: string[], mapping: ColumnMapping, source: ContactSource, now: string): RowResult {
  const get = (k: keyof ColumnMapping, max: number) => {
    const idx = mapping[k]
    return idx === undefined ? '' : clean(row[idx], max)
  }

  let firstName = get('firstName', 200)
  let lastName = get('lastName', 200)
  let fullName = get('fullName', 400)
  if (!fullName) fullName = `${firstName} ${lastName}`.trim()
  if (!firstName && fullName) {
    const parts = fullName.split(' ')
    firstName = parts[0]
    lastName = parts.slice(1).join(' ')
  }
  if (!fullName) return { ok: false, reason: 'No name' }

  const profileUrl = normalizeProfileUrl(get('profileUrl', 500))
  const company = get('company', 300) || undefined
  const position = get('position', 500) || undefined
  const base = { profileUrl, fullName, company }

  return {
    ok: true,
    contact: {
      id: stableId(contactKey(base)),
      firstName,
      lastName,
      fullName,
      profileUrl,
      email: normalizeEmail(get('email', 320)),
      company,
      position,
      connectedOn: parseConnectedOn(get('connectedOn', 40)),
      source,
      importedAt: now,
      updatedAt: now,
      ...classifyTitle(position),
      status: 'new',
      tags: [],
    },
  }
}

/** Re-import keeps everything the user owns (status, tags, notes, manual location). */
export function mergeContact(existing: Contact, incoming: Contact): Contact {
  const position = incoming.position ?? existing.position
  const company = incoming.company ?? existing.company
  // The HQ belongs to the old employer once someone changes job.
  const movedCompany =
    !!existing.company && !!company && normalizeCompany(existing.company) !== normalizeCompany(company)
  return {
    ...existing,
    companyHq: movedCompany ? undefined : existing.companyHq,
    // Apollo's company details belong to the old employer too.
    apollo: movedCompany ? undefined : existing.apollo,
    research: movedCompany ? undefined : existing.research,
    firstName: incoming.firstName || existing.firstName,
    lastName: incoming.lastName || existing.lastName,
    fullName: incoming.fullName || existing.fullName,
    profileUrl: incoming.profileUrl ?? existing.profileUrl,
    email: incoming.email ?? existing.email,
    company: incoming.company ?? existing.company,
    position,
    connectedOn: incoming.connectedOn ?? existing.connectedOn,
    updatedAt: incoming.updatedAt,
    ...classifyTitle(position),
  }
}

export function sameSourceData(a: Contact, b: Contact): boolean {
  return (
    a.fullName === b.fullName &&
    a.profileUrl === b.profileUrl &&
    a.email === b.email &&
    a.company === b.company &&
    a.position === b.position &&
    a.connectedOn === b.connectedOn
  )
}
