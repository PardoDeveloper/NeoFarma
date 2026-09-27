import { cn } from '@/lib/cn'

/** Bloque de carga. Dar tamaño con className: `<Skeleton className="h-4 w-32" />`. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-shimmer rounded-md bg-subtle dark:bg-line/70', className)} />
}

// Anchos variados para que las filas no se vean como una grilla rígida.
const widths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12', 'w-4/5', 'w-1/3']

/**
 * Filas de carga para usar DENTRO de `<tbody>` mientras se carga una tabla.
 * `cols` = número de columnas; `numeric` = índices de columnas numéricas (alineadas a la derecha).
 */
export function SkeletonRows({ rows = 6, cols = 4, numeric = [] }: { rows?: number; cols?: number; numeric?: number[] }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden className="border-b border-line last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-3.5">
              <Skeleton className={cn('h-3.5', numeric.includes(c) ? 'ml-auto w-16' : widths[(r + c * 2) % widths.length])} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/** Líneas de texto de carga (tarjetas, paneles). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/5' : widths[i % widths.length])} />
      ))}
    </div>
  )
}
