import { ensureDefaultProfile, finishPendingDeletes } from '../lib/profiles'
import { useSync } from '../lib/sync/store'
import { migrateLegacySettings } from '../lib/db'
import { useApolloKey } from '../features/enrich/apolloKey'
import { useEffect, useState } from 'react'
import { App as AntApp, ConfigProvider, Layout } from 'antd'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Result, Spin } from 'antd'
import { buildTheme, cssVars, PALETTE } from './theme'
import { useUi } from './store'
import { Sidebar } from './Sidebar'
import { useAi } from '../features/ai/store'
import { CapNotice } from '../features/ai/CapNotice'
import { ContactsPage } from '../features/contacts/ContactsPage'
import { ConnectionsPage } from '../features/contacts/ConnectionsPage'
import { ImportPage } from '../features/import/ImportPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { AiPage, KeywordPacksPage } from '../features/settings/SetupPages'
import { EnrichPage } from '../features/enrich/EnrichPage'
import { CollectPage } from '../features/enrich/CollectPage'
import { PresetsPage } from '../features/settings/PresetsPage'
import { BriefsPage } from '../features/settings/BriefsPage'
import { AccuracyPage } from '../features/settings/AccuracyPage'
import { ResultsPage } from '../features/ai/ResultsPage'
import { NewSearchPage } from '../features/ai/NewSearchPage'
import { useAuth } from '../features/auth/store'
import { HomePage } from '../features/home/HomePage'
import { SignInPage } from '../features/auth/SignInPage'
import { AdminPage } from '../features/admin/AdminPage'
import { PrivacyPage } from '../features/auth/PrivacyPage'

function useSystemDark() {
  const query = '(prefers-color-scheme: dark)'
  const [dark, setDark] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return dark
}

export function Root() {
  const themeMode = useUi((s) => s.themeMode)
  const systemDark = useSystemDark()
  const dark = themeMode === 'dark' || (themeMode === 'system' && systemDark)

  const { status, message, load } = useAuth()
  const { pathname } = useLocation()
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const root = document.documentElement
    root.style.colorScheme = dark ? 'dark' : 'light'
    for (const [k, v] of Object.entries(cssVars(dark))) root.style.setProperty(k, v)
    document.body.style.background = (dark ? PALETTE.dark : PALETTE.light).bg
  }, [dark])

  return (
    <ConfigProvider theme={buildTheme(dark)} componentSize="middle">
      <AntApp style={{ height: '100%' }}>
        {pathname === '/privacy' ? (
          <PrivacyPage />
        ) : status === 'loading' ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <Spin />
          </div>
        ) : status === 'error' ? (
          <Result status="warning" title="Can’t open the workspace" subTitle={message} />
        ) : status === 'signed-out' ? (
          <SignInPage />
        ) : (
          <Workspace />
        )}
      </AntApp>
    </ConfigProvider>
  )
}

/** The app itself. Only mounted once someone is signed in, so no local data loads or syncs before that. */
function Workspace() {
  const isAdmin = useAuth((s) => s.user?.role === 'super_admin')
  const initAi = useAi((s) => s.init)
  const initApollo = useApolloKey((s) => s.init)
  useEffect(() => {
    // Settings and keys move to the app-wide store once (they used to live with the first profile).
    void migrateLegacySettings().then(async () => {
      void initAi()
      void initApollo()
      await ensureDefaultProfile()
      await finishPendingDeletes()
      // Starts sending and receiving this profile's data (or stays local if no database is set up).
      void useSync.getState().start()
    })
  }, [initAi, initApollo])

  return (
    <>
      <CapNotice />
      <Layout style={{ height: '100%' }}>
        <Sidebar />
        <Layout.Content style={{ minWidth: 0, overflow: 'hidden' }}>
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route path="/" element={<ConnectionsPage />} />
            <Route path="/table" element={<ContactsPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/results/new" element={<NewSearchPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/enrich" element={<CollectPage />} />
            <Route path="/enrich/csv" element={<EnrichPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/ai" element={<AiPage />} />
            <Route path="/keyword-packs" element={<KeywordPacksPage />} />
            <Route path="/presets" element={<PresetsPage />} />
            <Route path="/briefs" element={<BriefsPage />} />
            <Route path="/accuracy" element={<AccuracyPage />} />
            <Route path="/admin" element={isAdmin ? <AdminPage /> : <Navigate to="/home" replace />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </Layout.Content>
      </Layout>
    </>
  )
}
