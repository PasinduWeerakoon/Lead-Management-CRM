import { Alert, Flex } from 'antd'
import type { PromptIssue } from '../../lib/schemas'

const TYPE = { error: 'error', warning: 'warning', info: 'info' } as const

/** Problems with how a prompt is written, worst first, each with a suggested fix. */
export function IssueList({ issues }: { issues: PromptIssue[] }) {
  const order = { error: 0, warning: 1, info: 2 }
  return (
    <Flex vertical gap={8}>
      {[...issues]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((i, n) => (
          <Alert
            key={n}
            type={TYPE[i.severity]}
            showIcon
            title={i.text}
            description={i.fix ? `Suggestion: ${i.fix}` : undefined}
          />
        ))}
    </Flex>
  )
}
