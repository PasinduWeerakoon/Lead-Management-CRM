import { useState } from 'react'
import { Button, Layout, Menu, Tooltip } from 'antd'
import {
  BankOutlined,
  CheckCircleOutlined,
  BulbOutlined,
  CloudUploadOutlined,
  DesktopOutlined,
  FileTextOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation, useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useUi, type ThemeMode } from './store'
import { ProfileSwitcher, SyncStatus } from './ProfileSwitcher'

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' }
const THEME_ICON: Record<ThemeMode, React.ReactNode> = {
  light: <SunOutlined />,
  dark: <MoonOutlined />,
  system: <DesktopOutlined />,
}
const THEME_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'Match system' }

/** Monogram mark: a blue tile with a white "L". */
function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden style={{ flex: 'none' }}>
      <rect width="28" height="28" rx="7" fill="var(--primary)" />
      <path
        d="M10 7.5v13h8.5"
        stroke="var(--on-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="18.5" cy="9.5" r="2" fill="#fff" opacity=".6" />
    </svg>
  )
}

export function Sidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const { themeMode, setThemeMode } = useUi()
  const count = useLiveQuery(() => db.contacts.count(), [], 0)

  const nav = (items: Array<{ key: string; icon: React.ReactNode; label: React.ReactNode }>) => (
    <Menu
      mode="inline"
      inlineCollapsed={collapsed}
      selectedKeys={[pathname]}
      items={items}
      onClick={(e) => navigate(e.key)}
      style={{ border: 'none', background: 'transparent' }}
    />
  )

  return (
    <Layout.Sider
      width={236}
      collapsedWidth={60}
      collapsed={collapsed}
      breakpoint="lg"
      onBreakpoint={setCollapsed}
      trigger={null}
      style={{ borderRight: '1px solid var(--border-subtle)' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          style={{
            height: 52,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? 0 : '0 8px 0 14px',
          }}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}
            >
              <Mark />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => navigate('/')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  border: 0,
                  background: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  minWidth: 0,
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <Mark />
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
                    Leads
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Prospecting workspace</span>
                </span>
              </button>
              <Tooltip title="Collapse sidebar" placement="right">
                <Button
                  type="text"
                  size="small"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setCollapsed(true)}
                  aria-label="Collapse sidebar"
                  style={{ color: 'var(--text-3)' }}
                />
              </Tooltip>
            </>
          )}
        </div>

        <div style={{ padding: collapsed ? '0 0 4px' : '0 8px 4px', display: 'flex', justifyContent: 'center' }}>
          <ProfileSwitcher collapsed={collapsed} />
        </div>

        <div style={{ padding: '4px 8px', flex: 1, overflowY: 'auto' }}>
          {!collapsed && (
            <div className="sidebar-section" style={{ paddingTop: 8 }}>
              Workspace
            </div>
          )}
          {nav([
            {
              key: '/',
              icon: <UserOutlined />,
              label: (
                <span
                  style={{
                    display: 'inline-flex',
                    width: '100%',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  People
                  {count > 0 && (
                    <span className="num" style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                      {count.toLocaleString()}
                    </span>
                  )}
                </span>
              ),
            },
            { key: '/import', icon: <CloudUploadOutlined />, label: 'Import' },
            { key: '/enrich', icon: <BankOutlined />, label: 'Company data' },
          ])}

          {!collapsed && <div className="sidebar-section">Setup</div>}
          {nav([
            { key: '/presets', icon: <ThunderboltOutlined />, label: 'Presets' },
            { key: '/briefs', icon: <FileTextOutlined />, label: 'Briefs' },
            { key: '/keyword-packs', icon: <TagsOutlined />, label: 'Keyword packs' },
            { key: '/ai', icon: <BulbOutlined />, label: 'AI assistant' },
            { key: '/accuracy', icon: <CheckCircleOutlined />, label: 'Accuracy' },
          ])}
        </div>

        <div style={{ padding: '8px 8px 12px', borderTop: '1px solid var(--border-subtle)' }}>
          {nav([{ key: '/settings', icon: <SettingOutlined />, label: 'Settings' }])}
          {collapsed ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
              <Button
                type="text"
                size="small"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
              />
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 4px 0 10px',
              }}
            >
              <SyncStatus />
              <Tooltip title={`Theme: ${THEME_LABEL[themeMode]}`} placement="top">
                <Button
                  type="text"
                  size="small"
                  icon={THEME_ICON[themeMode]}
                  onClick={() => setThemeMode(THEME_NEXT[themeMode])}
                  aria-label={`Theme: ${THEME_LABEL[themeMode]}. Click to change.`}
                  style={{ color: 'var(--text-2)' }}
                />
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </Layout.Sider>
  )
}
