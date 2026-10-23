import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Dropdown, Empty, Input, Skeleton, Table, Tooltip, type GetRef } from 'antd'
import {
  BulbOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FilterOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  TableOutlined,
  UserOutlined,
} from '../../components/icons'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db } from '../../lib/db'
import type { Contact } from '../../lib/schemas'
import { SENIORITIES } from '../../lib/schemas'
import { compileFilter, countConditions, highlightRegex, positiveTerms } from '../../lib/filters/engine'
import { describeFilter } from '../../lib/filters/describe'
import { updateContact } from '../../lib/contacts'
import { emptyFilter, type FieldKey, type KeywordPack } from '../../lib/filters/schema'
import { TopBar } from '../../components/TopBar'
import { BulkBar } from './BulkBar'
import { ExportModal } from './ExportModal'
import { WelcomeEmpty } from './WelcomeEmpty'
import { ContactDrawer } from './ContactDrawer'
import { buildColumns, type RunKind } from './columns'
import { keywordIndex } from '../../lib/keywords'
import { ColumnsPicker, useVisibleColumns } from './ColumnsPicker'
import { ViewTabs } from './ViewTabs'
import { ADD_FILTER_BUTTON_ID, FilterBar, PresetsButton } from '../filters/FilterBar'
import { sameFilter, useFilters } from '../filters/store'
import { createView, deleteView, updateView } from '../filters/views'
import { NameViewModal } from '../filters/NameViewModal'
import { AiNotice, AskAiButton } from '../ai/AskAi'
import { ScoreModal } from '../ai/ScoreModal'
import { HqModal } from '../ai/HqModal'
import { EnrichRunModal } from '../enrich/EnrichRunModal'
import { ResearchModal } from '../enrich/ResearchModal'

const SEARCH_ID = 'contact-search'
const VIRTUAL_FROM = 600

const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
const priorityRank = (c: Contact) => PRIORITY_RANK[c.priority ?? ''] ?? 3

type SortKey = 'name' | 'aiScore' | 'recent' | 'priority' | 'seniority' | 'company'
const SORTS: Record<SortKey, { label: string; cmp: (a: Contact, b: Contact) => number }> = {
  name: { label: 'Name A–Z', cmp: (a, b) => a.fullName.localeCompare(b.fullName) },
  aiScore: { label: 'AI score (high first)', cmp: (a, b) => (b.ai?.score ?? -1) - (a.ai?.score ?? -1) },
  recent: { label: 'Recently connected', cmp: (a, b) => (b.connectedOn ?? '').localeCompare(a.connectedOn ?? '') },
  priority: { label: 'Priority', cmp: (a, b) => priorityRank(a) - priorityRank(b) },
  seniority: { label: 'Seniority', cmp: (a, b) => SENIORITIES.indexOf(a.seniority) - SENIORITIES.indexOf(b.seniority) },
  company: { label: 'Company A–Z', cmp: (a, b) => (a.company ?? '~').localeCompare(b.company ?? '~') },
}

function matches(c: Contact, q: string) {
  return (
    c.fullName.toLowerCase().includes(q) ||
    (c.position?.toLowerCase().includes(q) ?? false) ||
    (c.company?.toLowerCase().includes(q) ?? false)
  )
}

/**
 * Measures the grid area. The first size is read synchronously when the element mounts, because a
 * ResizeObserver only reports after a paint — which never comes for a tab opened in the background.
 * Callback ref, so it also works for an element that isn't there on the first render (while loading).
 */
function useElementHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState<number | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    setHeight(el.getBoundingClientRect().height)
    observer.current = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    observer.current.observe(el)
  }, [])
  return [ref, height] as const
}

const isTyping = (e: KeyboardEvent) =>
  e.metaKey ||
  e.ctrlKey ||
  e.altKey ||
  !!(e.target as HTMLElement).closest('input, textarea, [contenteditable], .ant-select, .ant-popover, .ant-segmented')

