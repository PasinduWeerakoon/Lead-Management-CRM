import { useState } from 'react'
import { App, Button, Dropdown, Input, Modal, Tooltip, Typography } from 'antd'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  CheckOutlined,
  DownOutlined,
  CloudOutlined,
  CloudOffOutlined,
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  LockOutlined,
  PlusOutlined,
  UsersGroupOutlined,
  WarningOutlined,
} from '../components/icons'
import { appDb, type Profile } from '../lib/app-db'
import { activeProfileId } from '../lib/db'
import { createProfile, deleteProfile, renameProfile, switchProfile } from '../lib/profiles'
import { saveAccessCode } from '../lib/sync/api'
import { useSync } from '../lib/sync/store'
import { relativeTime } from '../lib/format'

/** Pick, add, rename or delete the profile (LinkedIn network) this tab works on. */
export function ProfileSwitcher({ collapsed }: { collapsed: boolean }) {
  const { modal, message } = App.useApp()
  const profiles = useLiveQuery(() => appDb.profiles.orderBy('name').toArray(), [], [] as Profile[])
  const active = activeProfileId()
  const current = profiles.find((p) => p.id === active)
  const [naming, setNaming] = useState<{ mode: 'new' } | { mode: 'rename'; profile: Profile }>()

  const confirmDelete = (p: Profile) =>
    modal.confirm({
      title: `Delete the profile “${p.name}”?`,
      content:
        'All its people, AI results, briefs, presets and views are deleted — in this browser and in the shared database. This can’t be undone.',
      okText: 'Delete profile',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProfile(p.id)
          message.success(`Deleted “${p.name}”.`)
        } catch (e) {
          message.error(e instanceof Error ? e.message : 'Could not delete the profile.')
        }
      },
    })

  const items = [
    { type: 'group' as const, label: 'Profiles' },
    ...profiles.map((p) => ({
      key: `open:${p.id}`,
      label: (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>{p.name}</span>
          {p.id === active && <CheckOutlined style={{ color: 'var(--primary)' }} />}
        </span>
      ),
    })),
    { type: 'divider' as const },
    { key: 'new', icon: <PlusOutlined />, label: 'New profile…' },
    ...(current
      ? [
          { key: 'rename', icon: <EditOutlined />, label: `Rename “${current.name}”…` },
          { key: 'delete', icon: <DeleteOutlined />, label: `Delete “${current.name}”…`, danger: true },
        ]
      : []),
  ]

  return (
    <>
      <Dropdown
        trigger={['click']}
        placement="bottomLeft"
        menu={{
          items,
          onClick: ({ key }) => {
            if (key.startsWith('open:')) switchProfile(key.slice(5))
            else if (key === 'new') setNaming({ mode: 'new' })
            else if (key === 'rename' && current) setNaming({ mode: 'rename', profile: current })
            else if (key === 'delete' && current) confirmDelete(current)
          },
        }}
      >
        {collapsed ? (
          <Tooltip title={current?.name ?? 'Profiles'} placement="right">
            <Button type="text" icon={<UsersGroupOutlined />} aria-label="Switch profile" />
          </Tooltip>
        ) : (
          <button type="button" className="profile-switch" aria-label="Switch profile">
            <span className="profile-avatar" aria-hidden>
              {(current?.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="profile-name">{current?.name ?? 'Profile'}</span>
            <DownOutlined style={{ color: 'var(--text-3)' }} />
          </button>
        )}
      </Dropdown>

      {naming && (
        <NameModal
          title={naming.mode === 'new' ? 'New profile' : 'Rename profile'}
          initial={naming.mode === 'rename' ? naming.profile.name : ''}
          okText={naming.mode === 'new' ? 'Create and open' : 'Save'}
          help={
            naming.mode === 'new'
              ? 'A separate LinkedIn network, e.g. “Sales team network”. It starts empty — import that person’s Connections.csv into it.'
              : undefined
          }
          onCancel={() => setNaming(undefined)}
          onOk={async (name) => {
            if (naming.mode === 'new') {
              const p = await createProfile(name)
              switchProfile(p.id)
            } else {
              await renameProfile(naming.profile.id, name)
              setNaming(undefined)
            }
          }}
        />
      )}
    </>
  )
}

function NameModal(props: {
  title: string
  initial: string
  okText: string
  help?: string
  onCancel: () => void
  onOk: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(props.initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await props.onOk(name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      title={props.title}
      okText={props.okText}
      okButtonProps={{ disabled: !name.trim(), loading: busy }}
      onOk={() => void submit()}
      onCancel={props.onCancel}
    >
      <Input
        autoFocus
        value={name}
        maxLength={80}
        placeholder="e.g. Sales team network"
        onChange={(e) => setName(e.target.value)}
        onPressEnter={() => name.trim() && void submit()}
        style={{ marginTop: 8 }}
      />
      {props.help && (
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12.5, marginTop: 8 }}>
          {props.help}
        </Typography.Text>
      )}
      {error && (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>
          {error}
        </Typography.Text>
      )}
    </Modal>
  )
}

/** Where the data lives right now: synced to the shared database, saving, offline, or this browser only. */
export function SyncStatus() {
  const { status, message, lastSyncedAt, syncNow } = useSync()
  const [asking, setAsking] = useState(false)
  const [code, setCode] = useState('')

  const view =
    status === 'synced'
      ? {
          icon: <CloudOutlined />,
          text: 'Saved to database',
          tip: lastSyncedAt ? `Last synced ${relativeTime(lastSyncedAt)}. Click to sync now.` : 'Click to sync now.',
        }
      : status === 'syncing' || status === 'starting'
        ? { icon: <LoadingOutlined />, text: 'Syncing…', tip: 'Sending and receiving changes.' }
        : status === 'local'
          ? {
              icon: <LockOutlined />,
              text: 'Stored only in this browser',
              tip: message ?? 'The shared database isn’t set up (MONGODB_URI).',
            }
          : status === 'access'
            ? { icon: <LockOutlined />, text: 'Access code needed', tip: 'Click to enter the workspace access code.' }
            : status === 'offline'
              ? { icon: <CloudOffOutlined />, text: 'Offline — saved here', tip: message }
              : { icon: <WarningOutlined />, text: 'Sync problem', tip: message }

  return (
    <>
      <Tooltip title={view.tip} placement="top">
        <button
          type="button"
          className="sync-status"
          onClick={() => (status === 'access' ? setAsking(true) : void syncNow())}
        >
          {view.icon} {view.text}
        </button>
      </Tooltip>
      {asking && (
        <Modal
          open
          title="Workspace access code"
          okText="Connect"
          okButtonProps={{ disabled: !code.trim() }}
          onCancel={() => setAsking(false)}
          onOk={async () => {
            saveAccessCode(code)
            setAsking(false)
            setCode('')
            await syncNow()
          }}
        >
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            The shared database is protected by a code set by whoever deployed the app (APP_ACCESS_KEY). It’s remembered
            in this browser.
          </Typography.Text>
          <Input.Password autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </Modal>
      )}
    </>
  )
}
