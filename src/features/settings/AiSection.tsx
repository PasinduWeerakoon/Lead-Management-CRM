import { ApolloKeyForm } from '../enrich/apolloKey'
import { useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import {
  Alert,
  App,
  Button,
  Card,
  Flex,
  Input,
  InputNumber,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { CheckCircleFilled, KeyOutlined, SafetyOutlined } from '../../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { testKey } from '../../lib/ai/provider'
import {
  formatUsd,
  modelById,
  modelsFor,
  PROVIDERS,
  perM,
  storedModelId,
  type Effort,
  type Provider,
} from '../../lib/ai/models'
import { listModels } from '../../lib/ai/provider'
import {
  addCustomModels,
  looksLikeKey,
  removeCustomModel,
  setModelPrice,
  spendThisMonth,
  type KeyStorage,
} from '../../lib/ai/settings'
import { formatDate } from '../../lib/format'
import { appDb } from '../../lib/app-db'
import { DEV_GROQ, useAi } from '../ai/store'
import { UnlockForm } from '../ai/UnlockForm'

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <Flex vertical gap={6}>
      <Typography.Text strong>{label}</Typography.Text>
      {children}
      {help && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {help}
        </Typography.Text>
      )}
    </Flex>
  )
}

/** Add or replace the active provider's key: validates the shape, tests it (free), then saves. */
export function KeyForm({ onSaved, onCancel }: { onSaved?: () => void; onCancel?: () => void }) {
  const { message } = App.useApp()
  const { settings, setKey } = useAi()
  const provider = PROVIDERS[settings.provider]
  const [key, setKeyInput] = useState('')
  const [storage, setStorage] = useState<KeyStorage>('session')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const valid =
    looksLikeKey(settings.provider, key) &&
    (storage === 'session' || (passphrase.length >= 8 && passphrase === confirm))

  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await testKey(key.trim(), settings.model)
      await setKey(key, storage, storage === 'device' ? passphrase : undefined)
      message.success('Key works and is saved. AI features are on.')
      setKeyInput('')
      setPassphrase('')
      setConfirm('')
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Flex vertical gap={14}>
      <Field label={`${provider.label} API key`} help={provider.keyHelp}>
        <Input.Password
          prefix={<KeyOutlined style={{ opacity: 0.5 }} />}
          placeholder={provider.keyPlaceholder}
          value={key}
          onChange={(e) => setKeyInput(e.target.value)}
          status={key && !looksLikeKey(settings.provider, key) ? 'warning' : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field label="Remember it">
        <Radio.Group value={storage} onChange={(e) => setStorage(e.target.value)}>
          <Flex vertical gap={6}>
            <Radio value="session">
              Only while this tab is open <Tag style={{ marginLeft: 6 }}>Safest</Tag>
            </Radio>
            <Radio value="device">On this device, locked with a passphrase</Radio>
          </Flex>
        </Radio.Group>
      </Field>

      {storage === 'device' && (
        <Flex gap={8} wrap>
          <Input.Password
            placeholder="Passphrase (8+ characters)"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
            style={{ flex: 1, minWidth: 200 }}
          />
          <Input.Password
            placeholder="Repeat passphrase"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            status={confirm && confirm !== passphrase ? 'error' : undefined}
            autoComplete="new-password"
            style={{ flex: 1, minWidth: 200 }}
          />
        </Flex>
      )}

      {error && <Alert type="error" showIcon title={error} />}

      <Flex gap={8}>
        <Button type="primary" onClick={save} loading={busy} disabled={!valid}>
          Test and save key
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </Flex>
    </Flex>
  )
}

