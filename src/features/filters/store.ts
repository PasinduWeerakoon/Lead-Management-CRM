import { createContext, useContext } from 'react'
import { create, createStore, useStore, type StateCreator, type StoreApi } from 'zustand'
import { FIELD_BY_KEY } from '../../lib/filters/fields'
import { emptyFilter, type Combinator, type Condition, type FieldKey, type FilterGroup } from '../../lib/filters/schema'

export interface FilterState {
  /** The filter on screen. It may differ from the saved view until the user saves. */
  draft: FilterGroup
  /** Saved view the draft was loaded from, or undefined for "All connections". */
  viewId?: string
  /** Condition whose editor popover is open. */
  editingId?: string

  load: (filter: FilterGroup, viewId?: string) => void
  setEditing: (id?: string) => void
  addCondition: (field: FieldKey, groupId?: string) => void
  updateCondition: (id: string, patch: Partial<Condition>) => void
  removeItem: (id: string) => void
  addGroup: () => void
  setCombinator: (combinator: Combinator, groupId?: string) => void
  clear: () => void
}

const newCondition = (field: FieldKey): Condition => ({
  id: crypto.randomUUID(),
  kind: 'condition',
  field,
  op: FIELD_BY_KEY[field].ops[0],
  value:
    FIELD_BY_KEY[field].type === 'enum' ||
    FIELD_BY_KEY[field].type === 'list' ||
    FIELD_BY_KEY[field].type === 'keywords'
      ? []
      : undefined,
})

const mapConditions = (f: FilterGroup, fn: (c: Condition) => Condition): FilterGroup => ({
  ...f,
  items: f.items.map((i) => (i.kind === 'group' ? { ...i, conditions: i.conditions.map(fn) } : fn(i))),
})

const filterState: StateCreator<FilterState> = (set) => ({
  draft: emptyFilter(),
  viewId: undefined,
  editingId: undefined,

  load: (filter, viewId) => set({ draft: structuredClone(filter), viewId, editingId: undefined }),

  setEditing: (editingId) => set({ editingId }),

  addCondition: (field, groupId) =>
    set((s) => {
      const cond = newCondition(field)
      const items = groupId
        ? s.draft.items.map((i) =>
            i.kind === 'group' && i.id === groupId ? { ...i, conditions: [...i.conditions, cond] } : i,
          )
        : [...s.draft.items, cond]
      return { draft: { ...s.draft, items }, editingId: cond.id }
    }),

  updateCondition: (id, patch) =>
    set((s) => ({ draft: mapConditions(s.draft, (c) => (c.id === id ? { ...c, ...patch } : c)) })),

  removeItem: (id) =>
    set((s) => ({
      draft: {
        ...s.draft,
        items: s.draft.items
          .filter((i) => i.id !== id)
          .map((i) => (i.kind === 'group' ? { ...i, conditions: i.conditions.filter((c) => c.id !== id) } : i))
          // A group whose last condition was removed disappears too.
          .filter((i) => i.kind !== 'group' || i.conditions.length > 0),
      },
      editingId: s.editingId === id ? undefined : s.editingId,
    })),

  addGroup: () =>
    set((s) => {
      // A new group starts with one condition so it is never empty, and flips the combinator
      // ("A and (B or C)") because that is almost always why people add a group.
      const cond = newCondition('seniority')
      const group = {
        id: crypto.randomUUID(),
        kind: 'group' as const,
        combinator: (s.draft.combinator === 'and' ? 'or' : 'and') as Combinator,
        conditions: [cond],
      }
      return { draft: { ...s.draft, items: [...s.draft.items, group] }, editingId: cond.id }
    }),

  setCombinator: (combinator, groupId) =>
    set((s) => ({
      draft: groupId
        ? {
            ...s.draft,
            items: s.draft.items.map((i) => (i.kind === 'group' && i.id === groupId ? { ...i, combinator } : i)),
          }
        : { ...s.draft, combinator },
    })),

  clear: () => set((s) => ({ draft: emptyFilter(), editingId: undefined, viewId: s.viewId })),
})

/** The People page's filters. */
export const useFilters = create<FilterState>()(filterState)

/** A separate filter state, e.g. for building a preset without touching the People page. */
export function createFilterStore(initial?: FilterGroup): StoreApi<FilterState> {
  const store = createStore<FilterState>()(filterState)
  if (initial) store.getState().load(initial)
  return store
}

/** Which filter state the filter builder edits. Defaults to the People page's. */
export const FilterStoreContext = createContext<StoreApi<FilterState>>(useFilters)

/** Filter state for the builder components: the nearest FilterStoreContext. */
export function useFilterStore(): FilterState {
  return useStore(useContext(FilterStoreContext))
}

/** Structural comparison that ignores key order, used to show "unsaved changes". */
export function sameFilter(a: FilterGroup, b: FilterGroup): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Clears filters and leaves any saved view, e.g. after the underlying data was replaced. */
export function resetFilters() {
  useFilters.getState().load(emptyFilter(), undefined)
}
