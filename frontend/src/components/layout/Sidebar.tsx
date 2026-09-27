import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/lib/auth-context'
import { canSee } from '@/lib/roles'
import { focusRing } from '@/components/ui/button'
import { navSections } from './nav'

/** Marca. `inverse` sobre fondos de marca oscuros (panel del login). */
export function Logo({ collapsed, inverse }: { collapsed?: boolean; inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_6px_-1px_rgb(11_83_60/0.45)]">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
          <path d="M9.5 3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6h6a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-6v6a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-6h-6a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6z" />
        </svg>
      </div>
      {!collapsed && (
        <div className="min-w-0">
          <p className={cn('text-[15px] leading-tight font-bold tracking-tight', inverse ? 'text-white' : 'text-ink')}>NeoFarma</p>
          <p className={cn('text-[11px] leading-tight', inverse ? 'text-brand-200/80' : 'text-faint')}>Gestión de farmacia</p>
        </div>
      )}
    </div>
  )
}

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed?: boolean
  /** Si se omite, no se muestra el botón de contraer (drawer móvil). */
  onToggleCollapsed?: () => void
  onNavigate?: () => void
}) {
  const { user } = useAuth()
  return (
    <nav aria-label="Navegación principal" className="flex h-full flex-col border-r border-line bg-surface">
      <div className={cn('flex h-16 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Logo collapsed={collapsed} />
      </div>

      <div className={cn('flex-1 space-y-5 px-3 pt-2 pb-4', collapsed ? 'overflow-visible' : 'overflow-x-hidden overflow-y-auto')}>
        {navSections.map((sec) => {
          const items = sec.items.filter((i) => canSee(user?.role, i.roles))
          if (!items.length) return null
          return (
            <div key={sec.title}>
              {collapsed ? (
                <div className="mx-auto mb-2 h-px w-6 bg-line first:hidden" aria-hidden />
              ) : (
                <p className="section-label mb-1.5 px-3">{sec.title}</p>
              )}
              <ul className="space-y-0.5">
                {items.map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.to === '/'}
                      onClick={onNavigate}
                      aria-label={collapsed ? it.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors',
                          collapsed ? 'justify-center px-0' : 'px-3',
                          focusRing,
                          isActive
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/12 dark:text-brand-300'
                            : 'text-muted hover:bg-subtle hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-brand-500" aria-hidden />}
                          <it.icon className={cn('size-[18px] shrink-0', isActive ? '' : 'text-faint group-hover:text-muted')} />
                          {!collapsed && <span className="truncate">{it.label}</span>}
                          {collapsed && (
                            <span
                              role="tooltip"
                              className="pointer-events-none absolute left-full z-50 ml-3 rounded-md bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-canvas opacity-0 shadow-pop transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                            >
                              {it.label}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <div
        className={cn('flex shrink-0 items-center border-t border-line py-3', collapsed ? 'justify-center px-2' : 'justify-between px-4')}
      >
        {!collapsed && <span className="text-[11px] text-faint">v0.1 · Uso interno</span>}
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
            title={collapsed ? 'Expandir menú' : 'Contraer menú'}
            className={cn(
              'flex size-8 items-center justify-center rounded-md text-faint transition-colors hover:bg-subtle hover:text-ink',
              focusRing,
            )}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        )}
      </div>
    </nav>
  )
}
