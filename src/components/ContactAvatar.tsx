import { Avatar } from 'antd'

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Quiet, neutral initials — the person's name carries the meaning, not a colour. */
export function ContactAvatar({ name, size = 30 }: { name: string; company?: string; size?: number }) {
  return (
    <Avatar
      shape="square"
      size={size}
      style={{
        background: 'var(--bg-hover)',
        color: 'var(--text-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: size * 0.36,
        flex: 'none',
      }}
    >
      {initials(name)}
    </Avatar>
  )
}
