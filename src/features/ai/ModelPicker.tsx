import { Select, Typography } from 'antd'
import { modelById, modelsFor, perM, PROVIDERS, type Provider } from '../../lib/ai/models'
import { readSessionKey } from '../../lib/ai/settings'
import { useAi } from './store'

/**
 * Pick the AI model (and with it the provider) right where you run AI, grouped by provider.
 * Choosing a model from another provider switches provider; keys are kept per provider.
 * Includes models you added in AI settings (by ID or from the provider's full list).
 */
export function ModelPicker({ width = 280 }: { width?: number }) {
  const { settings, setProvider, update } = useAi()
  const hasKey = (p: Provider) => !!readSessionKey(p) || !!settings.keys[p]

  const groups = (Object.keys(PROVIDERS) as Provider[]).map((p) => ({
    label: `${PROVIDERS[p].label}${hasKey(p) ? '' : ' · no key yet'}`,
    options: modelsFor(p).map((m) => ({
      value: m.id,
      searchText: `${m.label} ${m.id}`,
      label: (
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{m.label}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {m.priceKnown === false ? 'price unknown' : `${perM(m.inputPerM)} / ${perM(m.outputPerM)} per M`}
          </Typography.Text>
        </span>
      ),
    })),
  }))

  return (
    <Select
      showSearch={{ optionFilterProp: 'searchText' }}
      value={settings.model}
      onChange={async (id: string) => {
        const model = modelById(id)
        if (model.provider !== settings.provider) await setProvider(model.provider)
        await update({ model: id })
      }}
      options={groups}
      style={{ width }}
      popupMatchSelectWidth={340}
      aria-label="AI model"
      labelRender={({ value }) => {
        const m = modelById(String(value))
        return (
          <span>
            <Typography.Text type="secondary">{PROVIDERS[m.provider].label.split(' ')[0]} · </Typography.Text>
            {m.label}
          </span>
        )
      }}
    />
  )
}
