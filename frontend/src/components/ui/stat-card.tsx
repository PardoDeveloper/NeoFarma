import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Card } from './card'
import { Skeleton } from './skeleton'
import { IconTile, type IconTone } from './icon-tile'

export type StatTone = 'brand' | 'gray' | 'blue' | 'amber' | 'red' | 'violet'

const iconTone: Record<StatTone, IconTone> = { brand: 'brand', gray: 'gray', blue: 'info', amber: 'warn', red: 'danger', violet: 'rx' }

const pct = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 0 })

/** Variación porcentual con ▲/▼ (no depende solo del color). `invert` cuando bajar es bueno. */
export function Delta({ value, invert, className }: { value: number; invert?: boolean; className?: string }) {
  const flat = Math.abs(value) < 0.05
  const up = value > 0
  const good = invert ? !up : up
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
        flat
          ? 'bg-subtle text-muted'
          : good
            ? 'bg-ok-50 text-ok-700 dark:bg-ok-500/15 dark:text-ok-300'
            : 'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-300',
        className,
      )}
    >
      <span aria-hidden className="text-[9px]">
        {flat ? '■' : up ? '▲' : '▼'}
      </span>
      <span className="sr-only">{flat ? 'Sin cambio' : up ? 'Sube' : 'Baja'}</span>
      {pct.format(Math.abs(value))}%
    </span>
  )
}

/**
 * Mini gráfico de línea en SVG liviano (una serie, sin ejes). Decorativo: el valor va en texto al lado.
 * Color por defecto: serie 1 de gráficos (verde marca).
 */
export function Sparkline({
  data,
  width = 112,
  height = 36,
  color = 'var(--chart-1)',
  className,
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}) {
  const gid = 'spk' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = 3
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * (width - pad * 2) + pad,
    height - pad - ((v - min) / span) * (height - pad * 2),
  ])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${height} L${pts[0][0].toFixed(1)},${height} Z`
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('overflow-visible', className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={3} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  )
}

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** Texto secundario bajo el valor. */
  hint?: ReactNode
  icon?: ReactNode
  tone?: StatTone
  /** Variación porcentual vs período anterior (12.5 = +12,5 %). */
  delta?: number | null
  /** Texto junto al delta, p. ej. "vs. ayer". */
  deltaLabel?: ReactNode
  /** Si bajar es bueno (p. ej. mermas), invierte el color del delta. */
  invertDelta?: boolean
  /** Serie para sparkline (≥ 2 puntos). */
  sparkline?: number[]
  loading?: boolean
  className?: string
}

/** KPI: etiqueta, valor protagonista, delta ▲/▼ y sparkline opcional. */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  delta,
  deltaLabel,
  invertDelta,
  sparkline,
  loading,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('flex flex-col gap-3 p-5', className)}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <IconTile size="sm" tone={iconTone[tone]} className="[&_svg]:size-4">
            {icon}
          </IconTile>
        )}
        <p className="truncate text-sm font-medium text-muted">{label}</p>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-32" />
      ) : (
        <p className="truncate text-3xl leading-none font-bold tracking-tight text-ink tabular-nums">{value}</p>
      )}
      {!loading && (delta != null || hint || (sparkline && sparkline.length > 1)) && (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {delta != null && <Delta value={delta} invert={invertDelta} />}
            {deltaLabel && delta != null && <span>{deltaLabel}</span>}
            {hint && <span className="min-w-0">{hint}</span>}
          </div>
          {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} width={88} height={28} className="shrink-0" />}
        </div>
      )}
    </Card>
  )
}

/**
 * Dato compacto dentro de paneles y drawers (precio, costo, margen, efectivo contado): etiqueta de sección + valor.
 * Para KPIs de página usar `StatCard`.
 */
export function MiniStat({
  label,
  value,
  hint,
  tone,
  align = 'start',
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  tone?: 'ok' | 'warn' | 'danger' | 'brand'
  align?: 'start' | 'center'
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-line bg-subtle/60 px-3.5 py-3', align === 'center' && 'text-center', className)}>
      <p className="section-label">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg leading-tight font-semibold text-ink tabular-nums',
          tone === 'ok' && 'text-ok-700 dark:text-ok-400',
          tone === 'warn' && 'text-warn-700 dark:text-warn-400',
          tone === 'danger' && 'text-danger-700 dark:text-danger-400',
          tone === 'brand' && 'text-brand-700 dark:text-brand-300',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}
