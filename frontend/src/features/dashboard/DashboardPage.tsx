import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ChevronRight,
  Clock,
  DollarSign,
  Package,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { cashApi, reportsApi } from '@/api/endpoints'
import type { CashSession, Dashboard, PaymentMethod, Role } from '@/api/types'
import { useAuth } from '@/lib/auth-context'
import { clp, num, paymentLabel, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useChartTheme } from '@/lib/chart-theme'
import {
  Card,
  CardHeader,
  Delta,
  EmptyState,
  ErrorState,
  IconTile,
  PageHeader,
  Skeleton,
  SkeletonText,
  Sparkline,
  StatCard,
} from '@/components/ui/display'
import { Button } from '@/components/ui/button'
import { ExpiryBadge, StockBadge } from '@/components/badges'
import { expiryStatusFromDays } from '@/lib/expiry'
import { LotCode } from '@/components/LotCode'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

const roleContext: Record<Role, string> = {
  admin: 'Resumen general de la farmacia.',
  quimico: 'Resumen de ventas, inventario y vencimientos.',
  cajero: 'Tu turno de caja y tus ventas de hoy.',
  bodega: 'Stock y vencimientos que necesitan tu atención.',
}

export function DashboardPage() {
  const { user, can } = useAuth()
  const q = useQuery({ queryKey: ['dashboard'], queryFn: reportsApi.dashboard, refetchInterval: 60_000 })
  // Solo quien atiende caja ve "Tu caja"; el admin ve el resumen de inventario (abre caja desde la barra superior).
  const showCash = user?.role === 'quimico' || user?.role === 'cajero'
  const cashQ = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current, enabled: showCash })

  const firstName = user?.full_name.split(' ').find((w) => !w.endsWith('.')) ?? ''

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle={user && roleContext[user.role]}
        actions={
          can('quimico', 'cajero') && (
            <Link to="/pos">
              <Button icon={<ShoppingCart className="size-4" />} kbd="F4">
                Nueva venta
              </Button>
            </Link>
          )
        }
      />

      {q.isLoading ? (
        <DashboardSkeleton showCash={showCash} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DashboardBody
          d={q.data!}
          role={user?.role}
          showCash={showCash}
          cashSession={cashQ.data?.session ?? null}
          cashLoading={cashQ.isLoading}
        />
      )}
    </div>
  )
}

function DashboardSkeleton({ showCash }: { showCash: boolean }) {
  return (
    <div className="animate-fade-in">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-4 p-6 lg:col-span-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-11 w-56" />
          <SkeletonText lines={1} className="w-1/2" />
          <Skeleton className="h-16 w-full" />
        </Card>
        <Card className="flex flex-col gap-4 p-6">
          <Skeleton className="h-3.5 w-24" />
          <SkeletonText lines={3} />
          {showCash && <Skeleton className="h-9 w-full" />}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="flex flex-col gap-3 p-5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="h-96 xl:col-span-2" />
        <Card className="h-96" />
      </div>
    </div>
  )
}

const methodTone: Record<PaymentMethod, number> = { efectivo: 0, debito: 1, credito: 2, transferencia: 3 }

