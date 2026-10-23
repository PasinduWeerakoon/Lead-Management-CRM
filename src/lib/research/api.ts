import { AiError } from '../ai/provider'
import { readAccessCode } from '../sync/api'
import type { SitePage, SiteJob } from './extract'

export interface SiteResponse {
  ok: boolean
  url?: string
  title?: string
  pages: SitePage[]
  jobs: SiteJob[]
  blocked: string[]
  matchesCompany: boolean
  error?: string
}

/** Asks this app's /api/research function to read a company's public site and job board. */
export async function readSiteRemote(domain: string, company: string, signal?: AbortSignal): Promise<SiteResponse> {
  const code = readAccessCode()
  let res: Response
  try {
    res = await fetch('/api/research', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...(code ? { 'x-app-key': code } : {}) },
      body: JSON.stringify({ domain, company }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new AiError('Stopped.', 'cancelled')
    throw new AiError("Couldn't reach the app's server to read websites.", 'network')
  }
  const data = (await res.json().catch(() => ({}))) as SiteResponse & { error?: string }
  if (res.status === 401) throw new AiError('Enter the workspace access code (sidebar) to read websites.', 'auth')
  if (!res.ok) return { ok: false, pages: [], jobs: [], blocked: [], matchesCompany: false, error: data.error }
  return data
}
