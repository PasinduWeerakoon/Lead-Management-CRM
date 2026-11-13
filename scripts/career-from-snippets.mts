/**
 * Work history from search-result text, without AI. People-directory and profile snippets use a few
 * fixed phrasings ("works at X as Y", "previously a Y at X", "previous roles at A, B and C",
 * "began their career as Y at X", "Experience: X"), so only those are read. Anything that looks like a
 * place or a school is never taken as an employer.
 */

export const validEmployer = (company?: string, role?: string) => okCompany(company) && (!role || okRole(role))

export interface Job {
  company: string
  role?: string
  years?: string
  url: string
}

const PLACE =
  /\b(united states|united kingdom|sri lanka|india|canada|australia|area|greater|metropolitan|massachusetts|california|new york|texas|colombo|london|boston)\b|,\s*[A-Z]{2}\b/i
const SCHOOL = /\b(university|college|school of|institute of technology|academy)\b/i
const clean = (s: string | undefined) =>
  s
    ?.split(/\.\s|\.\.|\s[|·]\s/)[0] // stop at the end of the sentence
    .replace(/\s+/g, ' ')
    .replace(/^[\s|·:,-]+/, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[\s.,;:·|]+$/, '')
    .trim()
const okCompany = (s?: string) => !!s && s.length >= 2 && s.length <= 80 && !PLACE.test(s) && !/[@*]/.test(s)
const okRole = (s?: string) =>
  !!s && s.length >= 2 && s.length <= 100 && !SCHOOL.test(s) && !/[@*]|^based\b|^located\b/i.test(s)

/** Splits "Nymbl, Terminus and Mendix" into three names. */
const list = (s: string) =>
  s
    .split(/,\s*|\s+and\s+/)
    .map(clean)
    .filter((x): x is string => !!x)

export function careerFromText(text: string, url: string, current?: { company?: string }): Job[] {
  // Saved text may be cut off mid-word; the last few characters are never trusted as a name.
  const t = text.replace(/\s+/g, ' ').replace(/\S*$/, text.length >= 395 ? '' : '$&')
  const jobs: Job[] = []
  const add = (company?: string, role?: string, now = false) => {
    company = clean(company)
    role = clean(role)
    if (!okCompany(company)) return
    if (role && !okRole(role)) role = undefined
    // "Tufts" and "Tufts University" are the same employer; the longer name is kept.
    const k = company!.toLowerCase()
    const same = jobs.find((j) => {
      const o = j.company.toLowerCase()
      return o === k || o.startsWith(`${k} `) || k.startsWith(`${o} `)
    })
    if (same && company!.length > same.company.length) same.company = company!
    if (same) {
      same.role ??= role
      if (now) same.years = 'present'
      return
    }
    jobs.push({ company: company!, ...(role ? { role } : {}), ...(now ? { years: 'present' } : {}), url })
  }
  const N = "[A-Z][\\w&.'’-]*(?:\\s+(?:[A-Z&][\\w&.'’-]*|of|and|for|the|de))*" // a capitalised name
  const R = '[^.,;]{2,90}?' // a role
  for (const m of t.matchAll(new RegExp(`works (?:at|for) (${N}) as (?:an? |the )?(${R})(?=[.,;]|$)`, 'g')))
    add(m[1], m[2], true)
  for (const m of t.matchAll(new RegExp(`is (?:currently )?(?:an? |the )?(${R}) at (${N})`, 'g'))) add(m[2], m[1], true)
  for (const m of t.matchAll(new RegExp(`(?:was )?previously (?:an? |the )?(${R}) at (${N})`, 'g'))) add(m[2], m[1])
  for (const m of t.matchAll(new RegExp(`career as (?:an? |the )?(${R}) at (${N})`, 'g'))) add(m[2], m[1])
  for (const m of t.matchAll(new RegExp(`(?:positions|roles) such as:? ((?:${R} at ${N}(?:, | and )?){1,6})`, 'g')))
    for (const part of m[1].split(/,\s*|\s+and\s+(?=[A-Z])/)) {
      const x = part.match(new RegExp(`^(${R}) at (${N})$`))
      if (x) add(x[2], x[1])
    }
  for (const m of t.matchAll(
    new RegExp(`(?:previous roles|experience) (?:at|from previous roles at) ((?:${N})(?:(?:, | and )${N}){0,6})`, 'g'),
  ))
    for (const c of list(m[1])) add(c)
  for (const m of t.matchAll(new RegExp(`Experience: (${N})`, 'g'))) add(m[1], undefined, true)
  // The employer from the connections export is the current job when the text names it.
  const now = current?.company && jobs.find((j) => j.company.toLowerCase() === current.company!.toLowerCase())
  if (now) now.years = 'present'
  return jobs.slice(0, 10)
}
