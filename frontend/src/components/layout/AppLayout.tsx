import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Spinner } from '@/components/ui/display'
import { IconButton } from '@/components/ui/button'
import { useOverlay } from '@/components/ui/overlay'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'

const COLLAPSED_KEY = 'neofarma.sidebar'

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'collapsed'
  } catch {
    return false
  }
}

/** Sidebar como drawer en móvil/tablet (< lg). */
function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(open, onClose, ref)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="animate-fade-in absolute inset-0 bg-overlay" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Menú"
        className="animate-slide-in-left absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-pop"
      >
        <Sidebar onNavigate={onClose} />
        <IconButton label="Cerrar menú" onClick={onClose} size="md" className="absolute top-3.5 right-3">
          <X />
        </IconButton>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const location = useLocation()
  const isPos = location.pathname === '/pos'

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? 'expanded' : 'collapsed')
      } catch {
        /* sin persistencia */
      }
      return !c
    })
  }, [])

  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Ctrl/⌘+K abre la paleta desde cualquier pantalla (también dentro de inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <aside
        className={cn('relative z-20 hidden shrink-0 transition-[width] duration-200 ease-out lg:block', collapsed ? 'w-[72px]' : 'w-64')}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>
      <MobileNav open={mobileOpen} onClose={closeMobile} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <main className={cn('flex-1 overflow-y-auto', isPos ? 'p-3 sm:p-4' : 'p-4 sm:p-6 lg:p-8')}>
          <div className={cn('mx-auto w-full', isPos ? 'h-full' : 'max-w-[1600px]')}>
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  )
}
