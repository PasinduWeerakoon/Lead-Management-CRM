import { create } from 'zustand'
import { AiError } from '../../lib/ai/provider'
import {
  DEFAULT_AI_SETTINGS,
  forgetKey,
  loadAiSettings,
  looksLikeKey,
  readSessionKey,
  saveAiSettings,
  spendThisMonth,
  storeKey,
  unlockKey,
  writeSessionKey,
  type AiSettings,
  type KeyStorage,
} from '../../lib/ai/settings'
import { DEFAULT_MODEL_BY_PROVIDER, formatUsd, modelById, type Provider } from '../../lib/ai/models'
import { COMPANY_KEY, type CompanyAi } from '../../lib/ai/company'
import { getStatus } from '../../lib/sync/api'

export type KeyStatus = 'loading' | 'none' | 'locked' | 'ready'

/**
 * Development-only Groq key from `.env.local` (VITE_DEV_GROQ_KEY), honoured until
 * VITE_DEV_GROQ_KEY_EXPIRES. Production builds compile this to `undefined`, so the key never ships.
 */
export const DEV_GROQ = (() => {
  if (!import.meta.env.DEV) return undefined
  const key = (import.meta.env.VITE_DEV_GROQ_KEY as string | undefined)?.trim()
  const expires = (import.meta.env.VITE_DEV_GROQ_KEY_EXPIRES as string | undefined)?.trim()
  if (!key || !looksLikeKey('groq', key)) return undefined
  return { key, expires, expired: !!expires && new Date().toISOString().slice(0, 10) > expires }
})()

interface AiState {
  settings: AiSettings
  /** The active provider's API key, held in memory only while unlocked. */
  key?: string
  status: KeyStatus
  /** The active key came from `.env.local` (development only). */
  devKey: boolean
  /** The server holds a company OpenAI key (with a daily limit); undefined when it doesn't. */
  companyAi?: CompanyAi
  /** The server has a company key, but the access code is needed to use it. */
  companyNeedsCode: boolean
  /** The active key is the company key on the server (the browser never has the key itself). */
  company: boolean
  init: () => Promise<void>
  /** Asks the server whether a company key is set up, and today's spend against its limit. */
  refreshCompany: () => Promise<void>
  update: (patch: Partial<Pick<AiSettings, 'model' | 'effort' | 'softLimitUsd'>>) => Promise<void>
  setProvider: (provider: Provider) => Promise<void>
  setKey: (key: string, storage: KeyStorage, passphrase?: string) => Promise<void>
  unlock: (passphrase: string) => Promise<void>
  remove: () => Promise<void>
}

function keyState(settings: AiSettings, companyAi?: CompanyAi): Pick<AiState, 'key' | 'status' | 'devKey' | 'company'> {
  const p = settings.provider
  const key = readSessionKey(p)
  const devKey = p === 'groq' && !!DEV_GROQ && !DEV_GROQ.expired && key === DEV_GROQ.key
  // Your own key wins; with none saved, OpenAI runs on the company key held by the server.
  if (!key && p === 'openai' && companyAi && !settings.keys.openai?.encryptedKey)
    return { key: COMPANY_KEY, devKey: false, company: true, status: 'ready' }
  return { key, devKey, company: false, status: key ? 'ready' : settings.keys[p]?.encryptedKey ? 'locked' : 'none' }
}

const ownKey = (settings: AiSettings, p: Provider) => !!readSessionKey(p) || !!settings.keys[p]?.encryptedKey

export const useAi = create<AiState>((set, get) => ({
  settings: DEFAULT_AI_SETTINGS,
  status: 'loading',
  devKey: false,
  company: false,
  companyNeedsCode: false,

  init: async () => {
    let settings = await loadAiSettings()
    if (DEV_GROQ) {
      if (DEV_GROQ.expired) {
        // Past its date: forget the development key everywhere it was copied.
        if (readSessionKey('groq') === DEV_GROQ.key) writeSessionKey('groq', undefined)
      } else {
        if (!readSessionKey('groq')) writeSessionKey('groq', DEV_GROQ.key)
        // Use Groq when the current provider has no usable key yet.
        const current = settings.provider
        if (current !== 'groq' && !readSessionKey(current) && !settings.keys[current]?.encryptedKey) {
          settings = await saveAiSettings({ provider: 'groq', model: DEFAULT_MODEL_BY_PROVIDER.groq })
        }
      }
    }
    set({ settings, ...keyState(settings, get().companyAi) })
    await get().refreshCompany()
  },

  refreshCompany: async () => {
    let companyAi: CompanyAi | undefined
    let companyNeedsCode = false
    try {
      const st = await getStatus()
      companyAi = st.companyAi
      companyNeedsCode = !!st.companyKey && !st.accessOk
    } catch {
      companyAi = undefined
    }
    let settings = get().settings
    // No key of your own for the current provider: switch to the company's GPT.
    if (
      (companyAi || companyNeedsCode) &&
      !ownKey(settings, settings.provider) &&
      settings.provider !== 'openai' &&
      !get().devKey
    )
      settings = await saveAiSettings({ provider: 'openai', model: DEFAULT_MODEL_BY_PROVIDER.openai })
    set({ companyAi, companyNeedsCode, settings, ...keyState(settings, companyAi) })
  },

  update: async (patch) => {
    const settings = await saveAiSettings(patch)
    set({ settings })
  },

  setProvider: async (provider) => {
    if (get().settings.provider === provider) return
    const model = modelById(get().settings.model)
    const settings = await saveAiSettings({
      provider,
      model: model.provider === provider ? model.id : DEFAULT_MODEL_BY_PROVIDER[provider],
    })
    set({ settings, ...keyState(settings, get().companyAi) })
  },

  setKey: async (key, storage, passphrase) => {
    const provider = get().settings.provider
    await storeKey(key, storage, passphrase, provider)
    const settings = await loadAiSettings()
    set({ settings, ...keyState(settings, get().companyAi) })
  },

  unlock: async (passphrase) => {
    const key = await unlockKey(passphrase, get().settings.provider)
    set({ key, status: 'ready' })
  },

  remove: async () => {
    await forgetKey(get().settings.provider)
    const settings = await loadAiSettings()
    set({ settings, ...keyState(settings, get().companyAi) })
  },
}))

/** Throws a friendly error if this month's AI spend has reached the soft limit. */
export async function checkBudget(): Promise<void> {
  const limit = useAi.getState().settings.softLimitUsd
  if (limit === null) return
  const spent = await spendThisMonth()
  if (spent >= limit) {
    throw new AiError(
      `You've used ${formatUsd(spent)} of your ${formatUsd(limit)} monthly AI limit. Raise it in Settings to keep going.`,
      'limit',
    )
  }
}
