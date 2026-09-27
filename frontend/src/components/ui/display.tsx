import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileText, Inbox, Info, Loader2, RotateCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/api/client'
import { Button, IconButton, focusRing } from './button'

export { Card, CardHeader } from './card'
export { StatCard, MiniStat, Sparkline, Delta, type StatCardProps, type StatTone } from './stat-card'
export { IconTile, type IconTone } from './icon-tile'
export { Skeleton, SkeletonRows, SkeletonText } from './skeleton'
export { Kbd } from './kbd'

/* ───────────────────────────── PageHeader ───────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Etiqueta pequeña sobre el título (sección, breadcrumb). */
  eyebrow?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="section-label mb-1.5">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ───────────────────────────── Badge ───────────────────────────── */

const tones = {
  gray: 'bg-subtle text-ink-soft ring-line-strong/70',
  green: 'bg-ok-50 text-ok-700 ring-ok-200 dark:bg-ok-500/12 dark:text-ok-300 dark:ring-ok-500/25',
  red: 'bg-danger-50 text-danger-700 ring-danger-200 dark:bg-danger-500/12 dark:text-danger-300 dark:ring-danger-500/25',
  amber: 'bg-warn-50 text-warn-800 ring-warn-200 dark:bg-warn-500/12 dark:text-warn-300 dark:ring-warn-500/25',
  blue: 'bg-info-50 text-info-700 ring-info-200 dark:bg-info-500/12 dark:text-info-300 dark:ring-info-500/25',
  violet: 'bg-rx-50 text-rx-700 ring-rx-200 dark:bg-rx-500/12 dark:text-rx-300 dark:ring-rx-500/25',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-500/25',
}
const dotTones: Record<keyof typeof tones, string> = {
  gray: 'bg-faint',
  green: 'bg-ok-500',
  red: 'bg-danger-500',
  amber: 'bg-warn-500',
  blue: 'bg-info-500',
  violet: 'bg-rx-500',
  brand: 'bg-brand-500',
}
/** Tonos de Badge. Alias semánticos: ok=green, warn=amber, danger=red, info=blue, rx=violet. */
export type Tone = keyof typeof tones | 'ok' | 'warn' | 'danger' | 'info' | 'rx'
const alias: Record<Tone, keyof typeof tones> = {
  gray: 'gray',
  green: 'green',
  red: 'red',
  amber: 'amber',
  blue: 'blue',
  violet: 'violet',
  brand: 'brand',
  ok: 'green',
  warn: 'amber',
  danger: 'red',
  info: 'blue',
  rx: 'violet',
}

export function Badge({
  tone = 'gray',
  children,
  className,
  dot,
  icon,
  size = 'md',
  title,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
  /** Punto de color a la izquierda (estados). */
  dot?: boolean
  icon?: ReactNode
  size?: 'sm' | 'md'
  title?: string
}) {
  const t = alias[tone]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ring-1 ring-inset',
        size === 'md' ? 'h-[22px] px-2 text-xs' : 'h-[18px] px-1.5 text-[11px]',
        '[&_svg:not([class*=size-])]:size-3',
        tones[t],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', dotTones[t])} aria-hidden />}
      {icon}
      {children}
    </span>
  )
}

/* ───────────────────────────── Callout ───────────────────────────── */

const calloutTones = {
  info: 'bg-info-50 text-info-800 ring-info-200 dark:bg-info-500/10 dark:text-info-200 dark:ring-info-500/25',
  ok: 'bg-ok-50 text-ok-800 ring-ok-200 dark:bg-ok-500/10 dark:text-ok-200 dark:ring-ok-500/25',
  warn: 'bg-warn-50 text-warn-800 ring-warn-200 dark:bg-warn-500/10 dark:text-warn-200 dark:ring-warn-500/25',
  danger: 'bg-danger-50 text-danger-800 ring-danger-200 dark:bg-danger-500/10 dark:text-danger-200 dark:ring-danger-500/25',
  rx: 'bg-rx-50 text-rx-800 ring-rx-200 dark:bg-rx-500/10 dark:text-rx-200 dark:ring-rx-500/25',
}
const calloutIcons = { info: <Info />, ok: <CheckCircle2 />, warn: <AlertTriangle />, danger: <AlertTriangle />, rx: <FileText /> }

/**
 * Aviso en línea (no bloqueante) con icono + texto: nunca solo color.
 * `compact` para una sola línea dentro de barras de filtros.
 */
