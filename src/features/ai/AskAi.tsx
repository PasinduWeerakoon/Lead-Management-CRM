import { MAX_DESCRIPTION } from '../../lib/ai/filter-prompt'
import { useState } from 'react'
import { Alert, Button, Flex, Input, Modal, Popover, Typography } from 'antd'
import { ExclamationCircleOutlined, RollbackOutlined } from '../../components/icons'
import { create } from 'zustand'
import { AiError, generateFilters } from '../../lib/ai/provider'
import { formatUsd, modelById } from '../../lib/ai/models'
import { recordUsage } from '../../lib/ai/settings'
import type { FilterGroup, KeywordPack } from '../../lib/filters/schema'
import { useFilters } from '../filters/store'
import { checkBudget, useAi } from './store'
import { UnlockForm } from './UnlockForm'
import { ModelPicker } from './ModelPicker'
import { KeyForm } from '../settings/AiSection'
import { PROVIDERS } from '../../lib/ai/models'

interface Notice {
  kind: 'applied' | 'empty' | 'error'
  explanation?: string
  notes: string[]
  meta?: string
  previous?: FilterGroup
  error?: string
  /** What was asked, so the same text can be used as a scoring brief. */
  prompt?: string
}

/** The last AI result, shown as a banner under the toolbar. */
const useNotice = create<{ notice?: Notice; set: (n?: Notice) => void }>((set) => ({
  notice: undefined,
  set: (notice) => set({ notice }),
}))

const EXAMPLES = [
  'CIOs and IT directors who mention Dynamics or Power Platform',
  'Senior people in digital transformation I connected with in the last 2 years',
  'Shortlisted C-level contacts with high priority',
]

/** A small multicolour spark, so the AI entry point is recognisable without shouting. */
export function SparkIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ flex: 'none' }}>
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f6feb" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z" fill="url(#spark)" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" fill="#f59e0b" />
    </svg>
  )
}

export function AskAiButton({ packs }: { packs: KeywordPack[] }) {
  const { status, key, settings } = useAi()
  const { draft, viewId, load } = useFilters()
  const setNotice = useNotice((s) => s.set)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<'key' | 'unlock'>()

  const run = async (apiKey = key) => {
    const description = text.trim()
    if (!description) return
    if (status === 'none' || status === 'loading') return setAsk('key')
    if (status === 'locked' || !apiKey) return setAsk('unlock')

    setBusy(true)
    try {
      await checkBudget()
      const res = await generateFilters({ apiKey, model: settings.model, effort: settings.effort, description, packs })
      const usage = await recordUsage(res.servedBy, 'filters', res.usage)
      const fellBack = res.servedBy !== settings.model
      const meta = `${modelById(res.servedBy).label}${fellBack ? ' (fallback)' : ''} · ${formatUsd(usage.costUsd)}`
      const notes = [...res.unsupported, ...res.dropped.map((d) => `Skipped one filter: ${d}.`)]
      if (res.filter.items.length === 0) {
        setNotice({ kind: 'empty', explanation: res.explanation, notes, meta })
      } else {
        const previous = draft
        load(res.filter, viewId)
        setNotice({ kind: 'applied', explanation: res.explanation, notes, meta, previous, prompt: description })
        setOpen(false)
        setText('')
      }
    } catch (e) {
      setNotice({
        kind: 'error',
        notes: [],
        error: e instanceof AiError ? e.message : 'Something went wrong. Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  const panel = (
    <Flex vertical gap={12} style={{ width: 480 }}>
      <Flex vertical gap={2}>
        <Typography.Text strong>Who are you looking for?</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Describe them in your own words — or paste a full lead-generation brief — and I'll set up the filters for you
          to check.
        </Typography.Text>
      </Flex>
      <Input.TextArea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            // Without preventDefault the same Enter could also activate a dialog this opens.
            e.preventDefault()
            void run()
          }
        }}
        autoSize={{ minRows: 2, maxRows: 12 }}
        maxLength={MAX_DESCRIPTION}
        placeholder="e.g. CIOs and IT directors who mention Dynamics"
        disabled={busy}
      />
      <Flex vertical gap={2}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Try:
        </Typography.Text>
        {EXAMPLES.map((ex) => (
          <Typography.Link key={ex} style={{ fontSize: 13 }} onClick={() => setText(ex)}>
            {ex}
          </Typography.Link>
        ))}
      </Flex>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Sends only your text, never your contacts.
      </Typography.Text>
      <Flex justify="space-between" align="center" gap={8}>
        <ModelPicker width={250} />
        <Button type="primary" loading={busy} disabled={!text.trim()} onClick={() => run()}>
          {busy ? 'Thinking…' : 'Build filters'}
        </Button>
      </Flex>
    </Flex>
  )

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        trigger="click"
        placement="bottomRight"
        content={panel}
        destroyOnHidden
      >
        <Button icon={<SparkIcon />}>Ask AI</Button>
      </Popover>

      <Modal
        open={ask === 'key'}
        title={`Add your ${PROVIDERS[settings.provider].label} API key`}
        footer={null}
        onCancel={() => setAsk(undefined)}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          “Ask AI” uses your own API key, so usage is billed to your account. You can also switch provider in the
          panel's model menu.
        </Typography.Paragraph>
        <KeyForm
          onSaved={() => {
            setAsk(undefined)
            void run(useAi.getState().key)
          }}
          onCancel={() => setAsk(undefined)}
        />
      </Modal>

      <Modal
        open={ask === 'unlock'}
        title="Unlock your AI key"
        footer={null}
        onCancel={() => setAsk(undefined)}
        destroyOnHidden
      >
        <UnlockForm
          onUnlocked={() => {
            setAsk(undefined)
            void run(useAi.getState().key)
          }}
        />
      </Modal>
    </>
  )
}

