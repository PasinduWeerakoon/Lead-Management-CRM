import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { App, Button, Checkbox, Flex, Input, Modal, Segmented, Tabs, Typography, Upload } from 'antd'
import { LimitsSection } from './LimitsSection'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  DesktopOutlined,
  LockOutlined,
  MoonOutlined,
  RightOutlined,
  SunOutlined,
  UploadOutlined,
} from '../../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import { appDb } from '../../lib/app-db'
import { deleteOtherProfiles } from '../../lib/profiles'
import { createBackup, deleteAllData, readBackup, restoreBackup } from '../../lib/backup'
import { downloadFile } from '../../lib/files'
import { relativeTime } from '../../lib/format'
import { useUi, type ThemeMode } from '../../app/store'
import { resetFilters } from '../filters/store'

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="section-title">{title}</div>
        <div className="section-sub">{description}</div>
      </div>
      <div className="panel-body">
        <Flex vertical gap={14}>
          {children}
        </Flex>
      </div>
    </section>
  )
}

export function SettingsPage() {
  const { message, modal } = App.useApp()
  const { themeMode, setThemeMode } = useUi()
  const count = useLiveQuery(() => db.contacts.count(), [], 0)
  // Searches, prompts and imports count too: an older version could leave them after deleting contacts.
  const other = useLiveQuery(
    async () => (await db.scoreRuns.count()) + (await db.briefs.count()) + (await db.imports.count()),
    [],
    0,
  )
  const lastImport = useLiveQuery(() => db.imports.orderBy('at').last())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const navigate = useNavigate()

  const backup = async () => {
    const data = await createBackup()
    const stamp = new Date().toISOString().slice(0, 10)
    downloadFile(JSON.stringify(data, null, 2), `leads-backup-${stamp}.json`, 'application/json')
    message.success(`Backup saved with ${data.contacts.length.toLocaleString()} contacts.`)
  }

  const restore = async (file: File) => {
    const res = readBackup(await file.text())
    if (!res.ok) {
      message.error(res.error)
      return
    }
    const n = res.backup.contacts.length
    modal.confirm({
      title: 'Restore this backup?',
      content: `This replaces your current ${count.toLocaleString()} contacts with the ${n.toLocaleString()} in the backup from ${relativeTime(res.backup.exportedAt)}.`,
      okText: 'Replace and restore',
      okButtonProps: { danger: true },
      onOk: async () => {
        await restoreBackup(res.backup)
        resetFilters()
        message.success(`Restored ${n.toLocaleString()} contacts.`)
      },
    })
  }

  const [alsoOthers, setAlsoOthers] = useState(false)
  const profileCount = useLiveQuery(() => appDb.profiles.count(), [], 1)
  const wipe = async () => {
    const removed = alsoOthers ? await deleteOtherProfiles() : 0
    await deleteAllData()
    // Old filters would otherwise hide people in the next import until a page refresh.
    resetFilters()
    setDeleteOpen(false)
    setConfirmText('')
    setAlsoOthers(false)
    message.success(
      removed
        ? `All data was deleted, including ${removed} other ${removed === 1 ? 'profile' : 'profiles'}.`
        : 'All data in this profile was deleted.',
    )
  }

  return (
    <div className="screen">
      <div className="screen-body">
        <div className="screen-narrow">
          <PageHeader title="Settings" />
          <Tabs
            items={[
              { key: 'limits', label: 'AI limit and Apollo', children: <LimitsSection /> },
              {
                key: 'helpers',
                label: 'Search helpers',
                children: (
                  <Flex vertical gap={10}>
                    {[
                      ['/briefs', 'Briefs', 'What 1BT sells, so the AI can judge fit.'],
                      ['/keyword-packs', 'Keyword packs', 'Word lists such as cloud or testing roles.'],
                      ['/presets', 'Filter presets', 'Saved filter sets for the table view.'],
                      ['/accuracy', 'Accuracy check', 'Mark AI results right or wrong to see how far to trust them.'],
                    ].map(([to, label, note]) => (
                      <Flex
                        key={to}
                        justify="space-between"
                        align="center"
                        gap={12}
                        className="panel"
                        style={{ padding: '12px 16px' }}
                      >
                        <span>
                          <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{label}</b>
                          <span style={{ display: 'block', fontSize: 13, color: 'var(--text-3)' }}>{note}</span>
                        </span>
                        <Button onClick={() => navigate(to)}>
                          Open <RightOutlined />
                        </Button>
                      </Flex>
                    ))}
                  </Flex>
                ),
              },
              {
                key: 'data',
                label: 'Data and backup',
                children: (
                  <>
                    <Section title="Appearance" description="Pick light, dark, or follow your computer.">
                      <Segmented<ThemeMode>
                        value={themeMode}
                        onChange={setThemeMode}
                        options={[
                          { value: 'light', label: 'Light', icon: <SunOutlined /> },
                          { value: 'system', label: 'System', icon: <DesktopOutlined /> },
                          { value: 'dark', label: 'Dark', icon: <MoonOutlined /> },
                        ]}
                        style={{ alignSelf: 'flex-start' }}
                      />
                    </Section>

                    <Section
                      title="Your data"
                      description="This profile’s data is kept in this browser and, when the shared database is connected, saved there too. Without a database, clearing browser data removes it — keep a backup."
                    >
                      <Typography.Text>
                        <LockOutlined style={{ marginRight: 6, opacity: 0.6 }} />
                        {count.toLocaleString()} contacts saved
                        {lastImport && ` · last import ${relativeTime(lastImport.at)}`}
                      </Typography.Text>
                      <Flex gap={8} wrap>
                        <Button icon={<CloudDownloadOutlined />} onClick={backup} disabled={count === 0}>
                          Download backup
                        </Button>
                        <Upload
                          accept=".json,application/json"
                          showUploadList={false}
                          beforeUpload={(file) => {
                            void restore(file)
                            return Upload.LIST_IGNORE
                          }}
                        >
                          <Button icon={<UploadOutlined />}>Restore from backup</Button>
                        </Upload>
                        <Button
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => setDeleteOpen(true)}
                          disabled={count + other === 0 && profileCount < 2}
                        >
                          Delete all data
                        </Button>
                      </Flex>
                    </Section>
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      <Modal
        open={deleteOpen}
        title="Delete all data in this profile?"
        okText="Delete everything"
        okButtonProps={{ danger: true, disabled: confirmText !== 'DELETE' }}
        onOk={wipe}
        onCancel={() => {
          setDeleteOpen(false)
          setConfirmText('')
        }}
      >
        <Flex vertical gap={12}>
          <Typography.Text>
            This removes all {count.toLocaleString()} contacts with their collected web data, the import history, every
            search with all its runs and results, and the saved prompts, from this profile (and the shared database,
            when connected). Keyword packs, saved views and filter presets are kept. It can't be undone unless you have
            a backup.
          </Typography.Text>
          {profileCount > 1 && (
            <Checkbox checked={alsoOthers} onChange={(e) => setAlsoOthers(e.target.checked)}>
              Also delete the other {profileCount - 1} {profileCount - 1 === 1 ? 'profile' : 'profiles'} and all their
              data
            </Checkbox>
          )}
          <Input
            placeholder="Type DELETE to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
        </Flex>
      </Modal>
    </div>
  )
}