export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  action,
  compact,
  className,
  role,
}: {
  tone?: keyof typeof calloutTones
  title?: ReactNode
  children?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
  role?: 'alert' | 'status'
}) {
  return (
    <div
      role={role}
      className={cn(
        'flex items-start gap-2.5 rounded-lg text-sm ring-1 ring-inset [&_svg:not([class*=size-])]:size-4',
        compact ? 'px-3 py-2' : 'px-4 py-3',
        calloutTones[tone],
        className,
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon ?? calloutIcons[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5 opacity-90', compact && 'font-medium')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ───────────────────────────── SummaryRow ───────────────────────────── */

/**
 * Fila etiqueta → monto de un resumen (totales de compra, cuadratura, cobro).
 * `strong` para el total final (separador superior y peso). Monto siempre tabular.
 */
export function SummaryRow({
  label,
  value,
  strong,
  className,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4',
        strong ? 'border-t border-line pt-2 text-base font-bold text-ink' : 'text-sm',
        className,
      )}
    >
      <span className={strong ? undefined : 'text-muted'}>{label}</span>
      <span className={cn('tabular-nums', !strong && 'text-ink-soft')}>{value}</span>
    </div>
  )
}

/* ───────────────────────────── Estados ───────────────────────────── */

/** Indicador de carga. Preferir Skeleton para listas y tarjetas. */
export function Spinner({ label = 'Cargando…', className, inline }: { label?: string; className?: string; inline?: boolean }) {
  return (
    <div
      role="status"
      className={cn('flex items-center justify-center gap-2 text-sm text-muted', inline ? 'inline-flex' : 'py-12', className)}
    >
      <Loader2 className="size-4 animate-spin text-brand-600 dark:text-brand-400" aria-hidden /> {label}
    </div>
  )
}

const emptyTones = {
  brand: 'bg-brand-50 text-brand-600 ring-brand-50/60 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-500/5',
  gray: 'bg-subtle text-muted ring-subtle/60',
  amber: 'bg-warn-50 text-warn-600 ring-warn-50/60 dark:bg-warn-500/12 dark:text-warn-300 dark:ring-warn-500/5',
}

export function EmptyState({
  title,
  message,
  action,
  icon,
  tone = 'brand',
  compact,
  className,
}: {
  title: ReactNode
  message?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  tone?: keyof typeof emptyTones
  /** Menos padding (dentro de tarjetas pequeñas). */
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 px-4 py-8' : 'gap-2 px-6 py-14', className)}
    >
      <div
        className={cn(
          'mb-2 flex items-center justify-center rounded-full ring-8 [&_svg:not([class*=size-])]:size-6',
          compact ? 'size-11' : 'size-14',
          emptyTones[tone],
        )}
      >
        {icon ?? <Inbox />}
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {message && <p className="max-w-sm text-sm text-pretty text-muted">{message}</p>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = 'No se pudo cargar la información',
  className,
}: {
  error: unknown
  onRetry?: () => void
  title?: ReactNode
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <div className="mb-2 flex size-14 items-center justify-center rounded-full bg-danger-50 text-danger-600 ring-8 ring-danger-50/60 dark:bg-danger-500/12 dark:text-danger-300 dark:ring-danger-500/5">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <p className="font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3" icon={<RotateCw />}>
          Reintentar
        </Button>
      )}
    </div>
  )
}

/* ───────────────────────────── Pagination ───────────────────────────── */

function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1])
  const out: (number | '…')[] = []
  let last = 0
  for (const p of [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push('…')
    out.push(p)
    last = p
  }
  return out
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  className,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (p: number) => void
  className?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <nav
      aria-label="Paginación"
      className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted', className)}
    >
      <span className="tabular-nums">
        Mostrando{' '}
        <span className="font-medium text-ink">
          {from}–{to}
        </span>{' '}
        de <span className="font-medium text-ink">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft />
        </IconButton>
        <div className="hidden items-center gap-1 sm:flex">
          {pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="w-6 text-center text-faint">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                aria-current={p === page ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-8 rounded-md px-2 text-sm font-medium tabular-nums transition-colors',
                  focusRing,
                  p === page
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-muted hover:bg-subtle hover:text-ink',
                )}
              >
                {p}
              </button>
            ),
          )}
        </div>
        <span className="px-2 tabular-nums sm:hidden">
          {page} / {pages}
        </span>
        <IconButton label="Siguiente" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight />
        </IconButton>
      </div>
    </nav>
  )
}

/* ───────────────────────────── Table ───────────────────────────── */

/**
 * Tabla con cabecera sticky y hover por fila. Para que la cabecera quede fija al hacer scroll vertical,
 * limitar el alto del contenedor: `containerClassName="max-h-[60vh]"`.
 */
