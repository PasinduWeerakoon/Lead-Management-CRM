import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Flex, InputNumber, Typography } from 'antd'
import { activeProfileId } from '../../lib/db'
import type { Contact } from '../../lib/schemas'
import { collected, fetchClaims, giveBackClaims, ranges, shareOrder, takeClaims, type Claim } from '../../lib/claims'
import { useAuth } from '../auth/store'

export interface Sharing {
  /** 'shared': claims are kept on the server. 'solo': no shared database, so everything is yours. */
  mode: 'loading' | 'shared' | 'solo'
  /** Connections you hold (collected or not), in the shared order. */
  mine: Contact[]
  /** Yours that still need web data. */
  myOpen: Contact[]
  /** Nobody holds these and they still need web data. */
  free: Contact[]
  /** Everyone else's open work, by person. */
  others: Array<{ by: string; open: number; total: number; openIds: string[] }>
  /** 1-based position of each connection in the shared order. */
  position: Map<string, number>
  error?: string
  take: (count: number) => Promise<Contact[]>
  giveBack: (ids: string[], anyone?: boolean) => Promise<void>
  refresh: () => void
}

/** Who holds which connections in this profile, kept fresh from the server. */
export function useSharing(contacts: Contact[]): Sharing {
  const [claims, setClaims] = useState<Claim[]>()
  const [me, setMe] = useState<string>()
  const [solo, setSolo] = useState(false)
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)

  useEffect(() => {
    let live = true
    fetchClaims(activeProfileId())
      .then((r) => {
        if (!live) return
        setClaims(r.claims)
        setMe(r.me)
        setError(undefined)
      })
      .catch((e: { noDatabase?: boolean; message?: string }) => {
        if (!live) return
        if (e.noDatabase) setSolo(true)
        else setError(e.message ?? 'Couldn’t load who is collecting what.')
      })
    return () => {
      live = false
    }
  }, [tick])

  // Others may be taking connections at the same time: look again every 20 seconds.
  useEffect(() => {
    const t = setInterval(refresh, 20_000)
    return () => clearInterval(t)
  }, [])

  return useMemo(() => {
    const ordered = shareOrder(contacts)
    const position = new Map(ordered.map((c, i) => [c.id, i + 1]))
    if (solo)
      return {
        mode: 'solo' as const,
        mine: ordered,
        myOpen: ordered.filter((c) => !collected(c)),
        free: [],
        others: [],
        position,
        take: async () => [],
        giveBack: async () => {},
        refresh,
      }
    const byId = new Map((claims ?? []).map((c) => [c.id, c.by]))
    const mine = ordered.filter((c) => byId.get(c.id) === me)
    const free = ordered.filter((c) => !byId.has(c.id) && !collected(c))
    const others = new Map<string, { by: string; open: number; total: number; openIds: string[] }>()
    for (const c of ordered) {
      const by = byId.get(c.id)
      if (!by || by === me) continue
      const o = others.get(by) ?? { by, open: 0, total: 0, openIds: [] }
      o.total++
      if (!collected(c)) {
        o.open++
        o.openIds.push(c.id)
      }
      others.set(by, o)
    }
    return {
      mode: claims ? ('shared' as const) : ('loading' as const),
      mine,
      myOpen: mine.filter((c) => !collected(c)),
      free,
      others: [...others.values()].sort((a, b) => a.by.localeCompare(b.by)),
      position,
      error,
      take: async (count) => {
        const { claimed } = await takeClaims(
          activeProfileId(),
          free.map((c) => c.id),
          count,
        )
        refresh()
        const got = new Set(claimed)
        return ordered.filter((c) => got.has(c.id))
      },
      giveBack: async (ids, anyone) => {
        await giveBackClaims(activeProfileId(), ids, anyone)
        refresh()
      },
      refresh,
    }
  }, [contacts, claims, me, solo, error])
}

/**
 * The "share the work" panel: take the next N connections (all that are left by default), carry on
 * with your own, or give unfinished ones back. Nothing starts until you click.
 */
export function ShareWork({ sharing, onStart }: { sharing: Sharing; onStart: (scope: Contact[]) => void }) {
  const { message } = App.useApp()
  const isAdmin = useAuth((s) => s.user?.role === 'super_admin')
  const [amount, setAmount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const { free, mine, myOpen, others, position } = sharing
  const count = Math.min(amount ?? free.length, free.length)
  const at = (list: Contact[]) => ranges(list.map((c) => position.get(c.id) ?? 0))

  const take = async () => {
    setBusy(true)
    try {
      const got = await sharing.take(count)
      if (!got.length) {
        void message.warning('Someone else took those connections just now. Try again.')
        return
      }
      if (got.length < count) void message.info(`Got ${got.length}: others took the rest at the same moment.`)
      onStart([...myOpen, ...got])
    } catch (e) {
      void message.error(e instanceof Error ? e.message : 'Couldn’t take connections.')
    } finally {
      setBusy(false)
    }
  }

  const giveBack = async (ids: string[], anyone = false) => {
    try {
      await sharing.giveBack(ids, anyone)
      void message.success('Given back. Others can take them now.')
    } catch (e) {
      void message.error(e instanceof Error ? e.message : 'Couldn’t give them back.')
    }
  }

  if (sharing.mode === 'loading') return null
  return (
    <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="section-title">Share the work</div>
      {sharing.error && <Alert type="warning" showIcon title={sharing.error} />}
      {sharing.mode === 'solo' ? (
        <Typography.Text type="secondary">
          No shared database, so every connection here is yours. {myOpen.length.toLocaleString()} still need web data.
        </Typography.Text>
      ) : (
        <>
          <Typography.Text type="secondary">
            Connections are numbered in import order. Take a block and collect only those; the next person starts where
            you stop. Nobody else can take connections you hold.
          </Typography.Text>
          <Flex vertical gap={6}>
            <span>
              <b>Yours:</b> {mine.length.toLocaleString()}
              {mine.length ? ` (${at(mine)})` : ''}, {myOpen.length.toLocaleString()} still to collect
            </span>
            {others.map((o) => (
              <Flex key={o.by} gap={8} align="center" wrap>
                <span>
                  <b>{o.by}:</b> {o.total.toLocaleString()}, {o.open.toLocaleString()} still to collect
                </span>
                {isAdmin && o.open > 0 && (
                  <Button size="small" type="link" onClick={() => void giveBack(o.openIds, true)}>
                    Free their unfinished
                  </Button>
                )}
              </Flex>
            ))}
            <span>
              <b>Not taken yet:</b> {free.length.toLocaleString()}
              {free.length ? ` (${at(free)})` : ''}
            </span>
          </Flex>
          <Flex gap={8} align="center" wrap>
            <span>Take</span>
            <InputNumber
              min={1}
              max={Math.max(1, free.length)}
              value={amount ?? free.length}
              onChange={(v) => setAmount(typeof v === 'number' ? v : null)}
              disabled={!free.length}
              style={{ width: 110 }}
            />
            <span>of {free.length.toLocaleString()} left</span>
            <Button type="primary" loading={busy} disabled={!free.length || count < 1} onClick={() => void take()}>
              {count === free.length ? 'Take all and collect' : `Take ${count.toLocaleString()} and collect`}
            </Button>
            {myOpen.length > 0 && (
              <Button onClick={() => onStart(myOpen)}>Collect my {myOpen.length.toLocaleString()} left</Button>
            )}
            {myOpen.length > 0 && (
              <Button type="link" onClick={() => void giveBack(myOpen.map((c) => c.id))}>
                Give back my unfinished
              </Button>
            )}
          </Flex>
        </>
      )}
    </div>
  )
}
