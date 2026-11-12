import type { PersonWeb } from './person'

/**
 * GitHub's free public API: a person's profile and their most recent public repositories. Only used
 * for a username a web page clearly linked to this person. No key needed (60 lookups an hour).
 */

interface GhUser {
  bio?: string | null
  company?: string | null
  blog?: string | null
  public_repos?: number
  followers?: number
}
interface GhRepo {
  name: string
  description?: string | null
  language?: string | null
  stargazers_count?: number
  html_url: string
  fork?: boolean
}

const text = (v: string | null | undefined, max: number) =>
  v?.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined

export async function fetchGithub(
  user: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<PersonWeb['githubProfile'] | undefined> {
  const get = async <T>(path: string): Promise<T | undefined> => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    }).catch(() => undefined)
    return res?.ok ? ((await res.json()) as T) : undefined
  }
  const profile = await get<GhUser>(`/users/${encodeURIComponent(user)}`)
  if (!profile) return undefined
  const repos = (await get<GhRepo[]>(`/users/${encodeURIComponent(user)}/repos?sort=updated&per_page=30`)) ?? []
  const own = repos.filter((r) => !r.fork)
  const languages = [...new Set(own.map((r) => r.language).filter((l): l is string => !!l))].slice(0, 15)
  return {
    ...(text(profile.bio, 300) ? { bio: text(profile.bio, 300) } : {}),
    ...(text(profile.company, 120) ? { company: text(profile.company, 120) } : {}),
    ...(text(profile.blog, 300) ? { blog: text(profile.blog, 300) } : {}),
    publicRepos: profile.public_repos ?? 0,
    followers: profile.followers ?? 0,
    ...(languages.length ? { languages } : {}),
    repos: own
      .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
      .slice(0, 10)
      .map((r) => ({
        name: r.name.slice(0, 120),
        ...(text(r.description, 300) ? { description: text(r.description, 300) } : {}),
        ...(r.language ? { language: r.language.slice(0, 40) } : {}),
        stars: r.stargazers_count ?? 0,
        url: r.html_url.slice(0, 500),
      })),
  }
}
