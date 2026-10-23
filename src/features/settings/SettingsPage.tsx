import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../../components/TopBar'
import { PageHeader } from '../../components/PageHeader'
import { App, Button, Flex, Input, Modal, Segmented, Typography, Upload } from 'antd'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  DesktopOutlined,
  LockOutlined,
  MoonOutlined,
  RightOutlined,
  SettingOutlined,
  SunOutlined,
  UploadOutlined,
} from '../../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
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

  const wipe = async () => {
    await deleteAllData()
    // Old filters would otherwise hide people in the next import until a page refresh.
    resetFilters()
    setDeleteOpen(false)
    setConfirmText('')
    message.success('All contacts were deleted from this profile.')
  }

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Settings', icon: <SettingOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow">
          <PageHeader title="Settings" description="Appearance, backups and this profile’s data." />
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
              <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteOpen(true)} disabled={count === 0}>
                Delete all data
              </Button>
            </Flex>
          </Section>

          <Section title="Setup" description="Your AI key and keyword packs have their own pages.">
            <Flex gap={8} wrap>
              <Button onClick={() => navigate('/ai')}>
                AI assistant <RightOutlined />
              </Button>
              <Button onClick={() => navigate('/keyword-packs')}>
                Keyword packs <RightOutlined />
              </Button>
            </Flex>
          </Section>
        </div>
      </div>

      <Modal
        open={deleteOpen}
        title="Delete all contacts?"
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
            This removes all {count.toLocaleString()} contacts and import history from this profile (and the shared
            database, when connected). Saved views and keyword packs are kept. It can't be undone unless you have a
            backup.
          </Typography.Text>
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
