import { afterEach, describe, expect, it } from 'vitest'
import { hunterEmail, normName, wikidataLookup } from '../api/_sources'
import { mergeExtras } from '../src/lib/research/sources'

const reply = (body: unknown) => new Response(JSON.stringify(body))

describe('free company sources', () => {
  it('compares company names without legal suffixes', () => {
    expect(normName('Microsoft Corp.')).toBe(normName('MICROSOFT CORPORATION'))
    expect(normName('Sysco LABS (Pvt) Ltd')).toBe('sysco labs')
  })

  it('only uses a Wikidata item whose website is the company’s, with current values', async () => {
    const f = (async (url: string) => {
      if (url.includes('wbsearchentities')) return reply({ search: [{ id: 'Q1' }, { id: 'Q2' }] })
      if (url.includes('props=labels&'))
        return reply({
          entities: { Q9: { labels: { en: { value: 'New CEO' } } }, Q8: { labels: { en: { value: 'Old CEO' } } } },
        })
      return reply({
        entities: {
          Q1: {
            labels: { en: { value: 'Namesake' } },
            claims: { P856: [{ mainsnak: { datavalue: { value: 'https://other.com' } } }] },
          },
          Q2: {
            labels: { en: { value: 'Contoso' } },
            claims: {
              P856: [{ mainsnak: { datavalue: { value: 'https://www.contoso.com/' } } }],
              P169: [
                { mainsnak: { datavalue: { value: { id: 'Q8' } } }, qualifiers: { P582: [{}] } },
                { mainsnak: { datavalue: { value: { id: 'Q9' } } } },
              ],
            },
          },
        },
      })
    }) as unknown as typeof fetch
    const w = await wikidataLookup('Contoso', 'contoso.com', f)
    expect(w?.label).toBe('Contoso')
    expect(w?.ceo).toBe('New CEO')
    expect(await wikidataLookup('Contoso', undefined, f)).toBeUndefined()
  })

  it('adds registry, Wikidata and job-board facts without replacing found ones', () => {
    const out = mergeExtras(
      { industry: { value: 'Banking', url: 'https://contoso.com', quote: 'bank' }, hiring: [{ title: 'QA Engineer' }] },
      {
        edgar: { name: 'CONTOSO INC', ticker: 'CTSO', industry: 'Services', url: 'https://sec.gov/x' },
        wikidata: { label: 'Contoso', founded: '1999', ceo: 'Ana Example', url: 'https://wikidata.org/Q2' },
        jobs: [
          { title: 'QA Engineer', url: 'https://adzuna/1' },
          { title: 'AWS Engineer', url: 'https://adzuna/2', salary: '$120,000–$150,000' },
        ],
      },
    )
    expect(out?.industry?.value).toBe('Banking')
    expect(out?.registry?.ticker).toBe('CTSO')
    expect(out?.founded?.value).toBe('1999')
    expect(out?.leaders?.[0]).toMatchObject({ name: 'Ana Example', title: 'CEO' })
    expect(out?.hiring?.map((j) => j.title)).toEqual(['QA Engineer', 'AWS Engineer'])
    expect(out?.hiring?.[1]).toMatchObject({ source: 'Adzuna', salary: '$120,000–$150,000' })
  })
})

describe('Hunter work emails', () => {
  afterEach(() => {
    delete process.env.HUNTER_API_KEY
  })
  it('keeps only emails found on pages or verified, never a bare guess', async () => {
    process.env.HUNTER_API_KEY = 'test'
    const found = await hunterEmail('Ana', 'Example', 'contoso.com', (async () =>
      reply({
        data: { email: 'Ana@contoso.com', sources: [{ uri: 'https://contoso.com/team' }] },
      })) as unknown as typeof fetch)
    expect(found).toMatchObject({ email: 'ana@contoso.com', url: 'https://contoso.com/team' })
    const guess = await hunterEmail('Ana', 'Example', 'contoso.com', (async () =>
      reply({
        data: { email: 'ana@contoso.com', sources: [], verification: { status: 'accept_all' } },
      })) as unknown as typeof fetch)
    expect(guess).toBeUndefined()
  })
})
