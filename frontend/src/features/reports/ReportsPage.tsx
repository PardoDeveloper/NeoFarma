import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, DollarSign, Percent, Receipt, TrendingUp } from 'lucide-react'
import { reportsApi } from '@/api/endpoints'
import type { PaymentMethod, SalesReport } from '@/api/types'
import { addDays, clp, date, isoDate, num, paymentLabel } from '@/lib/format'
import { useChartTheme } from '@/lib/chart-theme'
import { Button } from '@/components/ui/button'
import { DateRange, FilterBar } from '@/components/ui/filters'
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  Skeleton,
  SkeletonText,
  StatCard,
  Table,
  Td,
  Th,
  Tr,
  type SegmentItem,
} from '@/components/ui/display'

type Preset = 'hoy' | '7d' | '30d' | '90d' | 'custom'

const presetItems: SegmentItem<Preset>[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: '90d', label: '90 días' },
]

const methodOrder: PaymentMethod[] = ['efectivo', 'debito', 'credito', 'transferencia']

export function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -29)))
  const [to, setTo] = useState(isoDate())
  const q = useQuery({ queryKey: ['report-sales', from, to], queryFn: () => reportsApi.sales(from, to), enabled: from <= to })

  function applyPreset(p: Preset) {
    setPreset(p)
    const days = { hoy: 0, '7d': 6, '30d': 29, '90d': 89 }[p as Exclude<Preset, 'custom'>]
    if (days === undefined) return
    setFrom(isoDate(addDays(new Date(), -days)))
    setTo(isoDate())
  }

  return (
    <div>
      <PageHeader
        title="Reportes de ventas"
        subtitle="Indicadores de gestión por período"
        actions={
          q.data && (
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => exportCsv(q.data)}>
              Exportar CSV
            </Button>
          )
        }
      />

      <Card className="mb-6">
        <FilterBar className="border-b-0">
          <span className="section-label mr-1">Período</span>
          <Segmented aria-label="Rango rápido" value={preset} onChange={applyPreset} items={presetItems} className="p-[3px]" />
          <DateRange
            from={from}
            to={to}
            onFromChange={(v) => {
              setFrom(v)
              setPreset('custom')
            }}
            onToChange={(v) => {
              setTo(v)
              setPreset('custom')
            }}
          />
          {preset === 'custom' && <span className="text-xs text-muted">Rango personalizado</span>}
        </FilterBar>
      </Card>

      {q.isLoading ? (
        <ReportSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <ReportBody r={q.data} />
      ) : null}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="animate-fade-in">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex flex-col gap-3 p-5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="h-80 xl:col-span-2" />
        <Card className="p-5">
          <SkeletonText lines={5} />
        </Card>
      </div>
    </div>
  )
}

