import { useState } from 'react'
import { Alert, Button, Flex, Input, Radio, Tag, Typography } from 'antd'
import { create } from 'zustand'
import { KeyOutlined, LockOutlined } from '../../components/icons'
import { forgetKey, loadAiSettings, readSessionKey, storeKey, unlockKey, type KeyStorage } from '../../lib/ai/settings'

export type ApolloKeyStatus = 'loading' | 'none' | 'locked' | 'ready'

/** Apollo keys are long letters/digits; checked loosely so a new format doesn't lock anyone out. */
export const looksLikeApolloKey = (k: string) => /^[A-Za-z0-9_-]{16,128}$/.test(k.trim())

interface ApolloKeyState {
  status: ApolloKeyStatus
  key?: string
  hint?: string
  init: () => Promise<void>
  save: (key: string, storage: KeyStorage, passphrase?: string) => Promise<void>
  unlock: (passphrase: string) => Promise<void>
  remove: () => Promise<void>
}

async function current(): Promise<Pick<ApolloKeyState, 'status' | 'key' | 'hint'>> {
  const slot = (await loadAiSettings()).keys.apollo
  const key = readSessionKey('apollo')
  return { key, hint: slot?.keyHint, status: key ? 'ready' : slot?.encryptedKey ? 'locked' : 'none' }
}

/** Your Apollo API key: same storage choices as the AI key (this tab only, or encrypted on this device). */
export const useApolloKey = create<ApolloKeyState>((set) => ({
  status: 'loading',
  init: async () => set(await current()),
  save: async (key, storage, passphrase) => {
    await storeKey(key, storage, passphrase, 'apollo')
    set(await current())
  },
  unlock: async (passphrase) => {
    const key = await unlockKey(passphrase, 'apollo')
    set({ key, status: 'ready' })
  },
  remove: async () => {
    await forgetKey('apollo')
    set(await current())
  },
}))

/** Add, unlock or remove the Apollo key. */
export function ApolloKeyForm({ onReady }: { onReady?: () => void }) {
  const { status, hint, save, unlock, remove } = useApolloKey()
  const [key, setKey] = useState('')
  const [storage, setStorage] = useState<KeyStorage>('session')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      setKey('')
      setPassphrase('')
      setConfirm('')
      onReady?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'ready')
    return (
      <Flex align="center" justify="space-between" gap={8} wrap>
        <Typography.Text>
          <KeyOutlined /> Apollo key{hint ? ` ending “…${hint}”` : ''} is ready in this tab.
        </Typography.Text>
        <Button size="small" danger onClick={() => void remove()}>
          Remove key
        </Button>
      </Flex>
    )

  if (status === 'locked')
    return (
      <Flex vertical gap={8}>
        <Typography.Text>
          <LockOutlined /> Your Apollo key{hint ? ` ending “…${hint}”` : ''} is saved on this device. Enter your
          passphrase to use it in this tab.
        </Typography.Text>
        <Flex gap={8}>
          <Input.Password
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onPressEnter={() => void run(() => unlock(passphrase))}
            autoComplete="current-password"
          />
          <Button
            type="primary"
            loading={busy}
            disabled={!passphrase}
            onClick={() => void run(() => unlock(passphrase))}
          >
            Unlock
          </Button>
        </Flex>
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
      </Flex>
    )

  const valid = looksLikeApolloKey(key) && (storage === 'session' || (passphrase.length >= 8 && passphrase === confirm))
  return (
    <Flex vertical gap={12}>
      <Flex vertical gap={4}>
        <Typography.Text strong>Apollo API key</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          In Apollo: Settings → Integrations → API → create a key with access to People Enrichment (bulk) and webhook
          results. Lookups use your Apollo credits.
        </Typography.Text>
        <Input.Password
          prefix={<KeyOutlined style={{ opacity: 0.5 }} />}
          placeholder="Paste your Apollo API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          status={key && !looksLikeApolloKey(key) ? 'warning' : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </Flex>
      <Radio.Group value={storage} onChange={(e) => setStorage(e.target.value)}>
        <Flex vertical gap={6}>
          <Radio value="session">
            Only while this tab is open <Tag style={{ marginLeft: 6 }}>Safest</Tag>
          </Radio>
          <Radio value="device">On this device, locked with a passphrase</Radio>
        </Flex>
      </Radio.Group>
      {storage === 'device' && (
        <Flex gap={8} wrap>
          <Input.Password
            placeholder="Passphrase (8+ characters)"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
            style={{ flex: 1, minWidth: 180 }}
          />
          <Input.Password
            placeholder="Repeat passphrase"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            status={confirm && confirm !== passphrase ? 'error' : undefined}
            autoComplete="new-password"
            style={{ flex: 1, minWidth: 180 }}
          />
        </Flex>
      )}
      {error && <Alert type="error" showIcon title={error} />}
      <Flex>
        <Button
          type="primary"
          loading={busy}
          disabled={!valid}
          onClick={() => void run(() => save(key, storage, storage === 'device' ? passphrase : undefined))}
        >
          Save key
        </Button>
      </Flex>
    </Flex>
  )
}
