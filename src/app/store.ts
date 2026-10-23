import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_KEY = 'leads.theme'

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // storage blocked (private mode etc.) — fall back to system
  }
  return 'system'
}

interface UiState {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

export const useUi = create<UiState>((set) => ({
  themeMode: readTheme(),
  setThemeMode: (themeMode) => {
    try {
      localStorage.setItem(THEME_KEY, themeMode)
    } catch {
      // non-critical
    }
    set({ themeMode })
  },
}))
