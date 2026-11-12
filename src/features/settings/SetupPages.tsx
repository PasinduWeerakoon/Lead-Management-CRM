import { BulbOutlined, TagsOutlined } from '../../components/icons'
import { TopBar } from '../../components/TopBar'
import { LimitsSection } from './LimitsSection'
import { KeywordPacksSection } from './KeywordPacksSection'

export function AiPage() {
  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Settings' }, { label: 'AI limit and Apollo', icon: <BulbOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow">
          <LimitsSection />
        </div>
      </div>
    </div>
  )
}

export function KeywordPacksPage() {
  return (
    <div className="screen">
      <TopBar crumbs={[{ label: 'Setup' }, { label: 'Keyword packs', icon: <TagsOutlined /> }]} />
      <div className="screen-body">
        <div className="screen-narrow">
          <KeywordPacksSection />
        </div>
      </div>
    </div>
  )
}
