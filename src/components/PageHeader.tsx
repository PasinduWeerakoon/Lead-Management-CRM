/** Title block for full pages (settings, setup, import): title, one-line description, optional actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flex: 'none' }}>{actions}</div>}
    </div>
  )
}
