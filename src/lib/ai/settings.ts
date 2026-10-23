import { appDb } from '../app-db'
import { decryptSecret, encryptSecret, type EncryptedSecret } from '../crypto'
import {
  costUsd,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  modelById,
  hasModel,
  PROVIDERS,
  registerCustomModels,
  registerPriceOverrides,
  type CustomModel,
  type PriceOverrides,
  type Effort,
  type Provider,
  type TokenUsage,
} from './models'

export type KeyStorage = 'session' | 'device'

/** Whose key a slot holds: an AI provider, or a data provider such as Apollo. */
export type KeyOwner = Provider | 'apollo'

/** One saved key per provider, so switching provider never loses the other key. */
export interface KeySlot {
  storage: KeyStorage
  /** Only for "device" storage: the key, encrypted with your passphrase. */
  encryptedKey?: EncryptedSecret
  /** Last 4 characters, so the UI can show which key is saved without decrypting it. */
  keyHint?: string
}

/** Stored in IndexedDB. Never included in backups or exports. */
export interface AiSettings {
  provider: Provider
  model: string
  effort: Effort
  /** Monthly soft limit in USD; null = no limit. */
  softLimitUsd: number | null
  keys: Partial<Record<KeyOwner, KeySlot>>
  /** Models you added by ID or from a provider's list. */
  customModels?: CustomModel[]
  /** Prices you set for models (USD per million tokens). */
  priceOverrides?: PriceOverrides
}

export interface AiUsageRecord {
  id: string
  at: string
  model: string
  feature: 'filters' | 'scoring' | 'hq' | 'research' | 'test'
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'anthropic',
  model: DEFAULT_MODEL,
  effort: 'low',
  softLimitUsd: 10,
  keys: {},
}

const SETTINGS_KEY = 'ai'
const sessionKeyName = (p: KeyOwner) => `leads.ai.key.${p}`
const LEGACY_SESSION_KEY = 'leads.ai.key'

/** Settings saved before multi-provider support kept one Anthropic key at the top level. */
interface LegacySettings {
  keyStorage?: KeyStorage
  encryptedKey?: EncryptedSecret
  keyHint?: string
}

export async function loadAiSettings(): Promise<AiSettings> {
  const row = await appDb.settings.get(SETTINGS_KEY)
  const raw = (row?.value ?? {}) as Partial<AiSettings> & LegacySettings
  const { keyStorage, encryptedKey, keyHint: legacyHint, ...rest } = raw
  const keys = { ...rest.keys }
  if (!keys.anthropic && (encryptedKey || legacyHint)) {
    keys.anthropic = { storage: keyStorage ?? 'session', encryptedKey, keyHint: legacyHint }
  }
  const merged: AiSettings = { ...DEFAULT_AI_SETTINGS, ...rest, keys }
  registerCustomModels(merged.customModels)
  registerPriceOverrides(merged.priceOverrides)
  // The chosen model must exist and belong to the chosen provider.
  const model = modelById(merged.model)
  if (!hasModel(merged.model) || model.provider !== merged.provider) {
    merged.model = DEFAULT_MODEL_BY_PROVIDER[merged.provider]
  }
  return merged
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const next = { ...(await loadAiSettings()), ...patch }
  registerCustomModels(next.customModels)
  registerPriceOverrides(next.priceOverrides)
  await appDb.settings.put({ key: SETTINGS_KEY, value: next })
  return next
}

/** Adds (or updates) models you picked from a provider's list or typed by ID. */
export async function addCustomModels(models: CustomModel[]): Promise<AiSettings> {
  const current = (await loadAiSettings()).customModels ?? []
  const byKey = new Map(current.map((m) => [`${m.provider}|${m.id}`, m]))
  for (const m of models) byKey.set(`${m.provider}|${m.id}`, { ...m, id: m.id.trim().slice(0, 200) })
  return saveAiSettings({ customModels: [...byKey.values()].slice(0, 300) })
}

