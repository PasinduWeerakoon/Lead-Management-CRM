import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { classifyTitle } from '../src/lib/classify-title'
import { db } from '../src/lib/db'
import { accuracyStats, currentMark, pickToCheck, setMark } from '../src/lib/accuracy'
import type { Contact } from '../src/lib/schemas'

let seq = 0
const person = (title: string, extra: Partial<Contact> = {}): Contact => ({
  id: `q${++seq}`,
  firstName: 'A',
  lastName: String(seq),
  fullName: `A ${seq}`,
  company: 'Contoso',
  position: title,
  source: 'linkedin_export',
  importedAt: '',
  updatedAt: '',
  status: 'new',
  tags: [],
  ...classifyTitle(title),
  ...extra,
})

describe('accuracy marks', () => {
  beforeEach(async () => {
    await db.contacts.clear()
  })

  it('records ✓/✗ against the value you judged, and clears on a second click', async () => {
    const c = person('Chief Information Officer')
    await db.contacts.put(c)
    await setMark(c.id, 'seniority', true)
    let saved = (await db.contacts.get(c.id))!
    expect(saved.feedback?.seniority).toMatchObject({ ok: true, value: 'C-level' })
    expect(currentMark(saved, 'seniority')).toBe(true)
    await setMark(c.id, 'seniority', undefined)
    saved = (await db.contacts.get(c.id))!
    expect(saved.feedback).toBeUndefined()
  })

  it('stops counting a mark once the value changes', async () => {
    const c = person('CIO', { companyHq: { status: 'found', value: 'Kandy', origin: 'ai', at: '' } })
    await db.contacts.put(c)
    await setMark(c.id, 'companyHq', false)
    const changed = {
      ...(await db.contacts.get(c.id))!,
      companyHq: { status: 'found' as const, value: 'Colombo', origin: 'web' as const, at: '' },
    }
    expect(currentMark(changed, 'companyHq')).toBeUndefined()
  })
})

describe('accuracy numbers', () => {
  const hq = (value: string, origin: 'ai' | 'web') => ({ status: 'found' as const, value, origin, at: '' })
  const mark = (c: Contact, key: string, value: string, ok: boolean): Contact => ({
    ...c,
    feedback: { ...c.feedback, [key]: { ok, value, at: '' } },
  })

  it('computes accuracy per item and per source, and lists the wrong ones', () => {
    const people = [
      mark(person('CIO', { companyHq: hq('Colombo', 'web') }), 'companyHq', 'Colombo', true),
      mark(person('CIO', { companyHq: hq('Colombo', 'web') }), 'companyHq', 'Colombo', true),
      mark(person('CIO', { companyHq: hq('Boston', 'ai') }), 'companyHq', 'Boston', false),
      mark(person('CIO', { companyHq: hq('Tokyo', 'ai') }), 'companyHq', 'Tokyo', true),
      person('CIO', { companyHq: hq('Galle', 'ai') }),
    ]
    const s = accuracyStats(people).find((x) => x.key === 'companyHq')!
    expect(s).toMatchObject({ withValue: 5, checked: 4, correct: 3, accuracy: 0.75 })
    expect(s.bySource).toEqual([
      { source: 'Website', checked: 2, correct: 2, accuracy: 1 },
      { source: 'AI guess', checked: 2, correct: 1, accuracy: 0.5 },
    ])
    expect(s.wrong.map((w) => w.value)).toEqual(['Boston'])
  })

  it('picks people who still have unchecked values, spread across the list', () => {
    const people = Array.from({ length: 40 }, (_, i) => person(i % 2 ? 'CIO' : 'Software Engineer'))
    const picked = pickToCheck(people, 10, 3)
    expect(picked).toHaveLength(10)
    expect(new Set(picked.map((p) => p.id)).size).toBe(10)
    const allChecked = people.map((p) =>
      mark(mark(p, 'seniority', p.seniority === 'IC' ? 'Individual' : p.seniority, true), 'function', p.function, true),
    )
    const roleTagged = allChecked.filter((p) => p.titleTags.length)
    expect(pickToCheck(allChecked, 10).every((p) => roleTagged.includes(p))).toBe(true)
  })
})
