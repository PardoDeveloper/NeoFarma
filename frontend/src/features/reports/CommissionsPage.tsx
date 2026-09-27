import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BadgePercent, Download, HandCoins, Receipt, Users } from 'lucide-react'
import { reportsApi } from '@/api/endpoints'
import type { CommissionReport, SellerCommission } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { clp, date, dateTime, isoDate, num, percentBps, roleLabel } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { DateRange, FilterBar } from '@/components/ui/filters'
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  SkeletonText,
  StatCard,
  Table,
  Td,
  Th,
  Tr,
  type SegmentItem,
} from '@/components/ui/display'
import { Drawer } from '@/components/ui/drawer'
import { MobileList, MobileListItem } from '@/components/ui/list'
import { SkeletonRows } from '@/components/ui/skeleton'

type Preset = 'mes' | 'mes_anterior' | '7d' | '30d' | 'custom'

const presetItems: SegmentItem<Preset>[] = [
  { value: 'mes', label: 'Este mes' },
  { value: 'mes_anterior', label: 'Mes anterior' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
]

function rangeFor(p: Exclude<Preset, 'custom'>): [string, string] {
  const now = new Date()
  if (p === 'mes') return [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), isoDate(now)]
  if (p === 'mes_anterior') {
    return [isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), isoDate(new Date(now.getFullYear(), now.getMonth(), 0))]
  }
  const days = p === '7d' ? 6 : 29
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return [isoDate(from), isoDate(now)]
}

/**
 * Comisiones por vendedor (solo admin). Base: venta neta sin IVA; cada venta conserva la tasa con que se
 * registró, así que cambiar la tasa de un usuario no altera lo ya vendido. Las ventas anuladas no comisionan.
 */
export function CommissionsPage() {
  const { current, isAll } = useBranch()
  const [preset, setPreset] = useState<Preset>('mes')
  const [[from, to], setRange] = useState(() => rangeFor('mes'))
  const [selected, setSelected] = useState<SellerCommission | null>(null)
  const q = useQuery({ queryKey: ['commissions', from, to], queryFn: () => reportsApi.commissions(from, to), enabled: from <= to })

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p !== 'custom') setRange(rangeFor(p))
  }

  return (
    <div>
      <PageHeader
        title="Comisiones de vendedores"
        subtitle={`Comisión sobre la venta neta (sin IVA) · ${isAll ? 'todas las sucursales' : (current?.name ?? '')}`}
        actions={
          q.data &&
          q.data.sellers.length > 0 && (
            <Button variant="secondary" icon={<Download />} onClick={() => exportCsv(q.data)}>
              Exportar CSV
            </Button>
          )
        }
      />

      <Card className="mb-6">
        <FilterBar className="border-b-0">
          <span className="section-label mr-1">Período</span>
          <Segmented aria-label="Período rápido" value={preset} onChange={applyPreset} items={presetItems} className="p-[3px]" />
          <DateRange
            from={from}
            to={to}
            onFromChange={(v) => {
              setRange([v, to])
              setPreset('custom')
            }}
            onToChange={(v) => {
              setRange([from, v])
              setPreset('custom')
            }}
          />
        </FilterBar>
      </Card>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Comisiones del período"
              value={q.data ? clp(q.data.commission_total) : '—'}
              hint={`${date(from)} al ${date(to)}`}
              icon={<HandCoins className="size-5" />}
              loading={q.isLoading}
            />
            <StatCard
              label="Venta neta comisionable"
              value={q.data ? clp(q.data.net_total) : '—'}
              hint="Ventas completadas, sin IVA"
              icon={<Receipt className="size-5" />}
              tone="gray"
              loading={q.isLoading}
            />
            <StatCard
              label="Vendedores"
              value={q.data ? num(q.data.sellers.filter((s) => s.sales_count > 0).length) : '—'}
              hint={q.data ? `${num(q.data.sellers.filter((s) => s.current_bps > 0).length)} con comisión asignada` : undefined}
              icon={<Users className="size-5" />}
              tone="gray"
              loading={q.isLoading}
            />
          </div>

          <Card className="mt-6">
            <CardHeader title="Detalle por vendedor" subtitle="Haga clic en un vendedor para ver sus ventas" />
            {q.isLoading ? (
              <Table>
                <tbody>
                  <SkeletonRows rows={5} cols={7} numeric={[2, 3, 4, 5]} />
                </tbody>
              </Table>
            ) : !q.data || q.data.sellers.length === 0 ? (
              <EmptyState
                icon={<BadgePercent />}
                title="Sin comisiones en el período"
                message="Asigne un porcentaje de comisión a los vendedores desde Usuarios."
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Vendedor</Th>
                        <Th>Rol</Th>
                        <Th numeric>Tasa vigente</Th>
                        <Th numeric>Ventas</Th>
                        <Th numeric>Venta neta</Th>
                        <Th numeric>Comisión</Th>
                        <Th numeric>Anuladas</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.sellers.map((s) => (
                        <Tr key={s.user_id} onClick={() => setSelected(s)} selected={selected?.user_id === s.user_id}>
                          <Td className="font-medium text-ink">{s.user_name}</Td>
                          <Td className="text-muted">{roleLabel[s.role]}</Td>
                          <Td numeric className={s.current_bps ? 'text-ink-soft' : 'text-faint'}>
                            {s.current_bps ? percentBps(s.current_bps) : 'Sin comisión'}
                          </Td>
                          <Td numeric>{num(s.sales_count)}</Td>
                          <Td numeric>{clp(s.net_total)}</Td>
                          <Td numeric className="font-semibold text-ink">
                            {clp(s.commission_total)}
                          </Td>
                          <Td numeric className={s.voided_count ? 'text-warn-700 dark:text-warn-400' : 'text-faint'}>
                            {s.voided_count || '—'}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line-strong bg-subtle/50">
                        <Td colSpan={4} className="text-sm font-medium text-ink-soft">
                          Total del período
                        </Td>
                        <Td numeric className="font-semibold text-ink">
                          {clp(q.data.net_total)}
                        </Td>
                        <Td numeric className="font-bold text-ink">
                          {clp(q.data.commission_total)}
                        </Td>
                        <Td />
                      </tr>
                    </tfoot>
                  </Table>
                </div>
                <MobileList>
                  {q.data.sellers.map((s) => (
                    <MobileListItem key={s.user_id} onClick={() => setSelected(s)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{s.user_name}</p>
                          <p className="text-xs text-muted">
                            {roleLabel[s.role]} · {s.current_bps ? percentBps(s.current_bps) : 'sin comisión'} · {num(s.sales_count)} ventas
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold text-ink tabular-nums">{clp(s.commission_total)}</p>
                          <p className="text-xs text-muted tabular-nums">neto {clp(s.net_total)}</p>
                        </div>
                      </div>
                    </MobileListItem>
                  ))}
                </MobileList>
              </>
            )}
          </Card>
          <p className="mt-3 text-xs text-muted">
            Cada venta conserva la tasa vigente al momento de registrarse: cambiar la comisión de un usuario no modifica lo ya vendido. Las
            ventas anuladas no generan comisión.
          </p>
        </>
      )}

      <SellerDrawer seller={selected} from={from} to={to} onClose={() => setSelected(null)} />
    </div>
  )
}

