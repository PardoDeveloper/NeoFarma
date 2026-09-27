import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  CornerDownLeft,
  Layers,
  Loader2,
  Moon,
  Package,
  PackagePlus,
  Search,
  ShoppingCart,
  Store,
  Sun,
  Wallet,
} from 'lucide-react'
import { cashApi, catalogApi } from '@/api/endpoints'
import type { Product, Role } from '@/api/types'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import { canSee } from '@/lib/roles'
import { useDebounce } from '@/lib/hooks'
import { useTheme } from '@/lib/theme-context'
import { clp } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Kbd } from '@/components/ui/kbd'
import { useOverlay } from '@/components/ui/overlay'
import { navSections } from './nav'

interface Command {
  id: string
  group: 'Productos' | 'Acciones' | 'Sucursal' | 'Ir a'
  label: string
  hint?: ReactNode
  icon: ComponentType<{ className?: string }>
  keywords?: string
  roles?: Role[]
  run: () => void
  product?: Product
}

/** Quita tildes y pasa a minúsculas para comparar. */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function matches(c: Command, q: string) {
  if (!q) return true
  const hay = norm(`${c.label} ${c.keywords ?? ''}`)
  return norm(q)
    .split(/\s+/)
    .every((w) => hay.includes(w))
}

/**
 * Paleta de comandos (Ctrl+K): saltar a módulos (según rol), acciones rápidas y búsqueda de productos en vivo.
 * Al elegir un producto navega a `/productos?id=<id>`.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <PaletteDialog onClose={onClose} />
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { resolved, toggle } = useTheme()
  const { branches, current, isAll, canUseAll, setBranch } = useBranch()
  const [q, setQ] = useState('')
  const [rawActive, setActive] = useState(0)
  useOverlay(true, onClose, panelRef)

  const term = useDebounce(q.trim(), 200)
  // La búsqueda de productos abre su ficha: solo para quien accede a Productos (el cajero busca desde el POS).
  const canBrowseProducts = canSee(user?.role, ['quimico', 'bodega'])
  const searching = canBrowseProducts && term.length >= 2
  const products = useQuery({
    queryKey: ['palette', 'products', term],
    queryFn: () => catalogApi.products({ q: term, page_size: 6 }),
    enabled: searching,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  // Misma query que el indicador de caja (comparte caché): la acción cambia si ya hay caja abierta.
  const cash = useQuery({
    queryKey: ['cash', 'current'],
    queryFn: cashApi.current,
    enabled: canSee(user?.role, ['quimico', 'cajero']),
  })
  const cashOpen = !!cash.data?.session

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      onClose()
      navigate(to)
    }
    const actions: Command[] = [
      {
        id: 'a-venta',
        group: 'Acciones',
        label: 'Nueva venta',
        icon: ShoppingCart,
        roles: ['quimico', 'cajero'],
        keywords: 'pos vender boleta',
        run: go('/pos'),
      },
      {
        id: 'a-ingreso',
        group: 'Acciones',
        label: 'Nuevo ingreso de mercadería',
        icon: PackagePlus,
        roles: ['quimico', 'bodega'],
        keywords: 'compra recepción factura',
        run: go('/ingresos/nuevo'),
      },
      {
        id: 'a-caja',
        group: 'Acciones',
        label: cashOpen ? 'Ver caja abierta' : 'Abrir caja',
        icon: Wallet,
        roles: ['quimico', 'cajero'],
        keywords: 'apertura cierre turno arqueo abrir caja',
        run: go('/caja'),
      },
      {
        id: 'a-tema',
        group: 'Acciones',
        label: resolved === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
        icon: resolved === 'dark' ? Sun : Moon,
        keywords: 'tema modo oscuro claro apariencia',
        run: () => {
          toggle()
          onClose()
        },
      },
    ]
    // Cambiar de sucursal: una entrada por sucursal accesible (menos la activa) y el consolidado para el admin.
    const switchTo = (v: 'all' | number) => () => {
      onClose()
      setBranch(v)
    }
    const isAdmin = user?.role === 'admin'
    const branchCmds: Command[] = [
      ...(canUseAll && !isAll
        ? [
            {
              id: 'b-all',
              group: 'Sucursal' as const,
              label: 'Ver todas las sucursales',
              hint: 'Consolidado',
              icon: Layers,
              keywords: 'cambiar sucursal consolidado todas local',
              run: switchTo('all'),
            },
          ]
        : []),
      ...branches
        .filter((b) => (isAdmin || b.active) && (isAll || b.id !== current?.id))
        .map((b) => ({
          id: `b-${b.id}`,
          group: 'Sucursal' as const,
          label: `Cambiar a ${b.name}`,
          hint: b.active ? b.code : `${b.code} · inactiva`,
          icon: Store,
          keywords: `cambiar sucursal local ${b.code} ${b.address ?? ''}`,
          run: switchTo(b.id),
        })),
    ]
    const nav: Command[] = navSections.flatMap((s) =>
      s.items.map((it) => ({
        id: `n-${it.to}`,
        group: 'Ir a' as const,
        label: it.label,
        hint: s.title,
        icon: it.icon,
        roles: it.roles,
        keywords: it.keywords,
        run: go(it.to),
      })),
    )
    return [...actions, ...branchCmds, ...nav].filter((c) => canSee(user?.role, c.roles))
  }, [branches, canUseAll, cashOpen, current?.id, isAll, navigate, onClose, resolved, setBranch, toggle, user?.role])

  const productCommands: Command[] = useMemo(
    () =>
      searching
        ? (products.data?.data ?? []).map((p) => ({
            id: `p-${p.id}`,
            group: 'Productos' as const,
            label: p.name,
            icon: Package,
            product: p,
            run: () => {
              onClose()
              navigate(`/productos?id=${p.id}`)
            },
          }))
        : [],
    [navigate, onClose, products.data, searching],
  )

  const items = useMemo(() => {
    const filtered = commands.filter((c) => matches(c, q.trim()))
    // Con texto, los productos primero (es la búsqueda más frecuente); sin texto, acciones y navegación.
    return [...productCommands, ...filtered]
  }, [commands, productCommands, q])

  // Si la lista se acorta (llegan resultados), el índice activo se ajusta al rango.
  const active = items.length ? Math.min(rawActive, items.length - 1) : 0

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(items.length ? (active + 1) % items.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(items.length ? (active - 1 + items.length) % items.length : 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[active]?.run()
    }
  }

  let lastGroup = ''
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="animate-fade-in fixed inset-0 bg-overlay backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        className="animate-pop-in relative flex max-h-[min(560px,76vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          {products.isFetching ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-brand-600 dark:text-brand-400" aria-hidden />
          ) : (
            <Search className="size-5 shrink-0 text-faint" aria-hidden />
          )}
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={canBrowseProducts ? 'Buscar productos, módulos o acciones…' : 'Buscar módulos o acciones…'}
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
            className="h-14 flex-1 bg-transparent text-base text-ink placeholder:text-faint focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" className="flex-1 overflow-y-auto p-2">
          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted">
              {searching && products.isFetching ? (
                'Buscando…'
              ) : (
                <>
                  Sin resultados para <span className="font-medium text-ink">“{q}”</span>
                </>
              )}
            </div>
          )}
          {items.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null
            lastGroup = c.group
            const isActive = i === active
            const p = c.product
            return (
              <div key={c.id}>
                {header && <p className="section-label px-3 pt-2.5 pb-1.5">{header}</p>}
                <div
                  id={`palette-${c.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={isActive}
                  onMouseMove={() => setActive(i)}
                  onClick={() => c.run()}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm',
                    isActive ? 'bg-brand-50 text-ink dark:bg-brand-500/12' : 'text-ink-soft',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg border',
                      isActive
                        ? 'border-brand-200 bg-surface text-brand-600 dark:border-brand-500/30 dark:text-brand-300'
                        : 'border-line bg-subtle text-muted',
                    )}
                  >
                    <c.icon className="size-4" />
                  </span>
                  {p ? (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{p.name}</p>
                        <p className="truncate text-xs text-muted">
                          <span className="font-mono">{p.sku}</span>
                          {p.active_ingredient && <> · {p.active_ingredient}</>}
                          {p.laboratory && <> · {p.laboratory}</>}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold text-ink tabular-nums">{clp(p.price)}</p>
                        <p
                          className={cn(
                            'text-xs tabular-nums',
                            p.stock_sellable <= 0
                              ? 'text-danger-600 dark:text-danger-400'
                              : p.stock_sellable <= p.min_stock
                                ? 'text-warn-700 dark:text-warn-400'
                                : 'text-muted',
                          )}
                        >
                          {p.stock_sellable <= 0 ? 'Sin stock' : `${p.stock_sellable} u.`}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate font-medium">{c.label}</span>
                      {c.hint && <span className="text-xs text-faint">{c.hint}</span>}
                    </>
                  )}
                  {isActive && <ArrowRight className="size-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-line bg-subtle/60 px-4 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navegar
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>
              <CornerDownLeft className="size-3" />
            </Kbd>
            abrir
          </span>
          {canBrowseProducts && <span className="ml-auto hidden sm:inline">Escriba 2+ letras para buscar productos</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
