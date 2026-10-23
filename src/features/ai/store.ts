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
  init: () => Promise<void>
  update: (patch: Partial<Pick<AiSettings, 'model' | 'effort' | 'softLimitUsd'>>) => Promise<void>
  setProvider: (provider: Provider) => Promise<void>
  setKey: (key: string, storage: KeyStorage, passphrase?: string) => Promise<void>
  unlock: (passphrase: string) => Promise<void>
  remove: () => Promise<void>
}

function keyState(settings: AiSettings): Pick<AiState, 'key' | 'status' | 'devKey'> {
  const p = settings.provider
  const key = readSessionKey(p)
  const devKey = p === 'groq' && !!DEV_GROQ && !DEV_GROQ.expired && key === DEV_GROQ.key
  return { key, devKey, status: key ? 'ready' : settings.keys[p]?.encryptedKey ? 'locked' : 'none' }
}

export const useAi = create<AiState>((set, get) => ({
  settings: DEFAULT_AI_SETTINGS,
  status: 'loading',
  devKey: false,

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
    set({ settings, ...keyState(settings) })
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
    set({ settings, ...keyState(settings) })
  },

  setKey: async (key, storage, passphrase) => {
    const provider = get().settings.provider
    await storeKey(key, storage, passphrase, provider)
    const settings = await loadAiSettings()
    set({ settings, ...keyState(settings) })
  },

  unlock: async (passphrase) => {
    const key = await unlockKey(passphrase, get().settings.provider)
    set({ key, status: 'ready' })
  },

  remove: async () => {
    await forgetKey(get().settings.provider)
    const settings = await loadAiSettings()
    set({ settings, ...keyState(settings) })
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
