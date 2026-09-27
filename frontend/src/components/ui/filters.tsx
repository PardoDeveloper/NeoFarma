import type { ReactNode } from 'react'
import { CalendarRange, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { focusRing } from './button'
import { Input, type InputProps } from './form'

/**
 * Barra de filtros en la cabecera de una tarjeta-lista: una fila (envuelve en móvil), todos los controles
 * a la misma altura (h-10). Orden recomendado: búsqueda (flex-1) → rango/segmented → chips → "Limpiar".
 */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2.5 border-b border-line p-4', className)}>{children}</div>
}

/** Buscador de lista: icono de lupa, ocupa el espacio libre y ofrece limpiar (×) cuando hay texto. */
export function SearchField({
  value,
  onValueChange,
  wrapperClassName,
  ...rest
}: Omit<InputProps, 'value' | 'onChange' | 'leftIcon' | 'rightSlot'> & { value: string; onValueChange: (v: string) => void }) {
  return (
    <Input
      type="search"
      leftIcon={<Search />}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && value) {
          e.stopPropagation()
          onValueChange('')
        }
      }}
      rightSlot={
        value ? (
          <button
            type="button"
            onClick={() => onValueChange('')}
            aria-label="Limpiar búsqueda"
            className={cn(
              'pointer-events-auto -mr-1 flex size-6 items-center justify-center rounded-md text-faint hover:bg-subtle hover:text-ink',
              focusRing,
            )}
          >
            <X className="size-3.5" />
          </button>
        ) : undefined
      }
      wrapperClassName={cn('min-w-60 flex-1', wrapperClassName)}
      className="[&::-webkit-search-cancel-button]:appearance-none"
      {...rest}
    />
  )
}

/**
 * Chip de filtro activable (no excluyente entre sí): "Stock bajo", "Inactivos".
 * Para opciones excluyentes usar `Segmented`.
 */
export function FilterChip({
  active,
  onClick,
  icon,
  children,
  className,
}: {
  active: boolean
  onClick: () => void
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors [&_svg:not([class*=size-])]:size-3.5',
        focusRing,
        active
          ? 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300'
          : 'border-line-strong bg-surface text-muted hover:bg-subtle hover:text-ink',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * Rango de fechas compacto en una sola pieza (sin etiquetas encima, para alinear con la barra de filtros).
 * Valores "AAAA-MM-DD". `min`/`max` se encadenan para impedir rangos invertidos.
 */
export function DateRange({
  from,
  to,
  onFromChange,
  onToChange,
  className,
}: {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
  className?: string
}) {
  const field =
    'h-full min-w-0 bg-transparent px-1.5 text-sm text-ink tabular-nums outline-none focus-visible:rounded-md focus-visible:bg-subtle'
  return (
    <div
      role="group"
      aria-label="Rango de fechas"
      className={cn(
        'flex h-10 items-center gap-1 rounded-lg border border-line-strong bg-surface pr-1.5 pl-3 shadow-card transition-[border-color,box-shadow] hover:border-faint/70 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:bg-canvas/40',
        className,
      )}
    >
      <CalendarRange className="size-4 shrink-0 text-faint" aria-hidden />
      <input type="date" aria-label="Desde" value={from} max={to} onChange={(e) => onFromChange(e.target.value)} className={field} />
      <span className="text-faint" aria-hidden>
        –
      </span>
      <input type="date" aria-label="Hasta" value={to} min={from} onChange={(e) => onToChange(e.target.value)} className={field} />
    </div>
  )
}