export async function removeCustomModel(provider: Provider, id: string): Promise<AiSettings> {
  const s = await loadAiSettings()
  const customModels = (s.customModels ?? []).filter((m) => !(m.provider === provider && m.id === id))
  const model = s.model === id && s.provider === provider ? DEFAULT_MODEL_BY_PROVIDER[provider] : s.model
  return saveAiSettings({ customModels, model })
}

async function saveSlot(provider: KeyOwner, slot: KeySlot | undefined): Promise<AiSettings> {
  const s = await loadAiSettings()
  const keys = { ...s.keys }
  if (slot) keys[provider] = slot
  else delete keys[provider]
  return saveAiSettings({ keys })
}

// --- the key itself -------------------------------------------------------------------------

export const looksLikeKey = (provider: Provider, k: string) => PROVIDERS[provider].keyPattern.test(k.trim())
export const looksLikeAnthropicKey = (k: string) => looksLikeKey('anthropic', k)
export const keyHint = (k: string) => k.trim().slice(-4)

/** The key lives in sessionStorage while the tab is open (both modes), so it survives a reload but not closing the tab. */
export function readSessionKey(provider: KeyOwner = 'anthropic'): string | undefined {
  try {
    return (
      sessionStorage.getItem(sessionKeyName(provider)) ??
      (provider === 'anthropic' ? sessionStorage.getItem(LEGACY_SESSION_KEY) : null) ??
      undefined
    )
  } catch {
    return undefined
  }
}

export function writeSessionKey(provider: KeyOwner, key: string | undefined) {
  try {
    if (key) sessionStorage.setItem(sessionKeyName(provider), key)
    else {
      sessionStorage.removeItem(sessionKeyName(provider))
      if (provider === 'anthropic') sessionStorage.removeItem(LEGACY_SESSION_KEY)
    }
  } catch {
    // Storage blocked: the key then lives only in memory for this page.
  }
}

export async function storeKey(
  key: string,
  storage: KeyStorage,
  passphrase?: string,
  provider: KeyOwner = 'anthropic',
): Promise<void> {
  const clean = key.trim()
  if (storage === 'device' && (!passphrase || passphrase.length < 8)) {
    throw new Error('Choose a passphrase of at least 8 characters.')
  }
  writeSessionKey(provider, clean)
  await saveSlot(provider, {
    storage,
    encryptedKey: storage === 'device' ? await encryptSecret(clean, passphrase!) : undefined,
    keyHint: keyHint(clean),
  })
}

export async function unlockKey(passphrase: string, provider: KeyOwner = 'anthropic'): Promise<string> {
  const slot = (await loadAiSettings()).keys[provider]
  if (!slot?.encryptedKey) throw new Error('No saved key to unlock.')
  let key: string
  try {
    key = await decryptSecret(slot.encryptedKey, passphrase)
  } catch {
    throw new Error("That passphrase didn't work.")
  }
  writeSessionKey(provider, key)
  return key
}

export async function forgetKey(provider: KeyOwner = 'anthropic'): Promise<void> {
  writeSessionKey(provider, undefined)
  await saveSlot(provider, undefined)
}

// --- usage & soft limit ---------------------------------------------------------------------

const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

export async function recordUsage(
  model: string,
  feature: AiUsageRecord['feature'],
  usage: TokenUsage,
): Promise<AiUsageRecord> {
  const rec: AiUsageRecord = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    model,
    feature,
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    costUsd: costUsd(model, usage),
  }
  await appDb.aiUsage.add(rec)
  return rec
}

export async function spendThisMonth(now = new Date()): Promise<number> {
  const rows = await appDb.aiUsage.where('at').aboveOrEqual(monthStart(now)).toArray()
  return rows.reduce((sum, r) => sum + r.costUsd, 0)
}

/** Sets (or, with undefined, removes) your price for a model, in USD per million tokens. */
export async function setModelPrice(
  modelId: string,
  price: { inputPerM: number; outputPerM: number } | undefined,
): Promise<AiSettings> {
  const overrides = { ...(await loadAiSettings()).priceOverrides }
  if (price && price.inputPerM >= 0 && price.outputPerM >= 0) overrides[modelId] = price
  else delete overrides[modelId]
  return saveAiSettings({ priceOverrides: overrides })
}
