import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Download, PackageSearch, X } from 'lucide-react'
import { inventoryApi } from '@/api/endpoints'
import type { Rotation, RotationRow } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { addDays, date, isoDate, movementLabel, num } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/button'
import { Callout, Card, EmptyState, ErrorState, MiniStat, PageHeader, Table, Td, Th, Tr } from '@/components/ui/display'
import { DateRange, FilterBar } from '@/components/ui/filters'
import { MobileList, MobileListItem } from '@/components/ui/list'
import { SkeletonRows } from '@/components/ui/skeleton'
import { ProductPicker } from '@/components/ProductPicker'
import { LotCode } from '@/components/LotCode'
import { BranchBadge } from '@/components/badges'

const presets = [
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
  { label: '90 días', days: 89 },
]

const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })

/**
 * Rotación de productos (kardex): por producto y rango de fechas, cada movimiento de stock
 * con su ingreso, egreso y saldo. Solo administrador. El estado vive en la URL (?product, from, to)
 * para poder compartir o recargar el reporte.
 */
export function RotationPage() {
  const { isAll } = useBranch()
  const [params, setParams] = useSearchParams()
  const productId = Number(params.get('product')) || null
  const from = params.get('from') ?? isoDate(addDays(new Date(), -29))
  const to = params.get('to') ?? isoDate()

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  const q = useQuery({
    queryKey: ['rotation', productId, from, to],
    queryFn: () => inventoryApi.rotation(productId!, from, to),
    enabled: !!productId && from <= to,
  })

  return (
    <div>
      <PageHeader
        title="Rotación de productos"
        subtitle="Ingresos, egresos y saldo de un producto en el período"
        actions={
          q.data &&
          q.data.rows.length > 0 && (
            <Button variant="secondary" icon={<Download />} onClick={() => exportCsv(q.data)}>
              Exportar CSV
            </Button>
          )
        }
      />

      <Card>
        <FilterBar>
          <div className="min-w-64 flex-1">
            {productId && q.data ? (
              <div className="flex h-10 items-center gap-3 rounded-lg border border-brand-500/40 bg-brand-50 px-3 dark:bg-brand-500/10">
                <PackageSearch className="size-4 shrink-0 text-brand-700 dark:text-brand-300" />
                <div className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium text-ink">{q.data.product_name}</span>
                  <span className="ml-2 font-mono text-xs text-muted">{q.data.barcode ?? q.data.product_sku}</span>
                </div>
                <IconButton label="Cambiar producto" size="sm" onClick={() => set({ product: null })}>
                  <X />
                </IconButton>
              </div>
            ) : (
              <ProductPicker
                autoFocus
                placeholder="Buscar producto por nombre o código de barras…"
                onSelect={(p) => set({ product: String(p.id) })}
              />
            )}
          </div>
          <DateRange from={from} to={to} onFromChange={(v) => set({ from: v })} onToChange={(v) => set({ to: v })} />
          <div className="flex gap-1">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant="ghost"
                size="sm"
                onClick={() => set({ from: isoDate(addDays(new Date(), -p.days)), to: isoDate() })}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </FilterBar>

        {!productId ? (
          <EmptyState
            icon={<PackageSearch />}
            title="Seleccione un producto"
            message="Busque por nombre o escanee el código de barras para ver sus ingresos, egresos y saldo en el período."
          />
        ) : from > to ? (
          <EmptyState title="Rango de fechas inválido" message="La fecha de inicio debe ser anterior o igual a la de término." />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading || !q.data ? (
          <Table>
            <tbody>
              <SkeletonRows rows={8} cols={8} numeric={[5, 6, 7]} />
            </tbody>
          </Table>
        ) : (
          <RotationBody r={q.data} isAll={isAll} />
        )}
      </Card>
    </div>
  )
}

function RotationBody({ r, isAll }: { r: Rotation; isAll: boolean }) {
  const branchCols = isAll ? 1 : 0
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 border-b border-line p-4 md:grid-cols-4">
        <MiniStat label={`Saldo al ${date(r.from)}`} value={`${num(r.opening_balance)} u.`} hint="Stock al inicio del período" />
        <MiniStat label="Ingresos" value={`+${num(r.total_in)} u.`} tone="ok" hint="Compras, anulaciones y ajustes (+)" />
        <MiniStat label="Egresos" value={`−${num(r.total_out)} u.`} tone="danger" hint="Ventas, mermas y ajustes (−)" />
        <MiniStat label={`Saldo al ${date(r.to)}`} value={`${num(r.closing_balance)} u.`} tone="brand" hint="Stock al cierre del período" />
      </div>

      {r.truncated && (
        <div className="px-4 pt-4">
          <Callout tone="warn" compact>
            El período tiene más de 5.000 movimientos: se muestran los 5.000 más recientes. Acote el rango de fechas para ver el detalle
            completo.
          </Callout>
        </div>
      )}

      {r.rows.length === 0 ? (
        <EmptyState
          compact
          title="Sin movimientos en el período"
          message={`El producto no tuvo ingresos ni egresos entre el ${date(r.from)} y el ${date(r.to)}.`}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>Producto</Th>
                  <Th>Código de barras</Th>
                  {isAll && <Th>Sucursal</Th>}
                  <Th>Fecha</Th>
                  <Th>Hora</Th>
                  <Th>Movimiento</Th>
                  <Th numeric>Ingreso</Th>
                  <Th numeric>Egreso</Th>
                  <Th numeric>Saldo</Th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((m) => (
                  <Tr key={m.id}>
                    <Td className="font-mono text-xs text-muted">{m.id}</Td>
                    <Td className="max-w-44 truncate font-medium text-ink" title={r.product_name}>
                      {r.product_name}
                    </Td>
                    <Td className="font-mono text-xs text-ink-soft">{r.barcode ?? '—'}</Td>
                    {isAll && (
                      <Td>
                        <BranchBadge name={m.branch_name} />
                      </Td>
                    )}
                    <Td className="whitespace-nowrap text-ink-soft">{date(m.created_at)}</Td>
                    <Td className="whitespace-nowrap text-ink-soft tabular-nums">{hour(m.created_at)}</Td>
                    <Td className="max-w-64">
                      <MovementCell m={m} />
                    </Td>
                    <Td numeric>{m.qty_in > 0 ? <Qty value={m.qty_in} kind="in" /> : <span className="text-faint">—</span>}</Td>
                    <Td numeric>{m.qty_out > 0 ? <Qty value={m.qty_out} kind="out" /> : <span className="text-faint">—</span>}</Td>
                    <Td numeric className="font-semibold text-ink">
                      {num(m.balance)}
                    </Td>
                  </Tr>
                ))}
                {/* Orden descendente: el saldo inicial es la fila más antigua, al final (si el reporte no se truncó). */}
                {!r.truncated && (
                  <Tr className="bg-subtle/50">
                    <Td colSpan={8 + branchCols} className="text-sm text-muted">
                      Saldo inicial al {date(r.from)}
                    </Td>
                    <Td numeric className="font-semibold text-ink">
                      {num(r.opening_balance)}
                    </Td>
                  </Tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-subtle/50">
                  <Td colSpan={6 + branchCols} className="text-sm font-medium text-ink-soft">
                    Totales del período · {num(r.rows.length)} movimientos
                  </Td>
                  <Td numeric>
                    <Qty value={r.total_in} kind="in" />
                  </Td>
                  <Td numeric>
                    <Qty value={r.total_out} kind="out" />
                  </Td>
                  <Td numeric className="font-bold text-ink">
                    {num(r.closing_balance)}
                  </Td>
                </tr>
              </tfoot>
            </Table>
          </div>

          <MobileList>
            {r.rows.map((m) => (
              <MobileListItem key={m.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <MovementCell m={m} />
                    <p className="mt-1 text-xs text-muted tabular-nums">
                      {date(m.created_at)} · {hour(m.created_at)} · <span className="font-mono">#{m.id}</span>
                    </p>
                    {isAll && (
                      <div className="mt-1.5">
                        <BranchBadge name={m.branch_name} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {m.qty_in > 0 ? <Qty value={m.qty_in} kind="in" /> : <Qty value={m.qty_out} kind="out" />}
                    <p className="mt-1 text-xs text-muted tabular-nums">Saldo {num(m.balance)}</p>
                  </div>
                </div>
              </MobileListItem>
            ))}
            {!r.truncated && (
              <MobileListItem>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">Saldo inicial al {date(r.from)}</span>
                  <span className="font-semibold text-ink tabular-nums">{num(r.opening_balance)}</span>
                </div>
              </MobileListItem>
            )}
          </MobileList>
        </>
      )}
    </>
  )
}

function MovementCell({ m }: { m: RotationRow }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-ink">{movementLabel[m.type]}</p>
      <p className="truncate text-xs text-muted">
        {[m.document, m.user_name].filter(Boolean).join(' · ')}
        {' · '}
        <LotCode value={m.lot_number} labeled />
      </p>
    </div>
  )
}

function Qty({ value, kind }: { value: number; kind: 'in' | 'out' }) {
  const Icon = kind === 'in' ? ArrowDownLeft : ArrowUpRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-semibold tabular-nums',
        kind === 'in' ? 'text-ok-700 dark:text-ok-400' : 'text-danger-600 dark:text-danger-400',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {kind === 'in' ? '+' : '−'}
      {num(value)}
    </span>
  )
}

function exportCsv(r: Rotation) {
  const header = [
    'ID',
    'Producto',
    'Código de barras',
    'Fecha',
    'Hora',
    'Movimiento',
    'Documento',
    'Lote',
    'Usuario',
    'Ingreso',
    'Egreso',
    'Saldo',
  ]
  const rows = [
    header,
    ...r.rows.map((m) => [
      String(m.id),
      r.product_name,
      r.barcode ?? '',
      date(m.created_at),
      hour(m.created_at),
      movementLabel[m.type],
      m.document ?? '',
      m.lot_number ?? 'Sin lote',
      m.user_name,
      m.qty_in ? String(m.qty_in) : '',
      m.qty_out ? String(m.qty_out) : '',
      String(m.balance),
    ]),
    ['', r.product_name, r.barcode ?? '', date(r.from), '', 'Saldo inicial', '', '', '', '', '', String(r.opening_balance)],
    ['', '', '', '', '', 'Totales', '', '', '', String(r.total_in), String(r.total_out), String(r.closing_balance)],
  ]
  const csv = rows.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `rotacion_${r.product_sku}_${r.from}_${r.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
