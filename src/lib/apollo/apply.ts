import { rank } from '../company-hq'
import type { Contact } from '../schemas'
import type { ApolloPersonRaw, ApolloPhoneRaw } from './client'

export type ApolloCache = NonNullable<Contact['apollo']>

const text = (v: unknown, max: number) => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s ? s.slice(0, max) : undefined
}

/** Keeps the fields the app uses from Apollo's person record. */
export function toApolloCache(raw: ApolloPersonRaw | null, now: string): ApolloCache {
  if (!raw) return { matched: false, at: now }
  const org = raw.organization
  const size = org?.estimated_num_employees
  const technologies = (org?.technology_names ?? [])
    .map((t) => text(t, 80))
    .filter((t): t is string => !!t)
    .slice(0, 80)
  const orgCache = org
    ? Object.fromEntries(
        Object.entries({
          name: text(org.name, 300),
          domain: text(org.primary_domain, 200)?.toLowerCase(),
          city: text(org.city, 100),
          state: text(org.state, 100),
          country: text(org.country, 100),
          industry: text(org.industry, 120),
          size: typeof size === 'number' && size > 0 ? String(size) : undefined,
          technologies: technologies.length ? technologies : undefined,
        }).filter(([, v]) => v !== undefined),
      )
    : undefined
  return Object.fromEntries(
    Object.entries({
      matched: true,
      id: text(raw.id, 40),
      confidence: text(raw.match_confidence, 10),
      email: text(raw.email, 320)?.toLowerCase(),
      emailStatus: text(raw.email_status, 30),
      city: text(raw.city, 100),
      state: text(raw.state, 100),
      country: text(raw.country, 100),
      org: orgCache && Object.keys(orgCache).length ? orgCache : undefined,
      at: now,
    }).filter(([, v]) => v !== undefined),
  ) as ApolloCache
}

export const placeOf = (p?: { city?: string; state?: string; country?: string }) =>
  p ? [p.city, p.state, p.country].filter(Boolean).join(', ') : ''

/**
 * Saves an Apollo lookup on a person and fills the regular columns it answers — location, company
 * HQ, website, industry, size — without ever replacing something you typed or imported.
 */
export function applyApollo(c: Contact, cache: ApolloCache, now: string): Contact {
  const next: Contact = { ...c, apollo: cache, apolloError: undefined }
  if (!cache.matched) return next

  const personPlace = placeOf(cache)
  if (personPlace && c.location?.origin !== 'manual') next.location = { value: personPlace, origin: 'enriched' }

  const org = cache.org
  const hqPlace = placeOf(org)
  if (hqPlace) {
    const hq = { status: 'found' as const, value: hqPlace, origin: 'provider' as const, source: 'Apollo', at: now }
    if (!c.companyHq || rank(c.companyHq) <= rank(hq)) next.companyHq = hq
  }

  const website = org?.domain ? `https://${org.domain}` : undefined
  const e = c.enrichment
  if (website || org?.industry || org?.size) {
    next.enrichment = {
      ...e,
      ...(website && !e?.website ? { website } : {}),
      ...(org?.industry && !e?.industry ? { industry: org.industry } : {}),
      ...(org?.size && !e?.companySize ? { companySize: org.size } : {}),
      source: e?.source ?? 'Apollo',
      updatedAt: now,
    }
  }
  return next
}

/** Phone numbers from Apollo's delayed result, mobile first. */
export function toPhoneNumbers(raw: ApolloPhoneRaw[] | undefined) {
  const seen = new Set<string>()
  return (raw ?? [])
    .map((p) => ({
      number: text(p.sanitized_number ?? p.raw_number, 40) ?? '',
      type: text(p.type_cd ?? p.type, 30),
      bad: /invalid|no_status_invalid/i.test(p.status_cd ?? ''),
    }))
    .filter((p) => p.number && !p.bad && !seen.has(p.number) && seen.add(p.number))
    .sort((a, b) => Number(b.type === 'mobile') - Number(a.type === 'mobile'))
    .slice(0, 10)
    .map(({ number, type }) => (type ? { number, type } : { number }))
}

/** Company technologies from every source: Apollo plus what company research quoted from the website. */
export function companyTechnologies(c: Contact): string[] {
  const all = [...(c.apollo?.org?.technologies ?? []), ...(c.research?.technologies?.map((t) => t.name) ?? [])]
  const seen = new Set<string>()
  return all.filter((t) => {
    const k = t.toLowerCase()
    return !seen.has(k) && !!seen.add(k)
  })
}

/** Text the "Technologies" filter searches. */
export const technologiesText = (c: Contact) => companyTechnologies(c).join('\n') || undefined
