import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import { THEME_KEY, ThemeContext, useTheme, type ResolvedTheme, type ThemePref } from './theme-context'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* almacenamiento no disponible */
  }
  return 'system'
}

// matchMedia puede no existir (jsdom en tests).
const mql = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null)
function subscribeSystem(cb: () => void) {
  const m = mql()
  m?.addEventListener('change', cb)
  return () => m?.removeEventListener('change', cb)
}
const systemDark = () => mql()?.matches ?? false

/** Aplica el tema como clase `.dark` en <html>. El script inline de index.html hace lo mismo antes del primer render. */
function apply(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>(readPref)
  const isSystemDark = useSyncExternalStore(subscribeSystem, systemDark, () => false)
  const resolved: ResolvedTheme = theme === 'system' ? (isSystemDark ? 'dark' : 'light') : theme

  useEffect(() => apply(resolved), [resolved])

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t)
    try {
      localStorage.setItem(THEME_KEY, t)
    } catch {
      /* sin persistencia */
    }
  }, [])

  const toggle = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme])

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Toasts (sonner) siguiendo el tema activo. */
export function ThemedToaster() {
  const { resolved } = useTheme()
  return <Toaster richColors position="top-right" closeButton theme={resolved} toastOptions={{ className: 'font-sans' }} />
}
