import { createContext, useContext } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeState {
  /** Preferencia elegida por el usuario. */
  theme: ThemePref
  /** Tema efectivamente aplicado (resuelve `system`). */
  resolved: ResolvedTheme
  setTheme: (t: ThemePref) => void
  /** Alterna claro ↔ oscuro (fija la preferencia explícita). */
  toggle: () => void
}

export const THEME_KEY = 'neofarma.theme'

export const ThemeContext = createContext<ThemeState | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider')
  return ctx
}
