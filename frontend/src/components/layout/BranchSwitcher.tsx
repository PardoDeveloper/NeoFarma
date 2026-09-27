import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, Layers, Settings2, Store } from 'lucide-react'
import type { Branch } from '@/api/types'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import { cn } from '@/lib/cn'
import { focusRing } from '@/components/ui/button'
import { useDismiss } from '@/components/ui/overlay'

/** Cuadro del icono de sucursal: tienda (sucursal concreta) o capas (consolidado, solo lectura). */
function BranchGlyph({ all, inactive, className }: { all?: boolean; inactive?: boolean; className?: string }) {
  const Icon = all ? Layers : Store
  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
        all
          ? 'bg-info-50 text-info-700 dark:bg-info-500/15 dark:text-info-300'
          : inactive
            ? 'bg-subtle text-faint'
            : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
        className,
      )}
      aria-hidden
    >
      <Icon />
    </span>
  )
}

/**
 * Texto del disparador: etiqueta pequeña + nombre. En móvil (< sm) se muestra el código (MATRIZ, CENTRO…),
 * más corto y reconocible que un nombre truncado ("Sucursal C…").
 */
function TriggerText({ label, name, code }: { label: string; name: string; code: string }) {
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="hidden truncate text-[10px] leading-tight font-semibold tracking-wider text-faint uppercase sm:block">{label}</span>
      <span className="hidden truncate text-sm leading-tight font-semibold text-ink sm:block">{name}</span>
      <span className="truncate font-mono text-[13px] font-semibold tracking-wide text-ink sm:hidden" aria-hidden>
        {code}
      </span>
      <span className="sr-only sm:hidden">{name}</span>
    </span>
  )
}

/** Opción del menú (radio): contenido + check a la derecha si es la sucursal activa. */
function MenuOption({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
        'hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none',
        checked && 'bg-brand-50/70 hover:bg-brand-50 focus-visible:bg-brand-50 dark:bg-brand-500/10 dark:hover:bg-brand-500/15',
      )}
    >
      {children}
      <Check className={cn('size-4 shrink-0 text-brand-600 dark:text-brand-400', !checked && 'invisible')} aria-hidden />
    </button>
  )
}

const triggerBase = 'flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-line bg-surface pr-2.5 pl-1.5 dark:bg-canvas/40'

/**
 * Selector de sucursal activa (Topbar). Siempre visible:
 * - una sola sucursal → etiqueta fija (sin menú);
 * - varias → menú con sus sucursales; admin con >1 agrega "Todas las sucursales (consolidado)".
 * Cambiar llama a `setBranch`, que vacía la caché y remonta la app con la nueva sucursal.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { user } = useAuth()
  const { branches, current, isAll, canUseAll, setBranch } = useBranch()
  const isAdmin = user?.role === 'admin'
  // El admin ve también las inactivas (puede consultarlas); el resto solo recibe sus sucursales activas.
  const options = isAdmin ? branches : branches.filter((b) => b.active)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])
  useDismiss(open, () => setOpen(false), rootRef, triggerRef)

  const name = isAll ? 'Todas las sucursales' : (current?.name ?? 'Sucursal')
  const label = isAll ? 'Consolidado' : 'Sucursal'
  const code = isAll ? 'TODAS' : (current?.code ?? '—')

  if (options.length <= 1 && !canUseAll) {
    return (
      <div className={cn(triggerBase, 'max-w-60', className)} title={current ? `Sucursal: ${current.name}` : undefined}>
        <BranchGlyph />
        <TriggerText label="Sucursal" name={name} code={code} />
      </div>
    )
  }

  const choose = (v: 'all' | number) => {
    setOpen(false)
    triggerRef.current?.focus()
    setBranch(v)
  }

  const openMenu = () => {
    setOpen(true)
    // Foco en la opción marcada (o la primera) para seguir con flechas.
    requestAnimationFrame(() => {
      const items = menuItems()
      ;(items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
    })
  }

  const onMenuKey = (e: KeyboardEvent) => {
    const items = menuItems()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => {
      e.preventDefault()
      items[(to + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Tab') setOpen(false)
  }

  const branchRow = (b: Branch) => (
    <MenuOption key={b.id} checked={!isAll && current?.id === b.id} onSelect={() => choose(b.id)}>
      <BranchGlyph inactive={!b.active} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn('truncate font-medium', b.active ? 'text-ink' : 'text-muted')}>{b.name}</span>
          {!b.active && (
            <span className="shrink-0 rounded-md bg-subtle px-1.5 py-px text-[11px] font-medium text-muted ring-1 ring-line-strong/70 ring-inset">
              Inactiva
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted">
          <span className="font-mono">{b.code}</span>
          {b.address && <> · {b.address}</>}
        </span>
      </span>
    </MenuOption>
  )

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault()
            openMenu()
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Sucursal activa: ${name}. Cambiar de sucursal`}
        className={cn(
          triggerBase,
          'w-full max-w-64 transition-colors sm:w-60 hover:border-line-strong hover:bg-subtle',
          isAll && 'border-info-200 dark:border-info-500/30',
          open && 'border-line-strong bg-subtle',
          focusRing,
        )}
      >
        <BranchGlyph all={isAll} inactive={!isAll && current?.active === false} />
        <TriggerText label={label} name={name} code={code} />
        <ChevronDown className={cn('ml-auto size-4 shrink-0 text-faint transition-transform', open && 'rotate-180')} aria-hidden />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Cambiar de sucursal"
          onKeyDown={onMenuKey}
          className={cn(
            'animate-pop-in z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-pop',
            'fixed inset-x-3 top-[68px] sm:absolute sm:inset-x-auto sm:top-full sm:left-0 sm:mt-2 sm:w-80',
          )}
        >
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Cambiar de sucursal</p>
            <p className="text-xs text-muted">Stock, caja y ventas se muestran solo de la sucursal elegida.</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {canUseAll && (
              <>
                <MenuOption checked={isAll} onSelect={() => choose('all')}>
                  <BranchGlyph all />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">Todas las sucursales</span>
                    <span className="block truncate text-xs text-muted">Consolidado · solo lectura</span>
                  </span>
                </MenuOption>
                <div className="mx-2.5 my-1.5 h-px bg-line" aria-hidden />
              </>
            )}
            {options.map(branchRow)}
          </div>
          {isAdmin && (
            <div className="border-t border-line bg-subtle/60 p-1.5">
              <Link
                role="menuitem"
                to="/sucursales"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted transition-colors hover:bg-surface hover:text-ink',
                  focusRing,
                )}
              >
                <Settings2 className="size-4" aria-hidden />
                Administrar sucursales y cajas
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