export function Table({
  children,
  className,
  containerClassName,
  dense,
}: {
  children: ReactNode
  className?: string
  containerClassName?: string
  /** Filas más bajas (~36px) para listas largas de consulta. */
  dense?: boolean
}) {
  return (
    <div className={cn('overflow-auto', containerClassName)}>
      <table
        className={cn(
          'w-full border-separate border-spacing-0 text-left text-sm text-ink',
          '[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-subtle/60 [&_tbody_tr:last-child>td]:border-b-0',
          dense && '[&_td]:py-2',
          className,
        )}
      >
        {children}
      </table>
    </div>
  )
}

type Align = 'left' | 'right' | 'center'
const alignCls: Record<Align, string> = { left: 'text-left', right: 'text-right', center: 'text-center' }

export function Th({
  children,
  className,
  align,
  numeric,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: Align; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-10 border-b border-line bg-subtle px-4 py-2.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted uppercase',
        (numeric || align) && alignCls[numeric ? 'right' : align!],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  align,
  numeric,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; numeric?: boolean }) {
  return (
    <td
      className={cn(
        'border-b border-line px-4 py-3 align-middle',
        (numeric || align) && alignCls[numeric ? 'right' : align!],
        numeric && 'tabular-nums',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

/** Fila con estados: `interactive` (cursor + foco con Enter), `selected` (resaltada con barra de marca). */
export function Tr({
  children,
  className,
  interactive,
  selected,
  onClick,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  const clickable = interactive || !!onClick
  return (
    <tr
      onClick={onClick}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable && onClick
          ? (e) => {
              if (e.key === 'Enter' && e.target === e.currentTarget) (e.currentTarget as HTMLElement).click()
            }
          : undefined
      }
      aria-selected={selected || undefined}
      className={cn(
        'group/row',
        clickable && 'cursor-pointer focus-visible:bg-subtle focus-visible:outline-none',
        selected && 'bg-brand-50/70 shadow-[inset_3px_0_0_var(--color-brand-500)] dark:bg-brand-500/10',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  )
}

/** Acciones de fila: discretas, visibles al pasar el mouse o al enfocar (siempre visibles en táctil). */
export function RowActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ───────────────────────────── Tabs / Segmented ───────────────────────────── */

export interface SegmentItem<T extends string> {
  value: T
  label: ReactNode
  count?: number
  icon?: ReactNode
  disabled?: boolean
}

function SegmentGroup<T extends string>({
  value,
  onChange,
  items,
  size = 'md',
  className,
  kind,
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  items: SegmentItem<T>[]
  size?: 'sm' | 'md'
  className?: string
  kind: 'tab' | 'radio'
  ariaLabel?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const enabled = items.filter((i) => !i.disabled)
    const idx = enabled.findIndex((i) => i.value === value)
    const next = enabled[(idx + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length]
    if (!next) return
    e.preventDefault()
    onChange(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-active=true]')?.focus())
  }
  return (
    <div
      ref={ref}
      role={kind === 'tab' ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl border border-line bg-subtle p-1', className)}
    >
      {items.map((it) => {
        const active = value === it.value
        return (
          <button
            key={it.value}
            type="button"
            role={kind}
            aria-selected={kind === 'tab' ? active : undefined}
            aria-checked={kind === 'radio' ? active : undefined}
            tabIndex={active ? 0 : -1}
            data-active={active}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 [&_svg:not([class*=size-])]:size-4',
              'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:opacity-40',
              size === 'md' ? 'h-8 px-3 text-sm' : 'h-7 px-2.5 text-xs',
              active
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(16_24_20/0.08),0_0_0_1px_rgb(16_24_20/0.04)] dark:bg-line dark:shadow-none'
                : 'text-muted hover:text-ink',
            )}
          >
            {it.icon}
            {it.label}
            {it.count !== undefined && (
              <span
                className={cn(
                  'min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] font-semibold tabular-nums',
                  active ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300' : 'bg-line/70 text-muted',
                )}
              >
                {it.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Pestañas estilo segmented (cambian el contenido de la vista). Flechas ←/→ para moverse. */
export function Tabs<T extends string>(props: {
  value: T
  onChange: (v: T) => void
  items: SegmentItem<T>[]
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}) {
  return <SegmentGroup {...props} kind="tab" ariaLabel={props['aria-label']} />
}

/** Selector de opción única compacto (filtros, rangos de fecha, modo). */
export function Segmented<T extends string>(props: {
  value: T
  onChange: (v: T) => void
  items: SegmentItem<T>[]
  size?: 'sm' | 'md'
  className?: string
  'aria-label'?: string
}) {
  return <SegmentGroup {...props} kind="radio" ariaLabel={props['aria-label']} />
}
