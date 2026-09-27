import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Contenedor base: `rounded-2xl bg-surface border-line shadow-card`. Acepta props nativas de div. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

/** Cabecera de tarjeta: título (text-base semibold), subtítulo, icono y acción a la derecha. */
export function CardHeader({
  title,
  subtitle,
  action,
  icon,
  bordered = true,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  /** Icono pequeño antes del título. */
  icon?: ReactNode
  /** Divisor inferior (por defecto sí). */
  bordered?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-5 py-4', bordered && 'border-b border-line', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="flex shrink-0 text-muted [&_svg:not([class*=size-])]:size-[18px]">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-base leading-tight font-semibold tracking-tight text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
