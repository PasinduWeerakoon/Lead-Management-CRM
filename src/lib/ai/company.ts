/**
 * The company OpenAI key lives on the server (/api/ai). The browser never sees it: it uses this
 * placeholder in place of a key, and requests carrying it go to /api/ai instead of OpenAI.
 */
export const COMPANY_KEY = '__company_key__'

export const isCompanyKey = (k: string | undefined) => k === COMPANY_KEY

export interface CompanyAi {
  provider: 'openai'
  capUsd: number
  spentUsd: number
  /** False when every server instance counts on its own (Vercel without a database). */
  shared: boolean
}

/** Fired when today's company limit is reached, so the app can show a notice wherever you are. */
export const CAP_EVENT = 'leads:ai-daily-cap'

export interface CapDetail {
  message: string
  spentUsd?: number
  capUsd?: number
}

export function announceCap(detail: CapDetail) {
  try {
    window.dispatchEvent(new CustomEvent<CapDetail>(CAP_EVENT, { detail }))
  } catch {
    // no window (tests)
  }
}