export function ContactsPage() {
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const [params, setParams] = useSearchParams()
  const viewParam = params.get('view') ?? undefined

  const contacts = useLiveQuery(() => db.contacts.toArray())
  const packs = useLiveQuery(() => db.keywordPacks.orderBy('name').toArray(), [], [] as KeywordPack[])
  // The result is tagged with the id it was looked up for: right after the URL changes, useLiveQuery
  // still returns the previous result, which must count as "loading", not as "view not found".
  const viewLookup = useLiveQuery(
    async () => ({ param: viewParam, view: viewParam ? ((await db.views.get(viewParam)) ?? null) : null }),
    [viewParam],
  )
  // `null` = looked up and not found; `undefined` = still loading.
  const view = viewLookup && viewLookup.param === viewParam ? viewLookup.view : undefined

  const { draft, viewId, load } = useFilters()
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  const deferredQuery = useDeferredValue(query.trim().toLowerCase())
  const deferredDraft = useDeferredValue(draft)
  // ?open=<id> (from the Accuracy page) opens that person's panel.
  const [openId, setOpenId] = useState<string | undefined>(() => params.get('open') ?? undefined)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [exporting, setExporting] = useState<'shown' | 'selected'>()
  const [naming, setNaming] = useState<'new' | 'rename'>()
  const [scoring, setScoring] = useState(false)
  // "Score with this" on the Briefs page links here with ?score=1 to open Score with AI.
  const showScore = scoring || params.get('score') === '1'
  const closeScore = () => {
    setScoring(false)
    if (params.has('score')) {
      const next = new URLSearchParams(params)
      next.delete('score')
      setParams(next, { replace: true })
    }
  }
  const [findingHq, setFindingHq] = useState(false)
  const [enrichRun, setEnrichRun] = useState<{ kind: 'apollo' | 'phone' }>()
  const [researching, setResearching] = useState(false)
  const runColumn = useCallback((kind: RunKind) => {
    if (kind === 'research') setResearching(true)
    else if (kind === 'hq') setFindingHq(true)
    else setEnrichRun({ kind })
  }, [])
  const [tableRef, tableHeight] = useElementHeight<HTMLDivElement>()
  const { visible, hidden, setHidden } = useVisibleColumns()

  const showFilters = filtersOpen || draft.items.length > 0

  const openAddFilter = () => {
    setFiltersOpen(true)
    // Wait for the filter row to render, then open its field menu.
    setTimeout(() => document.getElementById(ADD_FILTER_BUTTON_ID)?.click(), 0)
  }

  // "/" opens search and "f" adds a filter, unless you're typing somewhere or a lead is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector('.ant-drawer-open')) return
      if (e.key === '/') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => document.getElementById(SEARCH_ID)?.focus(), 0)
      } else if (e.key === 'f') {
        e.preventDefault()
        setFiltersOpen(true)
        setTimeout(() => document.getElementById(ADD_FILTER_BUTTON_ID)?.click(), 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Switching views loads that view's filters. Coming back to the same view keeps unsaved edits.
  useEffect(() => {
    if (view === undefined) return
    if (viewParam && view === null) {
      message.info('That view no longer exists.')
      navigate('/', { replace: true })
      return
    }
    if (viewParam !== viewId) load(view ? view.filter : emptyFilter(), viewParam)
  }, [view, viewParam, viewId, load, navigate, message])

  const packMap = useMemo(() => new Map(packs.map((p) => [p.id, p])), [packs])

  const listOptions = useMemo(() => {
    const role = new Set<string>()
    const own = new Set<string>()
    for (const c of contacts ?? []) {
      c.titleTags.forEach((t) => role.add(t))
      c.tags.forEach((t) => own.add(t))
    }
    const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b))
    const byField: Partial<Record<FieldKey, string[]>> = { titleTags: sorted(role), tags: sorted(own) }
    return (field: FieldKey) => byField[field] ?? []
  }, [contacts])

  const filterCtx = useMemo(() => ({ packs: packMap }), [packMap])
  const predicate = useMemo(() => compileFilter(deferredDraft, filterCtx), [deferredDraft, filterCtx])
  const highlight = useMemo(() => highlightRegex(deferredDraft, filterCtx), [deferredDraft, filterCtx])

  // When AI-built filters match nobody: how many people each top-level condition matches on its own.
  const breakdown = useMemo(() => {
    if (!contacts || deferredDraft.items.length < 2) return []
    return deferredDraft.items.map((item) => {
      const one = { combinator: 'and' as const, items: [item] }
      const pred = compileFilter(one, filterCtx)
      return {
        label: describeFilter(one, packMap).join(' ') || 'Filter',
        count: pred ? contacts.filter(pred).length : contacts.length,
      }
    })
  }, [contacts, deferredDraft, filterCtx, packMap])

  /** Saves the asked text as a brief (or reuses one with the same text) and opens Score with AI for the people shown. */
  const scoreWithPrompt = async (prompt: string) => {
    const text = prompt.trim().slice(0, 4000)
    const existing = (await db.briefs.toArray()).find((b) => b.text.trim() === text)
    const now = new Date().toISOString()
    const firstLine = text.split('\n')[0].replace(/\s+/g, ' ').trim()
    const brief = existing ?? {
      id: crypto.randomUUID(),
      name: (firstLine.length > 3 ? firstLine : 'Ask AI brief').slice(0, 80),
      text,
      createdAt: now,
      updatedAt: now,
    }
    if (!existing) await db.briefs.put(brief)
    try {
      localStorage.setItem('leads.lastBrief', brief.id)
    } catch {
      // the brief can still be picked in the dialog
    }
    setScoring(true)
  }

  const rows = useMemo(() => {
    if (!contacts) return []
    const list = contacts.filter((c) => (!predicate || predicate(c)) && (!deferredQuery || matches(c, deferredQuery)))
    return list.sort((a, b) => SORTS[sort].cmp(a, b) || a.fullName.localeCompare(b.fullName))
  }, [contacts, predicate, deferredQuery, sort])

  // Selection only counts people still visible, so changing filters never acts on hidden rows.
  const selectedRows = useMemo(() => {
    const set = new Set(selectedIds)
    return rows.filter((r) => set.has(r.id))
  }, [rows, selectedIds])

  const openIndex = openId ? rows.findIndex((r) => r.id === openId) : -1

  // Drawer keys: ↑/↓ (or k/j) move through the list, S toggles shortlisted.
  useEffect(() => {
    if (!openId) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if ((e.key === 'ArrowDown' || e.key === 'j') && openIndex >= 0 && openIndex < rows.length - 1) {
        e.preventDefault()
        setOpenId(rows[openIndex + 1].id)
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && openIndex > 0) {
        e.preventDefault()
        setOpenId(rows[openIndex - 1].id)
      } else if (e.key === 's') {
        const c = contacts?.find((x) => x.id === openId)
        if (c) void updateContact(c.id, { status: c.status === 'shortlisted' ? 'new' : 'shortlisted' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, openIndex, rows, contacts])

  // Skill Match reports the keywords the filters look for, or every pack keyword when there are none.
  const skill = useMemo(() => {
    const words = positiveTerms(deferredDraft, filterCtx).words
    return words.length
      ? { terms: words, source: 'filter' as const }
      : { terms: [...new Set(packs.flatMap((p) => p.keywords))], source: 'packs' as const }
  }, [deferredDraft, filterCtx, packs])

  // Matched keywords per person: your filter's keywords, or every keyword pack when none are set.
  const keywords = useMemo(() => keywordIndex(contacts ?? [], skill.terms), [contacts, skill.terms])
  const columns = useMemo(
    () => buildColumns(visible, rows, { highlight, keywords, onRun: runColumn }),
    [visible, rows, highlight, keywords, runColumn],
  )

  // New filters, search or sort start from the top. Otherwise a list that was scrolled down keeps its old
  // offset, the first matches sit hidden above, and it looks as if the results didn't load.
  const tableInstance = useRef<GetRef<typeof Table>>(null)
  useEffect(() => {
    tableInstance.current?.scrollTo?.({ top: 0 })
  }, [deferredDraft, deferredQuery, sort])
  const scrollX = useMemo(() => columns.reduce((w, c) => w + (Number(c.width) || 0), 56), [columns])

  if (contacts === undefined || view === undefined) {
    return (
      <div className="screen">
        <div className="screen-body">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      </div>
    )
  }

  if (contacts.length === 0) return <WelcomeEmpty />

  const open = openId ? contacts.find((c) => c.id === openId) : undefined
  const activeView = view ?? undefined
  const dirty = activeView ? !sameFilter(draft, activeView.filter) : draft.items.length > 0
  const conditionCount = countConditions(draft)

  const saveChanges = async () => {
    if (!activeView) return
    await updateView(activeView.id, { filter: draft })
    message.success(`Saved “${activeView.name}”.`)
  }

  const saveNew = async (name: string) => {
    const created = await createView(name, draft)
    setNaming(undefined)
    load(created.filter, created.id)
    navigate(`/?view=${created.id}`)
    message.success(`Saved “${created.name}”.`)
  }

  const rename = async (name: string) => {
    if (!activeView) return
    await updateView(activeView.id, { name })
    setNaming(undefined)
  }

  const remove = () => {
    if (!activeView) return
    modal.confirm({
      title: `Delete “${activeView.name}”?`,
      content: 'Only the saved view is deleted. Your contacts stay as they are.',
      okText: 'Delete view',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteView(activeView.id)
        navigate('/')
      },
    })
  }

  return (
    <div className="screen" style={{ position: 'relative' }}>
      <TopBar
        crumbs={[
          { label: 'People', icon: <UserOutlined />, onClick: activeView ? () => navigate('/') : undefined },
          activeView
            ? {
                label: activeView.name,
                icon: <TableOutlined />,
                menu: {
                  items: [
                    { key: 'rename', icon: <EditOutlined />, label: 'Rename view', onClick: () => setNaming('rename') },
                    {
                      key: 'duplicate',
                      icon: <CopyOutlined />,
                      label: 'Duplicate',
                      onClick: () => saveNew(`${activeView.name} (copy)`),
                    },
                    { type: 'divider' },
                    { key: 'delete', icon: <DeleteOutlined />, label: 'Delete view', danger: true, onClick: remove },
                  ],
                },
              }
            : { label: 'All people', icon: <TableOutlined /> },
        ]}
        actions={
          <>
            <Button icon={<CloudUploadOutlined />} onClick={() => navigate('/import')}>
              Import
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => setExporting('shown')}
              disabled={rows.length === 0}
            >
              Export
            </Button>
          </>
        }
      />

      <div className="toolbar">
        <div className="tool-row">
          <Tooltip title="People shown / total">
            <span className="tool-btn static">
              <TableOutlined />
              <span>
                <b>{rows.length.toLocaleString()}</b> / {contacts.length.toLocaleString()}
              </span>
            </span>
          </Tooltip>
          <span className="tool-sep" />
          <ColumnsPicker hidden={hidden} onChange={setHidden} />
          <Tooltip title="Filter (F)">
            <button
              type="button"
              className={`tool-btn${showFilters ? ' active' : ''}`}
              onClick={() => (showFilters && draft.items.length === 0 ? setFiltersOpen(false) : openAddFilter())}
              aria-label="Filter"
            >
              <FilterOutlined />
              Filter
              {conditionCount > 0 && <span className="count-pill">{conditionCount}</span>}
            </button>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            menu={{
              selectable: true,
              selectedKeys: [sort],
              items: (Object.keys(SORTS) as SortKey[]).map((k) => ({ key: k, label: SORTS[k].label })),
              onClick: ({ key }) => setSort(key as SortKey),
            }}
          >
            <Tooltip title={`Sort: ${SORTS[sort].label}`}>
              <button type="button" className={`tool-btn${sort !== 'name' ? ' active' : ''}`} aria-label="Sort">
                <SortAscendingOutlined />
                Sort
              </button>
            </Tooltip>
          </Dropdown>
          {searchOpen || query ? (
            <Input
              id={SEARCH_ID}
              autoFocus
              allowClear
              size="middle"
              prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
              placeholder="Search name, title or company"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => !query && setSearchOpen(false)}
              onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), setSearchOpen(false))}
              style={{ width: 260 }}
              aria-label="Search contacts"
            />
          ) : (
            <Tooltip title="Search (/)">
              <button type="button" className="tool-btn" onClick={() => setSearchOpen(true)} aria-label="Search">
                <SearchOutlined />
                Search
              </button>
            </Tooltip>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PresetsButton />
          <AskAiButton packs={packs} />
          <Button type="primary" icon={<BulbOutlined />} onClick={() => setScoring(true)} disabled={rows.length === 0}>
            Score with AI
          </Button>
        </div>
      </div>

      {showFilters && <FilterBar ctx={{ packs, packMap, listOptions }} />}
      <AiNotice matches={rows.length} breakdown={breakdown} onScore={(prompt) => void scoreWithPrompt(prompt)} />

      <div ref={tableRef} className="sheet">
        {tableHeight !== null && (
          <Table<Contact>
            ref={tableInstance}
            // The scrolling mode follows the whole list, not the filtered rows, so filtering never flips it;
            // the key remounts the grid cleanly if an import or delete crosses the threshold.
            key={contacts.length > VIRTUAL_FROM ? 'virtual' : 'native'}
            className="clickable-rows"
            // Native scrolling is smoother with trackpad momentum; virtual rows only pay off for big lists.
            virtual={contacts.length > VIRTUAL_FROM}
            bordered
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: scrollX, y: Math.max(tableHeight - 64, 200) }}
            onRow={(c) => ({
              // Clicks in the checkbox column select; everywhere else opens the lead.
              onClick: (e) => {
                if (!(e.target as HTMLElement).closest('.ant-table-selection-column')) setOpenId(c.id)
              },
            })}
            rowSelection={{
              selectedRowKeys: selectedRows.map((r) => r.id),
              onChange: (keys) => setSelectedIds(keys as string[]),
              columnWidth: 56,
              fixed: true,
              renderCell: (checked, _record, index, node) => (
                <div className={`rownum${checked ? ' checked' : ''}`}>
                  <span className="rownum-n">{index + 1}</span>
                  <span className="rownum-box">{node}</span>
                </div>
              ),
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    deferredQuery
                      ? `No one matches “${query.trim()}”. Try a company or a shorter word.`
                      : `No one matches these ${conditionCount} filters. Try removing one, or switch an “and” to “or”.`
                  }
                />
              ),
            }}
          />
        )}
      </div>

      <ViewTabs
        activeId={activeView?.id}
        shown={rows.length}
        total={contacts.length}
        dirty={dirty}
        canSave={draft.items.length > 0}
        onSaveNew={() => setNaming('new')}
        onSaveChanges={saveChanges}
      />

      {selectedRows.length > 0 && (
        <BulkBar selected={selectedRows} onClear={() => setSelectedIds([])} onExport={() => setExporting('selected')} />
      )}

      <ContactDrawer
        contact={open}
        position={openIndex >= 0 ? { index: openIndex, total: rows.length } : undefined}
        onPrev={() => openIndex > 0 && setOpenId(rows[openIndex - 1].id)}
        onNext={() => openIndex < rows.length - 1 && setOpenId(rows[openIndex + 1].id)}
        onClose={() => setOpenId(undefined)}
        tagOptions={listOptions('tags')}
      />

      {exporting && (
        <ExportModal
          open
          onClose={() => setExporting(undefined)}
          title={activeView?.name ?? 'All people'}
          shown={rows}
          selected={selectedRows}
          skillTerms={skill.terms}
          skillSource={skill.source}
          filterSummary={describeFilter(draft, packMap)}
          defaultScope={exporting}
        />
      )}

      {findingHq && <HqModal shown={rows} selected={selectedRows} all={contacts} onClose={() => setFindingHq(false)} />}

      {researching && <ResearchModal shown={rows} selected={selectedRows} onClose={() => setResearching(false)} />}

      {enrichRun && (
        <EnrichRunModal
          kind={enrichRun.kind}
          shown={rows}
          selected={selectedRows}
          onClose={() => setEnrichRun(undefined)}
        />
      )}

      {showScore && (
        <ScoreModal
          shown={rows}
          selected={selectedRows}
          onClose={closeScore}
          onShowHigh={() => {
            const cond = {
              id: crypto.randomUUID(),
              kind: 'condition' as const,
              field: 'aiPriority' as const,
              op: 'any_of' as const,
              value: ['High'],
            }
            load({ combinator: 'and', items: [...draft.items, cond] }, viewId)
            setSort('aiScore')
          }}
        />
      )}

      {naming && (
        <NameViewModal
          key={naming}
          open
          title={naming === 'rename' ? 'Rename view' : 'Save as a view'}
          okText={naming === 'rename' ? 'Rename' : 'Save view'}
          initialName={naming === 'rename' ? activeView?.name : ''}
          onCancel={() => setNaming(undefined)}
          onSubmit={naming === 'rename' ? rename : saveNew}
        />
      )}
    </div>
  )
}
