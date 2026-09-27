import { cn } from '@/lib/cn'

/**
 * Número de lote en mono; si el lote no tiene número (`null`) muestra "Sin lote" discreto.
 * `labeled` antepone "Lote " (para textos corridos: "Lote ABC123 · 12 u.").
 */
export function LotCode({ value, labeled, className }: { value: string | null | undefined; labeled?: boolean; className?: string }) {
  if (!value) return <span className={cn('font-sans text-faint', className)}>Sin lote</span>
  const code = <span className={cn('font-mono', className)}>{value}</span>
  return labeled ? <>Lote {code}</> : code
}
