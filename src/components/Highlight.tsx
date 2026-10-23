import { theme } from 'antd'

/** Marks the parts of `text` matched by `re`, so people can see why a row passed the filter. */
export function Highlight({ text, re }: { text: string; re?: RegExp }) {
  const { token } = theme.useToken()
  if (!re) return <>{text}</>
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const parts: Array<string | { m: string }> = []
  let last = 0
  for (const match of text.matchAll(global)) {
    const start = match.index ?? 0
    if (match[0].length === 0) continue
    if (start > last) parts.push(text.slice(last, start))
    parts.push({ m: match[0] })
    last = start + match[0].length
  }
  if (parts.length === 0) return <>{text}</>
  if (last < text.length) parts.push(text.slice(last))
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <mark
            key={i}
            style={{ background: token.colorWarningBg, color: 'inherit', padding: '0 2px', borderRadius: 3 }}
          >
            {p.m}
          </mark>
        ),
      )}
    </>
  )
}