/** The price used for cost estimates and the monthly limit. Edit it when a provider changes prices or for added models. */
function PriceEditor() {
  const { message } = App.useApp()
  const { settings, init } = useAi()
  const model = modelById(settings.model)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState<number | null>(null)
  const [output, setOutput] = useState<number | null>(null)

  const start = () => {
    setInput(model.priceKnown === false ? null : model.inputPerM)
    setOutput(model.priceKnown === false ? null : model.outputPerM)
    setEditing(true)
  }
  const save = async (price?: { inputPerM: number; outputPerM: number }) => {
    await setModelPrice(model.id, price)
    await init()
    setEditing(false)
    message.success(price ? `Price saved for ${model.label}.` : `${model.label} is back to its built-in price.`)
  }

  if (!editing)
    return (
      <Flex gap={8} align="center" wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          Price used for estimates:{' '}
          {model.priceKnown === false ? (
            <Typography.Text type="warning" style={{ fontSize: 12.5 }}>
              unknown — costs show as unknown
            </Typography.Text>
          ) : (
            <b>
              {perM(model.inputPerM)} input / {perM(model.outputPerM)} output per million tokens
            </b>
          )}
          {model.priceSet && ' (set by you)'}
        </Typography.Text>
        <Typography.Link style={{ fontSize: 12.5 }} onClick={start}>
          {model.priceKnown === false ? 'Set price' : 'Edit price'}
        </Typography.Link>
        {model.priceSet && (
          <Typography.Link style={{ fontSize: 12.5 }} onClick={() => void save(undefined)}>
            Reset
          </Typography.Link>
        )}
      </Flex>
    )

  return (
    <Flex gap={8} align="center" wrap>
      <InputNumber
        size="small"
        min={0}
        max={1000}
        step={0.01}
        prefix="$"
        placeholder="Input"
        value={input}
        onChange={setInput}
        style={{ width: 120 }}
        aria-label="Input price per million tokens"
      />
      <InputNumber
        size="small"
        min={0}
        max={1000}
        step={0.01}
        prefix="$"
        placeholder="Output"
        value={output}
        onChange={setOutput}
        style={{ width: 120 }}
        aria-label="Output price per million tokens"
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        per million tokens (from the provider's pricing page)
      </Typography.Text>
      <Button
        size="small"
        type="primary"
        disabled={input === null || output === null}
        onClick={() => void save({ inputPerM: input!, outputPerM: output! })}
      >
        Save
      </Button>
      <Button size="small" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </Flex>
  )
}

/** Pick a model: built-in ones, the provider's full live list, or any model id you type. */
function ModelField() {
  const { message } = App.useApp()
  const { settings, status, key, update, init } = useAi()
  const model = modelById(settings.model)
  const provider = PROVIDERS[settings.provider]
  const [loading, setLoading] = useState(false)
  const [customId, setCustomId] = useState('')
  const models = modelsFor(settings.provider)
  const builtIn = models.filter((m) => !m.custom)
  const added = models.filter((m) => m.custom)

  const option = (m: (typeof models)[number]) => ({
    value: m.id,
    searchText: `${m.label} ${m.id}`,
    label: (
      <Flex justify="space-between" gap={12}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.label}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12, flex: 'none' }}>
          {m.priceKnown === false ? 'price unknown' : `${perM(m.inputPerM)} / ${perM(m.outputPerM)} per M`}
        </Typography.Text>
      </Flex>
    ),
  })

  const loadAll = async () => {
    if (!key) return
    setLoading(true)
    try {
      const list = await listModels(settings.provider, key)
      await addCustomModels(list)
      await init()
      message.success(`Loaded ${list.length.toLocaleString()} models from ${provider.label}.`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not load the model list.')
    } finally {
      setLoading(false)
    }
  }

  const addById = async () => {
    const id = customId.trim()
    if (!id) return
    const stored = storedModelId(settings.provider, id)
    await addCustomModels([{ id: stored, provider: settings.provider }])
    await init()
    await update({ model: stored })
    setCustomId('')
    message.success(`Added ${id}. Use “Test” to check your key can use it.`)
  }

  return (
    <Field label="Model" help={model.blurb}>
      <Select
        showSearch={{ optionFilterProp: 'searchText' }}
        value={settings.model}
        onChange={(m) => update({ model: m })}
        options={[
          { label: 'Recommended', options: builtIn.map(option) },
          ...(added.length ? [{ label: `Added (${added.length})`, options: added.map(option) }] : []),
        ]}
        style={{ maxWidth: 480 }}
        popupMatchSelectWidth={480}
      />
      <Flex gap={8} wrap align="center">
        {settings.provider !== 'anthropic' && (
          <Button size="small" onClick={() => void loadAll()} loading={loading} disabled={status !== 'ready'}>
            Load all models from {provider.label.split(' (')[0]}
          </Button>
        )}
        <Space.Compact size="small">
          <Input
            placeholder="Or add a model ID, e.g. gpt-6-sol"
            value={customId}
            onChange={(e) => setCustomId(e.target.value)}
            onPressEnter={() => void addById()}
            style={{ width: 240 }}
            maxLength={200}
            spellCheck={false}
          />
          <Button onClick={() => void addById()} disabled={!customId.trim()}>
            Add
          </Button>
        </Space.Compact>
        {model.custom && (
          <Button
            size="small"
            type="link"
            danger
            onClick={() => void removeCustomModel(settings.provider, model.id).then(() => init())}
          >
            Remove this model
          </Button>
        )}
      </Flex>
      <PriceEditor />
    </Field>
  )
}