function DashboardBody({
  d,
  role,
  showCash,
  cashSession,
  cashLoading,
}: {
  d: Dashboard
  role?: Role
  showCash: boolean
  cashSession: CashSession | null
  cashLoading: boolean
}) {
  const ct = useChartTheme()
  const methodTotal = Object.values(d.today_by_method).reduce((a, b) => a + b, 0)
  const chart = d.last_14_days.map((p) => ({ ...p, label: p.date.slice(8, 10) + '-' + p.date.slice(5, 7) }))
  const today = d.last_14_days.at(-1)
  const yesterday = d.last_14_days.at(-2)
  const delta = yesterday && yesterday.total > 0 ? ((today!.total - yesterday.total) / yesterday.total) * 100 : null
  const sparkline = d.last_14_days.map((p) => p.total)
  const maxProduct = Math.max(1, ...d.top_products.map((p) => p.total))
  // Bodega ya ve estos tres números en "Foco de hoy": no repetirlos como franjas.
  const hasAlerts = role !== 'bodega' && (d.low_stock_count > 0 || d.expiring_soon_count > 0 || d.expired_count > 0)
  // Cajero: la API solo entrega sus propias ventas (scope "own"); se muestran solo ventas de hoy, su caja,
  // ticket promedio, ventas del mes y medios de pago de hoy.
  const ownOnly = d.scope === 'own'

  const paymentsCard = (
    <Card className={ownOnly ? 'lg:col-span-2' : undefined}>
      <CardHeader title={ownOnly ? 'Tus medios de pago hoy' : 'Medios de pago hoy'} subtitle={clp(methodTotal)} />
      <div className="space-y-4 p-5">
        {(Object.keys(paymentLabel) as PaymentMethod[]).map((m) => {
          const v = d.today_by_method[m] ?? 0
          const pct = methodTotal ? Math.round((v / methodTotal) * 100) : 0
          return (
            <div key={m}>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium text-ink-soft">{paymentLabel[m]}</span>
                <span className="text-muted tabular-nums">
                  {clp(v)} · {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{ width: `${pct}%`, background: ct.series[methodTone[m]] }}
                />
              </div>
            </div>
          )
        })}
        {methodTotal === 0 && <EmptyState compact title="Sin ventas registradas hoy" />}
      </div>
    </Card>
  )

  const ticketCard = (
    <StatCard label="Ticket promedio" value={clp(d.today_avg_ticket)} hint="Hoy" icon={<TrendingUp className="size-5" />} tone="gray" />
  )
  const monthCard = (
    <StatCard
      label="Ventas del mes"
      value={clp(d.month_sales_total)}
      hint={`${num(d.month_sales_count)} ventas`}
      icon={<Receipt className="size-5" />}
      tone="gray"
    />
  )

  return (
    <div className="animate-fade-in flex flex-col">
      {/* Protagonista del día + contexto de rol */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col justify-between gap-5 p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="section-label mb-2">{ownOnly ? 'Tus ventas de hoy' : 'Ventas de hoy'}</p>
              <p className="text-5xl leading-none font-bold tracking-tight text-ink tabular-nums">{clp(d.today_sales_total)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted">
                {delta != null && <Delta value={delta} />}
                {delta != null && <span>vs. ayer</span>}
                <span className="text-faint">·</span>
                <span>{d.today_sales_count} transacciones</span>
                <span className="text-faint">·</span>
                <span>
                  Ticket prom. <span className="font-medium text-ink-soft tabular-nums">{clp(d.today_avg_ticket)}</span>
                </span>
              </div>
            </div>
            <IconTile tone="brand" size="lg">
              <DollarSign />
            </IconTile>
          </div>
          {!ownOnly && sparkline.length > 1 && (
            <div className="h-16 w-full">
              <Sparkline data={sparkline} width={640} height={64} color="var(--chart-1)" className="h-16 w-full" />
            </div>
          )}
        </Card>

        <RoleContextCard role={role} d={d} showCash={showCash} cashSession={cashSession} cashLoading={cashLoading} />
      </div>

      {ownOnly ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4">
            {ticketCard}
            {monthCard}
          </div>
          {paymentsCard}
        </div>
      ) : (
        <>
          {/* KPIs secundarios */}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {ticketCard}
            {monthCard}
            <StatCard
              label="Margen bruto hoy"
              value={clp(d.today_margin)}
              hint={`${d.today_sales_total > 0 ? Math.round((d.today_margin / d.today_sales_total) * 100) : 0}% sobre venta`}
              icon={<Wallet className="size-5" />}
              tone="gray"
            />
          </div>

          {/* Alertas accionables */}
          {hasAlerts && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {d.low_stock_count > 0 && (
                <AlertPill
                  to="/productos?low_stock=true"
                  tone="warn"
                  icon={<Boxes className="size-4" />}
                  text={`${d.low_stock_count} productos con stock bajo`}
                />
              )}
              {d.expiring_soon_count > 0 && (
                <AlertPill
                  to="/inventario?tab=proximos"
                  tone="warn"
                  icon={<CalendarClock className="size-4" />}
                  text={`${d.expiring_soon_count} lotes vencen en 90 días`}
                />
              )}
              {d.expired_count > 0 && (
                <AlertPill
                  to="/inventario?tab=vencidos"
                  tone="danger"
                  icon={<AlertTriangle className="size-4" />}
                  text={`${d.expired_count} lotes vencidos con stock`}
                />
              )}
            </div>
          )}

          {/* Tendencia + medios de pago (para bodega va al final: su trabajo son las listas operativas) */}
          <div className={cn('mt-6 grid gap-6 xl:grid-cols-3', role === 'bodega' && 'order-last')}>
            <Card className="xl:col-span-2">
              <CardHeader title="Ventas últimos 14 días" subtitle="Total diario con IVA" />
              <div className="h-72 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ left: 8, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="gDashSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ct.series[0]} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={ct.series[0]} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...ct.grid} />
                    <XAxis dataKey="label" {...ct.axis} />
                    <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} {...ct.axis} width={48} />
                    <Tooltip {...ct.tooltip} formatter={(v) => [clp(Number(v)), 'Ventas']} labelFormatter={(l) => `Día ${l}`} />
                    <Area type="monotone" dataKey="total" stroke={ct.series[0]} strokeWidth={2.5} fill="url(#gDashSales)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {paymentsCard}
          </div>

          {/* Listas operativas */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Más vendidos" subtitle="Últimos 30 días" />
              {d.top_products.length === 0 ? (
                <EmptyState compact title="Sin ventas aún" />
              ) : (
                <ul className="divide-y divide-line px-5 py-2">
                  {d.top_products.map((p, i) => (
                    <li key={p.product_id} className="flex items-center gap-3 py-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-xs font-bold text-muted">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                          <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{clp(p.total)}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                            <div
                              className="h-full rounded-full bg-brand-500 dark:bg-brand-400"
                              style={{ width: `${Math.round((p.total / maxProduct) * 100)}%` }}
                            />
                          </div>
                          <span className="shrink-0 text-xs text-faint tabular-nums">{p.quantity} u.</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Stock bajo"
                subtitle="Bajo el mínimo definido"
                action={
                  <Link
                    to="/productos?low_stock=true"
                    className="flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    Ver todos <ChevronRight className="size-3" />
                  </Link>
                }
              />
              {d.low_stock.length === 0 ? (
                <EmptyState compact title="Todo en orden" message="Ningún producto bajo el stock mínimo." />
              ) : (
                <ul className="divide-y divide-line px-5 py-2">
                  {d.low_stock.map((p) => (
                    <li key={p.product_id} className="flex items-center gap-3 py-3">
                      <IconTile tone="warn" size="sm">
                        <Boxes />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                        <p className="text-xs text-muted">
                          <span className="font-mono">{p.sku}</span> · mínimo <span className="tabular-nums">{p.min_stock}</span>
                          {p.branch_name && ` · ${p.branch_name}`}
                        </p>
                      </div>
                      <StockBadge stock={p.stock_sellable} min={p.min_stock} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Vencimientos"
                subtitle="Vencidos o dentro de 90 días"
                action={
                  <Link
                    to="/inventario?tab=proximos"
                    className="flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                  >
                    Ver todos <ChevronRight className="size-3" />
                  </Link>
                }
              />
              {d.expiring.length === 0 ? (
                <EmptyState compact title="Sin vencimientos próximos" />
              ) : (
                <ul className="divide-y divide-line px-5 py-2">
                  {d.expiring.map((p) => {
                    const status = expiryStatusFromDays(p.days_to_expiry ?? 0)
                    return (
                      <li key={`${p.product_id}-${p.lot_number ?? 'sl'}-${p.expiry_date ?? ''}`} className="flex items-center gap-3 py-3">
                        <IconTile tone={status === 'vencido' || status === 'critico' ? 'danger' : 'warn'} size="sm">
                          <CalendarClock />
                        </IconTile>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                          <p className="truncate text-xs text-muted">
                            <LotCode value={p.lot_number} labeled /> · <span className="tabular-nums">{p.quantity}</span> u.
                            {p.branch_name && ` · ${p.branch_name}`}
                          </p>
                        </div>
                        <ExpiryBadge status={status} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function RoleContextCard({
  role,
  d,
  showCash,
  cashSession,
  cashLoading,
}: {
  role?: Role
  d: Dashboard
  showCash: boolean
  cashSession: CashSession | null
  cashLoading: boolean
}) {
  if (showCash) {
    return (
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5">
          <IconTile tone="gray">
            <Wallet />
          </IconTile>
          <p className="text-sm font-medium text-muted">Tu caja</p>
        </div>
        {cashLoading ? (
          <SkeletonText lines={2} />
        ) : cashSession ? (
          <>
            <div>
              <p className="text-lg font-semibold text-ink">{cashSession.register_name}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                <Clock className="size-3.5" aria-hidden /> Abierta desde {time(cashSession.opened_at)} · fondo{' '}
                {clp(cashSession.opening_amount)}
              </p>
            </div>
            <Link to="/caja">
              <Button variant="secondary" size="sm" className="w-full">
                Ver caja
              </Button>
            </Link>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">No tienes una caja abierta en este momento.</p>
            <Link to="/caja">
              <Button size="sm" className="w-full">
                Abrir caja
              </Button>
            </Link>
          </>
        )}
      </Card>
    )
  }

  if (role === 'bodega') {
    return (
      <Card className="flex flex-col gap-3 p-6">
        <div className="flex items-center gap-2.5">
          <IconTile tone="warn">
            <Boxes />
          </IconTile>
          <p className="text-sm font-medium text-muted">Foco de hoy</p>
        </div>
        <FocusRow
          to="/productos?low_stock=true"
          label="Stock bajo"
          value={d.low_stock_count}
          icon={<Boxes className="size-4 text-warn-600 dark:text-warn-300" />}
        />
        <FocusRow
          to="/inventario?tab=proximos"
          label="Vencen en 90 días"
          value={d.expiring_soon_count}
          icon={<CalendarClock className="size-4 text-warn-600 dark:text-warn-300" />}
        />
        <FocusRow
          to="/inventario?tab=vencidos"
          label="Vencidos con stock"
          value={d.expired_count}
          icon={<AlertTriangle className="size-4 text-danger-600 dark:text-danger-300" />}
        />
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2.5">
        <IconTile tone="brand">
          <Package />
        </IconTile>
        <p className="text-sm font-medium text-muted">Inventario</p>
      </div>
      <p className="text-2xl font-bold tracking-tight text-ink tabular-nums">{clp(d.inventory_value)}</p>
      <p className="text-xs text-muted">
        {d.active_products} productos activos · {d.open_sessions} caja(s) abierta(s)
      </p>
      <Link to="/productos">
        <Button variant="secondary" size="sm" className="w-full">
          Ver productos
        </Button>
      </Link>
    </Card>
  )
}

function FocusRow({ to, label, value, icon }: { to: string; label: string; value: number; icon: ReactNode }) {
  return (
    <Link to={to} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 -mx-2.5 transition-colors hover:bg-subtle">
      <span className="flex items-center gap-2 text-sm text-ink-soft">
        {icon}
        {label}
      </span>
      <span className="text-sm font-semibold text-ink tabular-nums">{value}</span>
    </Link>
  )
}

function AlertPill({ to, tone, icon, text }: { to: string; tone: 'warn' | 'danger'; icon: ReactNode; text: string }) {
  const cls =
    tone === 'danger'
      ? 'bg-danger-50 text-danger-700 ring-danger-200 hover:bg-danger-100 dark:bg-danger-500/12 dark:text-danger-300 dark:ring-danger-500/25 dark:hover:bg-danger-500/20'
      : 'bg-warn-50 text-warn-800 ring-warn-200 hover:bg-warn-100 dark:bg-warn-500/12 dark:text-warn-300 dark:ring-warn-500/25 dark:hover:bg-warn-500/20'
  return (
    <Link to={to} className={cn('flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ring-1 transition-colors', cls)}>
      {icon}
      {text}
      <ChevronRight className="ml-auto size-3.5 opacity-60" aria-hidden />
    </Link>
  )
}
