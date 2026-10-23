import { Button, Flex, Typography } from 'antd'
import { CloudUploadOutlined, ExperimentOutlined, UserOutlined } from '../../components/icons'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../../components/TopBar'

const STEPS = [
  {
    title: 'Download your LinkedIn export',
    text: 'On LinkedIn: Settings & Privacy → Data privacy → Download your data → tick Connections (or choose the larger archive) → Request archive.',
  },
  {
    title: 'Import Connections.csv',
    text: 'The file is read in your browser. People are saved to this profile — and to your shared database when one is connected.',
  },
  {
    title: 'Narrow it down',
    text: 'Filter by seniority, function and keywords, save views, and export the leads you want.',
  },
]

/** First-run screen: a plain checklist rather than a splash page. */
export function WelcomeEmpty() {
  const navigate = useNavigate()

  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'People', icon: <UserOutlined /> }]} />
      <div className="screen-body">
        <Flex vertical gap={24} className="fade-in" style={{ maxWidth: 620, margin: '6vh auto 0' }}>
          <Flex vertical gap={6}>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>
              Start with the people you already know
            </span>
            <Typography.Text type="secondary" style={{ fontSize: 15 }}>
              Your LinkedIn connections are the warmest leads you have. Three steps to get them in:
            </Typography.Text>
          </Flex>

          <Flex vertical style={{ border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
            {STEPS.map((s, i) => (
              <Flex
                key={s.title}
                gap={14}
                style={{ padding: '14px 16px', borderTop: i ? '1px solid var(--border-subtle)' : undefined }}
              >
                <span
                  style={{
                    flex: 'none',
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 13,
                    color: 'var(--text-2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {i + 1}
                </span>
                <Flex vertical gap={2}>
                  <span style={{ fontWeight: 500 }}>{s.title}</span>
                  <Typography.Text type="secondary">{s.text}</Typography.Text>
                </Flex>
              </Flex>
            ))}
          </Flex>

          <Flex gap={8}>
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => navigate('/import')}>
              Import connections
            </Button>
            <Button icon={<ExperimentOutlined />} onClick={() => navigate('/import?sample=1')}>
              Try sample data
            </Button>
          </Flex>
        </Flex>
      </div>
    </div>
  )
}