export function AiSection() {
  const { message, modal } = App.useApp()
  const { settings, status, key, devKey, update, remove, setProvider } = useAi()
  const provider = PROVIDERS[settings.provider]
  const model = modelById(settings.model)
  const slot = settings.keys[settings.provider]
  const [replacing, setReplacing] = useState(false)
  const [testing, setTesting] = useState(false)
  // Re-read whenever usage is recorded.
  const usageCount = useLiveQuery(() => appDb.aiUsage.count(), [], 0)
  const spent = useLiveQuery(() => spendThisMonth(), [usageCount], 0)
  const limit = settings.softLimitUsd

  const test = async () => {
    if (!key) return
    setTesting(true)
    try {
      await testKey(key, settings.model)
      message.success(`Your key works with ${modelById(settings.model).label}.`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'The test failed.')
    } finally {
      setTesting(false)
    }
  }

  const confirmRemove = () =>
    modal.confirm({
      title: 'Remove your API key?',
      content: 'The key is deleted from this browser. AI features turn off until you add a key again.',
      okText: 'Remove key',
      okButtonProps: { danger: true },
      onOk: remove,
    })

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Choose an AI provider and model, and use your own API key to build filters from plain English and score leads. Usage is billed to your own provider account."
      />
      <Card>
        <Flex vertical gap={20}>
          <Field
            label="Provider"
            help="Add a key for any of these; switch between them any time — each keeps its own key."
          >
            <Flex gap={8} wrap role="radiogroup" aria-label="AI provider">
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
                const hasKey = !!settings.keys[p] || (p === 'groq' && !!DEV_GROQ && !DEV_GROQ.expired)
                return (
                  <Button
                    key={p}
                    role="radio"
                    // Nothing is highlighted until settings load, so the default never flashes.
                    aria-checked={status !== 'loading' && settings.provider === p}
                    type={status !== 'loading' && settings.provider === p ? 'primary' : 'default'}
                    onClick={() => {
                      setReplacing(false)
                      void setProvider(p)
                    }}
                  >
                    {PROVIDERS[p].label}
                    {hasKey && <CheckCircleFilled style={{ marginLeft: 2 }} />}
                  </Button>
                )
              })}
            </Flex>
          </Field>

          {status === 'loading' ? null : status === 'locked' ? (
            <UnlockForm />
          ) : status === 'none' || replacing ? (
            <KeyForm onSaved={() => setReplacing(false)} onCancel={replacing ? () => setReplacing(false) : undefined} />
          ) : (
            <Field label={`${provider.label} API key`}>
              <Flex align="center" gap={8} wrap>
                <Tag icon={<CheckCircleFilled />} color="success" style={{ padding: '4px 10px', fontSize: 13 }}>
                  {provider.keyPlaceholder}
                  {slot?.keyHint ?? key?.slice(-4)}
                </Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {devKey
                    ? `Development key from .env.local${DEV_GROQ?.expires ? ` · stops working after ${formatDate(DEV_GROQ.expires)}` : ''}`
                    : slot?.storage === 'device'
                      ? 'Saved on this device, encrypted'
                      : 'Kept until you close this tab'}
                </Typography.Text>
                <Flex gap={6} style={{ marginLeft: 'auto' }}>
                  <Button size="small" onClick={test} loading={testing}>
                    Test
                  </Button>
                  <Button size="small" onClick={() => setReplacing(true)}>
                    Replace
                  </Button>
                  <Button size="small" danger onClick={confirmRemove}>
                    Remove
                  </Button>
                </Flex>
              </Flex>
            </Field>
          )}

          <ModelField />

          {model.effort && (
            <Field
              label="Effort"
              help="How hard the model thinks. Low is fast and cheap, and is plenty for turning a sentence into filters."
            >
              <Segmented<Effort>
                value={settings.effort}
                onChange={(effort) => update({ effort })}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
                style={{ alignSelf: 'flex-start' }}
              />
            </Field>
          )}

          <Field
            label="Monthly soft limit"
            help="AI requests pause once this month's estimated spend reaches the limit. Estimated from token usage in this browser."
          >
            <Flex align="center" gap={12} wrap>
              <Switch
                checked={limit !== null}
                onChange={(on) => update({ softLimitUsd: on ? 10 : null })}
                aria-label="Use a monthly limit"
              />
              {limit !== null && (
                <InputNumber
                  min={1}
                  max={10_000}
                  precision={0}
                  prefix="$"
                  value={limit}
                  onChange={(v) => v && update({ softLimitUsd: v })}
                  style={{ width: 120 }}
                />
              )}
              <Typography.Text type="secondary">Used this month: {formatUsd(spent)}</Typography.Text>
            </Flex>
            {limit !== null && (
              <Progress
                percent={Math.min(100, (spent / limit) * 100)}
                showInfo={false}
                size="small"
                status={spent >= limit ? 'exception' : 'normal'}
                style={{ maxWidth: 420 }}
              />
            )}
          </Field>

          <Alert
            type="info"
            showIcon
            icon={<SafetyOutlined />}
            title="How your key is handled"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>It's sent only to {provider.host}, straight from your browser. There is no server in between.</li>
                <li>
                  Scoring and company HQ send people's job title, company, seniority and similar fields to the provider
                  you pick — never emails, notes or LinkedIn URLs.
                </li>
                <li>
                  “Only while this tab is open” forgets it when you close the tab. “On this device” stores it encrypted
                  with your passphrase.
                </li>
                <li>It's never included in backups or exports.</li>
                <li>Describe-to-filter sends only your sentence and the list of filter fields, never your contacts.</li>
              </ul>
            }
          />
        </Flex>
      </Card>

      <Card title="Data provider · Apollo" style={{ marginTop: 16 }}>
        <Flex vertical gap={14}>
          <Typography.Text type="secondary">
            Powers the ▶ columns on the People page: work email and its check, phone, person location, company HQ and
            technologies. Lookups use your Apollo credits.
          </Typography.Text>
          <ApolloKeyForm />
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Apollo only accepts calls from a server, so requests go through this app’s own small function, which
            forwards your key to api.apollo.io and stores nothing. Phone numbers and emails are saved with the profile
            (and the shared database, when connected).
          </Typography.Text>
        </Flex>
      </Card>
    </>
  )
}
