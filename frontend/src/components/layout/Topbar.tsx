import { useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, LogOut, Menu, Monitor, Moon, Search, Sun, Wallet } from 'lucide-react'
import { cashApi } from '@/api/endpoints'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import { useTheme, type ThemePref } from '@/lib/theme-context'
import { clp, roleLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { IconButton, focusRing } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useDismiss } from '@/components/ui/overlay'
import { canSee } from '@/lib/roles'
import { initials } from './nav'
import { BranchSwitcher } from './BranchSwitcher'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Botón que parece un buscador y abre la paleta de comandos. */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const { user } = useAuth()
  const withProducts = canSee(user?.role, ['quimico', 'bodega'])
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Buscar (Ctrl+K)"
      className={cn(
        'group flex h-10 w-10 shrink-0 items-center justify-center gap-2.5 rounded-lg border border-line bg-subtle/70 text-sm text-faint transition-colors',
        'sm:w-full sm:max-w-md sm:shrink sm:justify-start sm:pr-2 sm:pl-3',
        'hover:border-line-strong hover:bg-surface hover:text-muted',
        focusRing,
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="hidden flex-1 truncate text-left sm:block">
        <span className="hidden xl:inline">{withProducts ? 'Buscar productos, módulos o acciones…' : 'Buscar módulos o acciones…'}</span>
        <span className="xl:hidden">Buscar…</span>
      </span>
      <Kbd className="hidden sm:inline-flex">{isMac ? '⌘ K' : 'Ctrl K'}</Kbd>
    </button>
  )
}

/** Estado de caja siempre visible (cajero/químico). En "Todas las sucursales" no aplica (no se opera en consolidado). */
export function CashIndicator() {
  const { can } = useAuth()
  const { isAll } = useBranch()
  const enabled = can('quimico', 'cajero') && !isAll
  const { data, isLoading } = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current, enabled, refetchInterval: 60_000 })
  if (!enabled || isLoading) return null
  const s = data?.session
  return (
    <NavLink
      to="/caja"
      title={s ? `${s.register_name} abierta` : 'Sin caja abierta'}
      className={cn(
        'group flex h-10 shrink-0 items-center gap-2.5 rounded-lg border px-2.5 text-sm transition-colors sm:px-3',
        focusRing,
        s
          ? 'border-ok-200 bg-ok-50/70 hover:bg-ok-50 dark:border-ok-500/25 dark:bg-ok-500/10 dark:hover:bg-ok-500/15'
          : 'border-warn-200 bg-warn-50/80 hover:bg-warn-50 dark:border-warn-500/25 dark:bg-warn-500/10 dark:hover:bg-warn-500/15',
      )}
    >
      <span className="relative flex size-2.5 shrink-0" aria-hidden>
        {s && <span className="absolute inset-0 animate-ping rounded-full bg-ok-500 opacity-50 [animation-duration:2.4s]" />}
        <span className={cn('relative size-2.5 rounded-full', s ? 'bg-ok-500' : 'bg-warn-500')} />
      </span>
      {s ? (
        <span className="flex items-center gap-2">
          <span className="hidden font-semibold text-ok-800 md:inline dark:text-ok-300">{s.register_name}</span>
          <span className="hidden h-4 w-px bg-ok-200 md:inline dark:bg-ok-500/30" aria-hidden />
          <span className="font-semibold text-ok-800 tabular-nums dark:text-ok-300">
            <span className="sr-only">Caja abierta, vendido </span>
            {clp(s.summary?.sales_total)}
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 font-semibold text-warn-800 dark:text-warn-300">
          <Wallet className="size-4 sm:hidden" aria-hidden />
          <span className="hidden sm:inline">Caja cerrada</span>
          <span className="hidden font-medium text-warn-700 underline-offset-2 group-hover:underline lg:inline dark:text-warn-400">
            · Abrir
          </span>
        </span>
      )}
    </NavLink>
  )
}

export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  return (
    <IconButton
      label={resolved === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      size="lg"
      onClick={toggle}
      className="hidden sm:inline-flex"
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </IconButton>
  )
}

const themeOptions: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
]

/** Chip de usuario con menú (perfil y apariencia). */
export function UserMenu() {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useDismiss(open, () => setOpen(false), ref, triggerRef)

  if (!user) return null
  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de usuario"
        className={cn('flex h-10 items-center gap-2.5 rounded-lg pr-1.5 pl-1 transition-colors hover:bg-subtle sm:pr-2', focusRing)}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800 ring-2 ring-surface dark:bg-brand-500/20 dark:text-brand-200">
          {initials(user.full_name)}
        </span>
        <span className="hidden min-w-0 text-left lg:block">
          <span className="block max-w-40 truncate text-sm leading-tight font-semibold text-ink">{user.full_name}</span>
          <span className="block text-xs leading-tight text-muted">{roleLabel[user.role]}</span>
        </span>
        <ChevronDown className={cn('hidden size-4 text-faint transition-transform sm:block', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="animate-pop-in absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{user.full_name}</p>
            <p className="truncate text-xs text-muted">
              <span className="font-mono">@{user.username}</span> · {roleLabel[user.role]}
            </p>
          </div>
          <div className="p-1.5">
            <p className="section-label px-2.5 pt-1.5 pb-1">Apariencia</p>
            {themeOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === o.value}
                onClick={() => setTheme(o.value)}
                className={cn(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors hover:bg-subtle',
                  focusRing,
                  theme === o.value ? 'font-medium text-ink' : 'text-muted',
                )}
              >
                <o.icon className="size-4" aria-hidden />
                <span className="flex-1 text-left">{o.label}</span>
                {theme === o.value && <Check className="size-4 text-brand-600 dark:text-brand-400" aria-hidden />}
              </button>
            ))}
          </div>
          {/* En móvil el botón de salir de la barra se oculta para dar espacio a la sucursal. */}
          <div className="border-t border-line p-1.5 sm:hidden">
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              className={cn(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-danger-700 transition-colors hover:bg-danger-50 dark:text-danger-300 dark:hover:bg-danger-500/10',
                focusRing,
              )}
            >
              <LogOut className="size-4" aria-hidden />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Topbar({ onOpenMenu, onOpenPalette }: { onOpenMenu: () => void; onOpenPalette: () => void }) {
  const { logout } = useAuth()
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
      <IconButton label="Abrir menú" size="lg" onClick={onOpenMenu} className="shrink-0 lg:hidden">
        <Menu />
      </IconButton>
      <BranchSwitcher className="flex-1 sm:flex-none" />
      <div className="flex min-w-0 items-center sm:flex-1">
        <SearchTrigger onOpen={onOpenPalette} />
      </div>
      <CashIndicator />
      <div className="hidden h-6 w-px bg-line sm:block" aria-hidden />
      <ThemeToggle />
      <UserMenu />
      <IconButton label="Cerrar sesión" size="lg" onClick={logout} variant="danger" className="hidden sm:inline-flex">
        <LogOut />
      </IconButton>
    </header>
  )
}
