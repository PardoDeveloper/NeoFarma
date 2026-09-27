import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Skeleton } from './skeleton'

/**
 * Lista apilada para móvil (< md) que reemplaza a la tabla: `<Table>` va en `hidden md:block`
 * y la misma data se pinta con `MobileList` + `MobileListItem`.
 */
export function MobileList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-line md:hidden', className)}>{children}</div>
}

/**
 * Fila de lista móvil: contenido principal a la izquierda y valor (monto/stock) a la derecha.
 * Con `onClick` es un botón (abre el detalle); `dimmed` para registros inactivos o anulados.
 */
export function MobileListItem({
  children,
  aside,
  onClick,
  selected,
  dimmed,
  className,
}: {
  children: ReactNode
  /** Columna derecha alineada al final (monto, stock). */
  aside?: ReactNode
  onClick?: () => void
  selected?: boolean
  dimmed?: boolean
  className?: string
}) {
  const cls = cn(
    'flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left',
    onClick && 'transition-colors hover:bg-subtle/60 focus-visible:bg-subtle focus-visible:outline-none',
    selected && 'bg-brand-50/70 shadow-[inset_3px_0_0_var(--color-brand-500)] dark:bg-brand-500/10',
    dimmed && 'opacity-60',
    className,
  )
  const body = (
    <>
      <div className="min-w-0 flex-1">{children}</div>
      {aside && <div className="shrink-0 text-right">{aside}</div>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Filas de carga para `MobileList`. */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <MobileList className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-start justify-between gap-3 px-4 py-3.5">
          <div className="flex-1 space-y-2">
            <Skeleton className={cn('h-3.5', i % 2 ? 'w-1/2' : 'w-2/3')} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </MobileList>
  )
}
