import { describe, expect, it, vi } from 'vitest'
import { githubUser, validateWeb, workEmail, type WebOutput } from '../src/lib/research/person'
import { fetchGithub } from '../src/lib/research/github'

const base: WebOutput = {
  match: 'confident',
  summary: null,
  location: null,
  career: [{ company: 'Example Co', role: 'CTO', years: null, url: 'https://example.com/team' }],
  education: [],
  certifications: [],
  projects: [],
  work_email: null,
  work_phone: null,
  github: null,
  keywords: [],
  facts: [],
}
const SOURCES = ['https://example.com/team']

describe('work contact details', () => {
  it('keeps only published work emails, never webmail', () => {
    expect(workEmail('ana@example.com')).toBe(true)
    expect(workEmail('ana@gmail.com')).toBe(false)
    expect(workEmail('not an email')).toBe(false)
  })

  it('needs the page the detail was found on', () => {
    const ok = validateWeb(
      {
        ...base,
        work_email: { value: 'Ana@Example.com', url: 'https://example.com/team' },
        work_phone: { value: '+94 11 234 5678', url: 'https://example.com/team' },
      },
      SOURCES,
      'm',
    )
    expect(ok.email?.value).toBe('ana@example.com')
    expect(ok.phone?.value).toBe('+94 11 234 5678')
    const made = validateWeb(
      { ...base, work_email: { value: 'ana@example.com', url: 'https://invented.example.net/' } },
      SOURCES,
      'm',
    )
    expect(made.email).toBeUndefined()
  })

  it('reads a GitHub profile URL', () => {
    expect(githubUser('https://github.com/octocat')).toBe('octocat')
    expect(githubUser('https://github.com/octocat/repo')).toBeUndefined()
    expect(githubUser('https://gitlab.com/octocat')).toBeUndefined()
  })

  it('summarises a GitHub profile and its own repos', async () => {
    const f = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/repos')
              ? [
                  {
                    name: 'app',
                    description: 'A tool',
                    language: 'TypeScript',
                    stargazers_count: 5,
                    html_url: 'https://github.com/o/app',
                  },
                  { name: 'forked', language: 'Go', html_url: 'https://github.com/o/forked', fork: true },
                ]
              : { bio: 'Builder', public_repos: 2, followers: 9 },
          ),
        ),
    ) as unknown as typeof fetch
    const g = await fetchGithub('o', f)
    expect(g?.languages).toEqual(['TypeScript'])
    expect(g?.repos?.map((r) => r.name)).toEqual(['app'])
    expect(g?.followers).toBe(9)
  })
})

describe('combining the general and LinkedIn searches', () => {
  it('joins lists without repeats and keeps the stronger match', async () => {
    const { mergeWeb } = await import('../src/lib/research/person')
    const a = {
      status: 'found' as const,
      match: 'likely' as const,
      career: [{ company: 'WSO2', url: 'https://a' }],
      facts: [{ text: 'Spoke at a summit.', url: 'https://a' }],
      at: 'x',
    }
    const b = {
      status: 'found' as const,
      match: 'confident' as const,
      career: [
        { company: 'wso2', url: 'https://b' },
        { company: 'IBM Research', url: 'https://b' },
      ],
      education: [{ school: 'Purdue University', url: 'https://b' }],
      at: 'y',
    }
    const m = mergeWeb(a, b)
    expect(m.match).toBe('confident')
    expect(m.career?.map((c) => c.company)).toEqual(['WSO2', 'IBM Research'])
    expect(m.education?.[0].school).toBe('Purdue University')
    expect(mergeWeb(a, { status: 'not_found', at: 'z' })).toBe(a)
  })
})