export interface AiNoticeProps {
  /** People matching the filters now shown. */
  matches: number
  /** When nothing matches: how many people each condition matches on its own. */
  breakdown: Array<{ label: string; count: number }>
  /** Score the people shown, using the asked text as the brief. */
  onScore: (prompt: string) => void
}

export function AiNotice({ matches, breakdown, onScore }: AiNoticeProps) {
  const { notice, set } = useNotice()
  const { viewId, load } = useFilters()
  if (!notice) return null

  const undo = () => {
    if (notice.previous) load(notice.previous, viewId)
    set(undefined)
  }

  return (
    <div style={{ padding: '0 16px 10px' }}>
      <Alert
        className="fade-in"
        type={notice.kind === 'error' ? 'error' : notice.kind === 'empty' ? 'warning' : 'info'}
        showIcon
        icon={notice.kind === 'applied' ? <SparkIcon /> : undefined}
        closable={{ onClose: () => set(undefined) }}
        title={
          notice.kind === 'error'
            ? notice.error
            : notice.kind === 'empty'
              ? "Couldn't turn that into filters from the data available."
              : notice.explanation || 'Filters built from your description.'
        }
        description={
          (notice.notes.length > 0 || notice.meta) && (
            <Flex vertical gap={2}>
              {notice.kind === 'applied' && (
                <Typography.Text style={{ fontSize: 13 }}>
                  <b>{matches.toLocaleString()}</b> {matches === 1 ? 'person matches' : 'people match'}.
                  {matches === 0 && breakdown.length > 1 && ' Each filter on its own matches:'}
                </Typography.Text>
              )}
              {notice.kind === 'applied' &&
                matches === 0 &&
                breakdown.length > 1 &&
                breakdown.map((b) => (
                  <Typography.Text key={b.label} type="secondary" style={{ fontSize: 13, paddingLeft: 12 }}>
                    {b.count.toLocaleString()} — {b.label}
                  </Typography.Text>
                ))}
              {notice.notes.map((n) => (
                <Typography.Text key={n} type="secondary" style={{ fontSize: 13 }}>
                  <ExclamationCircleOutlined style={{ color: 'var(--text-3)', marginRight: 6 }} />
                  {n}
                </Typography.Text>
              ))}
              {notice.meta && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {notice.kind === 'applied' && 'Check the filters above and adjust anything. '}
                  {notice.meta}
                </Typography.Text>
              )}
            </Flex>
          )
        }
        action={
          notice.kind === 'applied' && (
            <Flex gap={6} wrap>
              {matches > 0 && notice.prompt && (
                <Button
                  size="small"
                  type="primary"
                  icon={<SparkIcon size={14} />}
                  onClick={() => onScore(notice.prompt!)}
                >
                  Score these {matches.toLocaleString()} with AI
                </Button>
              )}
              <Button size="small" icon={<RollbackOutlined />} onClick={undo}>
                Undo
              </Button>
            </Flex>
          )
        }
      />
    </div>
  )
}
