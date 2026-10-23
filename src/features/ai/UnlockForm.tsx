import { useState } from 'react'
import { Button, Flex, Input, Typography } from 'antd'
import { LockOutlined } from '../../components/icons'
import { useAi } from './store'

/** Shown when a key is saved on this device but not unlocked in this tab yet. */
export function UnlockForm({ onUnlocked }: { onUnlocked?: () => void }) {
  const unlock = useAi((s) => s.unlock)
  const hint = useAi((s) => s.settings.keys[s.settings.provider]?.keyHint)
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await unlock(passphrase)
      setPassphrase('')
      onUnlocked?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "That passphrase didn't work.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex vertical gap={8}>
      <Typography.Text>
        <LockOutlined /> Your key{hint ? ` ending “…${hint}”` : ''} is saved on this device. Enter your passphrase to
        use it in this tab.
      </Typography.Text>
      <Flex gap={8}>
        <Input.Password
          autoFocus
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onPressEnter={submit}
          status={error ? 'error' : undefined}
          autoComplete="current-password"
        />
        <Button type="primary" onClick={submit} loading={busy} disabled={!passphrase}>
          Unlock
        </Button>
      </Flex>
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
    </Flex>
  )
}
