import { useEffect, useState } from 'react'
import { Alert, Card, Flex, Progress, Typography } from 'antd'
import { ApolloKeyForm } from '../enrich/apolloKey'
import { useAi } from '../ai/store'
import { CORESIGNAL_ONLY } from '../../lib/research/coresignal'

const usd = (n: number) => `$${n.toFixed(2)}`

/**
 * AI runs on 1BT's key, held on the server, so there is no key or model to pick here. This shows
 * today's spend against the daily limit, and the optional Apollo key.
 */
export function LimitsSection() {
  const companyAi = useAi((s) => s.companyAi)
  const [sources, setSources] = useState<{ adzuna: boolean; hunter: boolean }>()
  const [coresignal, setCoresignal] = useState(false)
  useEffect(() => {
    void useAi.getState().refreshCompany()
    void fetch('/api/sources?op=status')
      .then((r) => (r.ok ? r.json() : undefined))
      .then(setSources)
      .catch(() => undefined)
    void fetch('/api/coresignal?op=status')
      .then((r) => (r.ok ? r.json() : undefined))
      .then((r: { configured?: boolean } | undefined) => setCoresignal(!!r?.configured))
      .catch(() => undefined)
  }, [])

  return (
    <>
      <Card title="AI spend today">
        {companyAi ? (
          <Flex vertical gap={10}>
            <Typography.Text>
              <b>{usd(companyAi.spentUsd)}</b> of {usd(companyAi.capUsd)} daily limit
            </Typography.Text>
            <Progress
              percent={Math.min(100, (companyAi.spentUsd / companyAi.capUsd) * 100)}
              showInfo={false}
              size="small"
              status={companyAi.spentUsd >= companyAi.capUsd ? 'exception' : 'normal'}
              style={{ maxWidth: 420 }}
            />
            <Typography.Text type="secondary">
              When the limit is reached, AI work pauses and continues tomorrow. The limit is set on the server.
            </Typography.Text>
          </Flex>
        ) : (
          <Alert type="warning" showIcon title="AI isn’t set up on the server yet (OPENAI_API_KEY)." />
        )}
      </Card>

      <Card title="Coresignal" style={{ marginTop: 16 }}>
        <Flex justify="space-between" gap={12} wrap>
          <span>
            <b style={{ fontWeight: 500 }}>People, companies and job posts</b>
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-3)' }}>
              {CORESIGNAL_ONLY
                ? 'The only data source right now. 20 credits per person or company, 1 per job post (CORESIGNAL_API_KEY).'
                : 'Not used. Turn on with CORESIGNAL_ONLY in the code.'}
            </span>
          </span>
          <Typography.Text type={coresignal ? 'success' : 'secondary'}>
            {coresignal ? 'On' : 'Off · key not set on the server'}
          </Typography.Text>
        </Flex>
      </Card>

      <Card title="Free data sources" style={{ marginTop: 16 }}>
        <Flex vertical gap={8}>
          {[
            // [name, note, key set, used while CORESIGNAL_ONLY]
            ['SEC EDGAR', 'Official facts for US public companies', true, true],
            ['Wikidata', 'Founded, head office, CEO, employees', true, true],
            ['GitHub', 'Public repositories and languages', true, false],
            ['Adzuna', 'US job listings with salaries (ADZUNA_APP_ID, ADZUNA_APP_KEY)', !!sources?.adzuna, false],
            ['Hunter.io', 'Published or verified work emails (HUNTER_API_KEY)', !!sources?.hunter, false],
          ].map(([name, note, on, withCoresignal]) => (
            <Flex key={String(name)} justify="space-between" gap={12} wrap>
              <span>
                <b style={{ fontWeight: 500 }}>{name}</b>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-3)' }}>{note}</span>
              </span>
              <Typography.Text type={on && (!CORESIGNAL_ONLY || withCoresignal) ? 'success' : 'secondary'}>
                {CORESIGNAL_ONLY && !withCoresignal
                  ? 'Off while Coresignal is used'
                  : on
                    ? 'On'
                    : 'Off · key not set on the server'}
              </Typography.Text>
            </Flex>
          ))}
        </Flex>
      </Card>

      <Card title="Apollo (optional)" style={{ marginTop: 16 }}>
        <Flex vertical gap={14}>
          <Typography.Text type="secondary">
            Adds work emails, phone numbers, company head office and technologies. Lookups use your Apollo credits.
          </Typography.Text>
          <ApolloKeyForm />
        </Flex>
      </Card>
    </>
  )
}
