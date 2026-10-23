import { Fragment } from 'react'
import { Dropdown, Flex, type MenuProps } from 'antd'
import { DownOutlined } from './icons'

export interface Crumb {
  label: React.ReactNode
  icon?: React.ReactNode
  onClick?: () => void
  /** Turns the crumb into a dropdown, like a table name with rename/delete actions. */
  menu?: MenuProps
}

/** Breadcrumb header with page actions on the right. */
export function TopBar({ crumbs, actions }: { crumbs: Crumb[]; actions?: React.ReactNode }) {
  return (
    <header className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const body = (
            <>
              {c.icon}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
              {c.menu && <DownOutlined style={{ fontSize: 11, opacity: 0.7 }} />}
            </>
          )
          return (
            <Fragment key={i}>
              {i > 0 && <span className="crumb-sep">/</span>}
              {c.menu ? (
                <Dropdown menu={c.menu} trigger={['click']}>
                  <button type="button" className="crumb">
                    {body}
                  </button>
                </Dropdown>
              ) : c.onClick ? (
                <button type="button" className="crumb" onClick={c.onClick}>
                  {body}
                </button>
              ) : (
                <span className="crumb" aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
                  {body}
                </span>
              )}
            </Fragment>
          )
        })}
      </nav>
      {actions && (
        <Flex align="center" gap={8} style={{ flex: 'none' }}>
          {actions}
        </Flex>
      )}
    </header>
  )
}