function ReportBody({ r }: { r: SalesReport }) {
  const ct = useChartTheme()
  const marginPct = r.net > 0 ? Math.round((r.margin / r.net) * 100) : 0
  const pie = methodOrder
    .map((m, i) => ({ name: paymentLabel[m], key: m, value: r.by_method[m] ?? 0, color: ct.series[i] }))
    .filter((x) => x.value > 0)
  const daily = r.daily.map((d) => ({ ...d, label: date(d.date).slice(0, 5) }))
  const maxProduct = Math.max(1, ...r.top_products.map((p) => p.total))
  const maxUser = Math.max(1, ...r.by_user.map((u) => u.total))

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Venta total"
          value={clp(r.total)}
          hint={`Neto ${clp(r.net)} · IVA ${clp(r.tax)}`}
          icon={<DollarSign className="size-5" />}
        />
        <StatCard
          label="Transacciones"
          value={num(r.count)}
          hint={`${r.voided_count} anuladas · descuentos ${clp(r.discount)}`}
          icon={<Receipt className="size-5" />}
          tone="gray"
        />
        <StatCard label="Ticket promedio" value={clp(r.avg_ticket)} icon={<TrendingUp className="size-5" />} tone="gray" />
        <StatCard
          label="Margen bruto"
          value={clp(r.margin)}
          hint={`${marginPct}% sobre venta neta`}
          icon={<Percent className="size-5" />}
          tone="gray"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Ventas diarias" subtitle={`${r.daily.length} días · ${date(r.from)} — ${date(r.to)}`} />
          <div className="h-72 p-4">
            {daily.every((d) => d.total === 0) ? (
              <EmptyState compact title="Sin ventas en el período" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily}>
                  <CartesianGrid {...ct.grid} />
                  <XAxis dataKey="label" {...ct.axis} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} {...ct.axis} width={48} />
                  <Tooltip {...ct.tooltip} formatter={(v) => [clp(Number(v)), 'Ventas']} cursor={ct.barCursor} />
                  <Bar dataKey="total" fill={ct.series[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Medios de pago" />
          {pie.length === 0 ? (
            <EmptyState compact title="Sin ventas en el período" />
          ) : (
            <div className="p-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pie}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    >
                      {pie.map((p) => (
                        <Cell key={p.key} fill={p.color} />
                      ))}
                    </Pie>
                    <Tooltip {...ct.tooltip} formatter={(v) => clp(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {pie.map((p) => (
                  <li key={p.key} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-ink-soft">
                      <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
                      {p.name}
                    </span>
                    <span className="text-ink tabular-nums">
                      {clp(p.value)} <span className="text-faint">· {r.total ? Math.round((p.value / r.total) * 100) : 0}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Productos más vendidos" subtitle="Por monto de venta" />
          {r.top_products.length === 0 ? (
            <EmptyState compact title="Sin ventas en el período" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-10">#</Th>
                  <Th>Producto</Th>
                  <Th numeric>Unidades</Th>
                  <Th numeric>Venta</Th>
                  <Th numeric>Margen neto</Th>
                </tr>
              </thead>
              <tbody>
                {r.top_products.map((p, i) => (
                  <Tr key={p.product_id}>
                    <Td className="text-faint">{i + 1}</Td>
                    <Td>
                      <p className="font-medium text-ink">{p.name}</p>
                      <div className="mt-1.5 h-1.5 w-32 max-w-full overflow-hidden rounded-full bg-subtle">
                        <div
                          className="h-full rounded-full bg-brand-500 dark:bg-brand-400"
                          style={{ width: `${Math.round((p.total / maxProduct) * 100)}%` }}
                        />
                      </div>
                    </Td>
                    <Td numeric>{num(p.quantity)}</Td>
                    <Td numeric className="font-semibold">
                      {clp(p.total)}
                    </Td>
                    <Td numeric className="text-ok-700 dark:text-ok-400">
                      {clp(p.margin)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Ventas por vendedor" />
          {r.by_user.length === 0 ? (
            <EmptyState compact title="Sin datos" />
          ) : (
            <ul className="divide-y divide-line px-5 py-2">
              {r.by_user.map((u) => (
                <li key={u.user_name} className="py-3">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-ink">{u.user_name}</span>
                    <span className="font-semibold text-ink tabular-nums">{clp(u.total)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-info-500 dark:bg-info-400"
                        style={{ width: `${Math.round((u.total / maxUser) * 100)}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs text-faint tabular-nums">{u.count} ventas</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {r.by_branch.length > 1 && <BranchSalesCard rows={r.by_branch} total={r.total} />}
    </>
  )
}

/** Ventas por sucursal: solo aporta en el consolidado (con una sola sucursal activa hay una única fila). */
function BranchSalesCard({ rows, total }: { rows: SalesReport['by_branch']; total: number }) {
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  const max = Math.max(1, ...sorted.map((b) => b.total))
  return (
    <Card className="mt-6">
      <CardHeader title="Ventas por sucursal" subtitle={`${rows.length} sucursales`} />
      <ul className="divide-y divide-line px-5 py-2">
        {sorted.map((b) => (
          <li key={b.branch_id} className="py-3">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium text-ink">{b.branch_name}</span>
              <span className="font-semibold text-ink tabular-nums">{clp(b.total)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-brand-500 dark:bg-brand-400"
                  style={{ width: `${Math.round((b.total / max) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-faint tabular-nums">
                {b.count} ventas · {total ? Math.round((b.total / total) * 100) : 0}%
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function exportCsv(r: SalesReport) {
  const rows = [['Fecha', 'Ventas', 'Total'], ...r.daily.map((d) => [d.date, String(d.count), String(d.total)])]
  rows.push(
    [],
    ['Producto', 'Unidades', 'Venta', 'Margen'],
    ...r.top_products.map((p) => [p.name, String(p.quantity), String(p.total), String(p.margin)]),
  )
  const csv = rows.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `ventas_${r.from}_${r.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
