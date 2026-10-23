import { describe, expect, it } from 'vitest'
import { resetFilters, useFilters } from '../src/features/filters/store'

describe('filter store', () => {
  it('resetFilters clears conditions and leaves the saved view, so new data shows in full', () => {
    const { load, addCondition } = useFilters.getState()
    load({ combinator: 'and', items: [] }, 'view-1')
    addCondition('seniority')
    expect(useFilters.getState().draft.items).toHaveLength(1)

    resetFilters()
    const s = useFilters.getState()
    expect(s.draft).toEqual({ combinator: 'and', items: [] })
    expect(s.viewId).toBeUndefined()
    expect(s.editingId).toBeUndefined()
  })
})

describe('separate filter stores', () => {
  it('a preset editor store never changes the People page filters', async () => {
    const { createFilterStore } = await import('../src/features/filters/store')
    resetFilters()
    const editor = createFilterStore({
      combinator: 'and',
      items: [{ id: 'a', kind: 'condition', field: 'company', op: 'contains', value: 'bank' }],
    })
    editor.getState().addCondition('seniority')
    expect(editor.getState().draft.items).toHaveLength(2)
    expect(useFilters.getState().draft.items).toHaveLength(0)
  })
})