function SellerDrawer({ seller, from, to, onClose }: { seller: SellerCommission | null; from: string; to: string; onClose: () => void }) {
  const { isAll } = useBranch()
  const q = useQuery({
    queryKey: ['commissions', 'detail', seller?.user_id, from, to],
    queryFn: () => reportsApi.commissionDetail(seller!.user_id, from, to),
    enabled: !!seller,
  })
  return (
    <Drawer
      open={!!seller}
      onClose={onClose}
      title={seller?.user_name ?? ''}
      description={seller && `${roleLabel[seller.role]} · ${date(from)} al ${date(to)}`}
      meta={
        seller && (
          <>
            <Badge tone="brand">Comisión {clp(seller.commission_total)}</Badge>
            <Badge>{seller.current_bps ? `Tasa vigente ${percentBps(seller.current_bps)}` : 'Sin comisión vigente'}</Badge>
          </>
        )
      }
      width="lg"
    >
      {q.isLoading ? (
        <SkeletonText lines={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState compact title="Sin ventas en el período" />
      ) : (
        <>
          {q.data.data.length >= 2000 && (
            <Callout tone="warn" compact className="mb-3">
              Se muestran las 2.000 ventas más recientes; acote el período para ver el detalle completo.
            </Callout>
          )}
          <Table containerClassName="rounded-xl border border-line">
            <thead>
              <tr>
                <Th>Venta</Th>
                <Th>Fecha</Th>
                {isAll && <Th>Sucursal</Th>}
                <Th numeric>Neto</Th>
                <Th numeric>Tasa</Th>
                <Th numeric>Comisión</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((s) => (
                <Tr key={s.sale_id} className={s.status === 'anulada' ? 'opacity-60' : undefined}>
                  <Td className="font-mono text-[13px] text-brand-700 dark:text-brand-300">
                    #{s.sale_id}
                    {s.status === 'anulada' && (
                      <Badge tone="danger" size="sm" className="ml-2 font-sans">
                        Anulada
                      </Badge>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">{dateTime(s.created_at)}</Td>
                  {isAll && <Td className="text-muted">{s.branch_name}</Td>}
                  <Td numeric>{clp(s.net_amount)}</Td>
                  <Td numeric className="text-muted">
                    {percentBps(s.commission_bps)}
                  </Td>
                  <Td numeric className="font-semibold text-ink">
                    {s.status === 'anulada' ? <span className="text-faint line-through">{clp(0)}</span> : clp(s.commission_amount)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Drawer>
  )
}

function exportCsv(r: CommissionReport) {
  const rows = [
    ['Vendedor', 'Rol', 'Tasa vigente', 'Ventas', 'Venta neta', 'Comisión', 'Anuladas'],
    ...r.sellers.map((s) => [
      s.user_name,
      roleLabel[s.role],
      percentBps(s.current_bps),
      String(s.sales_count),
      String(s.net_total),
      String(s.commission_total),
      String(s.voided_count),
    ]),
    ['Total', '', '', '', String(r.net_total), String(r.commission_total), ''],
  ]
  const csv = rows.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `comisiones_${r.from}_${r.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
