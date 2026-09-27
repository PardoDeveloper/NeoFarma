import { ArrowLeftRight, Banknote, CreditCard, Landmark, Store, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge, type Tone } from './ui/display'
import type { ExpiryStatus, PaymentMethod, SaleCondition } from '@/api/types'
import { paymentLabel, saleConditionLabel } from '@/lib/format'

const conditionTone: Record<SaleCondition, Tone> = {
  directa: 'gray',
  receta_simple: 'rx',
  receta_retenida: 'warn', // exige retener la receta: atención
  receta_cheque: 'red',
}

export function SaleConditionBadge({ value, short }: { value: SaleCondition; short?: boolean }) {
  if (short && value === 'directa') return null
  const label = short
    ? { directa: '', receta_simple: 'Rx', receta_retenida: 'Rx Retenida', receta_cheque: 'Rx Cheque' }[value]
    : saleConditionLabel[value]
  return <Badge tone={conditionTone[value]}>{label}</Badge>
}

const expiryTone: Record<ExpiryStatus, Tone> = { vencido: 'red', critico: 'red', proximo: 'amber', vigente: 'green' }
const expiryText: Record<ExpiryStatus, string> = { vencido: 'Vencido', critico: 'Crítico', proximo: 'Próximo a vencer', vigente: 'Vigente' }

export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  return (
    <Badge tone={expiryTone[status]} dot>
      {expiryText[status]}
    </Badge>
  )
}

export function StockBadge({ stock, min }: { stock: number; min: number }) {
  if (stock <= 0)
    return (
      <Badge tone="red" dot>
        Sin stock
      </Badge>
    )
  if (stock <= min)
    return (
      <Badge tone="amber" dot>
        Stock bajo · <span className="tabular-nums">{stock}</span>
      </Badge>
    )
  return (
    <Badge tone="green" dot>
      <span className="tabular-nums">{stock}</span> u.
    </Badge>
  )
}

// Medio de pago: dato, no estado → badge neutro + icono (el color queda para estados; en gráficos
// cada medio usa su serie fija, ver chart-theme). Iconos iguales a los del cobro.
const payIcon: Record<PaymentMethod, LucideIcon> = {
  efectivo: Banknote,
  debito: CreditCard,
  credito: Landmark,
  transferencia: ArrowLeftRight,
}

export function PaymentBadge({ method }: { method: PaymentMethod }) {
  const Icon = payIcon[method]
  return <Badge icon={<Icon className="size-3 text-muted" aria-hidden />}>{paymentLabel[method]}</Badge>
}

/**
 * Sucursal de un registro, para vistas consolidadas ("Todas las sucursales"): dato, no estado → tono
 * neutro con icono. Se muestra solo cuando la vista mezcla varias sucursales; en una sucursal concreta
 * es ruido (va en el encabezado de la página, no repetido en cada fila).
 */
export function BranchBadge({ name, className }: { name: string; className?: string }) {
  return (
    <Badge tone="gray" icon={<Store className="size-3 text-muted" aria-hidden />} className={className}>
      {name}
    </Badge>
  )
}

/** Cantidad de un movimiento de inventario con signo: +entrada (verde) / −salida (rosa). */
export function MovementQty({ quantity }: { quantity: number }) {
  const positive = quantity > 0
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums',
        positive
          ? 'bg-ok-50 text-ok-700 dark:bg-ok-500/12 dark:text-ok-300'
          : 'bg-danger-50 text-danger-700 dark:bg-danger-500/12 dark:text-danger-300',
      )}
    >
      {positive ? '+' : '−'}
      {Math.abs(quantity)}
    </span>
  )
}
