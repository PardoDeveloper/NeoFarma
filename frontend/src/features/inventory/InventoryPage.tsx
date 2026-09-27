import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Boxes, ClipboardList, Minus, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { inventoryApi } from '@/api/endpoints'
import { errorMessage } from '@/api/client'
import type { ExpiryStatus, LotView, MovementType } from '@/api/types'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import { useDebounce } from '@/lib/hooks'
import { clp, dateTime, lotLabel, movementLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import {
  Callout,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  RowActions,
  SkeletonRows,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Modal, ModalActions } from '@/components/ui/modal'
import { FilterBar, SearchField } from '@/components/ui/filters'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import { BranchBadge, ExpiryBadge, MovementQty } from '@/components/badges'
import { LotCode } from '@/components/LotCode'

type Tab = 'lotes' | 'proximos' | 'vencidos' | 'movimientos'

export function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'lotes'

  const counts = useQuery({
    queryKey: ['lots', 'counts'],
    queryFn: async () => {
      const [all, proximos, vencidos] = await Promise.all([
        inventoryApi.lots({ page_size: 1 }),
        inventoryApi.lots({ page_size: 1, expiring_days: 90 }),
        inventoryApi.lots({ page_size: 1, expired: true }),
      ])
      return { lotes: all.total, proximos: proximos.total, vencidos: vencidos.total }
    },
  })

  return (
    <div>
      <PageHeader title="Stock y vencimientos" subtitle="Control de lotes, fechas de vencimiento, movimientos y ajustes de inventario" />
      <div className="mb-4">
        <Tabs
          value={tab}
          onChange={(t) => setParams({ tab: t })}
          items={[
            { value: 'lotes', label: 'Todos los lotes', icon: <Boxes />, count: counts.data?.lotes },
            { value: 'proximos', label: 'Por vencer (90 días)', icon: <AlertTriangle />, count: counts.data?.proximos },
            { value: 'vencidos', label: 'Vencidos', icon: <Trash2 />, count: counts.data?.vencidos },
            { value: 'movimientos', label: 'Movimientos', icon: <ClipboardList /> },
          ]}
        />
      </div>
      {tab === 'movimientos' ? <MovementsTable /> : <LotsTable key={tab} tab={tab} />}
    </div>
  )
}

/** Franja de urgencia: barra de color + texto, nunca solo color (accesibilidad). */
function ExpiryMeter({ days, status }: { days: number; status: ExpiryStatus }) {
  const pct = days < 0 ? 100 : Math.max(6, Math.min(100, Math.round((1 - Math.min(days, 180) / 180) * 100)))
  const label = days < 0 ? `Vencido hace ${-days} días` : days === 0 ? 'Vence hoy' : `Vence en ${days} días`
  const textTone =
    status === 'vencido' || status === 'critico'
      ? 'text-danger-600 dark:text-danger-400'
      : status === 'proximo'
        ? 'text-warn-700 dark:text-warn-400'
        : 'text-muted'
  const barTone = status === 'vencido' || status === 'critico' ? 'bg-danger-500' : status === 'proximo' ? 'bg-warn-500' : 'bg-ok-500'
  return (
    <div className="w-32">
      <p className={cn('text-xs font-medium tabular-nums', textTone)}>{label}</p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line/70">
        <div className={cn('h-full rounded-full', barTone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function LotsTable({ tab }: { tab: Exclude<Tab, 'movimientos'> }) {
  const { can } = useAuth()
  const { isAll } = useBranch()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [adjusting, setAdjusting] = useState<LotView | null>(null)
  const q = useDebounce(search)
  const list = useQuery({
    queryKey: ['lots', tab, q, page],
    queryFn: () =>
      inventoryApi.lots({
        q,
        page,
        page_size: 25,
        expiring_days: tab === 'proximos' ? 90 : undefined,
        expired: tab === 'vencidos' || undefined,
      }),
    placeholderData: (prev) => prev,
  })
  const canAdjust = can('quimico', 'bodega')
  const lotCols = (canAdjust ? 7 : 6) + (isAll ? 1 : 0)
  const lotNumericCols = isAll ? [4, 5, 6] : [3, 4, 5]
  const pageValue = list.data?.data.reduce((s, l) => s + l.stock_value, 0) ?? 0
  const pageUnits = list.data?.data.reduce((s, l) => s + l.qty_available, 0) ?? 0

  return (
    <Card>
      <FilterBar>
        <SearchField
          placeholder="Buscar por producto, SKU o lote"
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setPage(1)
          }}
          aria-label="Buscar lote"
        />
        {tab === 'vencidos' && list.data && list.data.total > 0 && (
          <Callout tone="danger" compact>
            Retire estos lotes de la venta y regístrelos como merma
          </Callout>
        )}
      </FilterBar>
      {!list.isLoading && list.data && list.data.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-subtle/50 px-4 py-2.5 text-sm text-muted">
          <span>
            <span className="font-semibold tabular-nums text-ink">{list.data.total}</span> lotes
          </span>
          <span>
            <span className="font-semibold tabular-nums text-ink">{pageUnits}</span> unidades en esta página
          </span>
          <span className="ml-auto">
            Valorizado de la página <span className="font-semibold tabular-nums text-ink">{clp(pageValue)}</span>
          </span>
        </div>
      )}
      {list.isLoading ? (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-56">Producto</Th>
                  <Th>Lote</Th>
                  {isAll && <Th>Sucursal</Th>}
                  <Th>Vencimiento</Th>
                  <Th numeric>Disponible</Th>
                  <Th numeric>Costo unit.</Th>
                  <Th numeric>Valorizado</Th>
                  <Th className="hidden xl:table-cell">Proveedor</Th>
                  {canAdjust && <Th className="w-28" />}
                </tr>
              </thead>
              <tbody>
                <SkeletonRows rows={8} cols={lotCols} numeric={lotNumericCols} />
              </tbody>
            </Table>
          </div>
          <SkeletonList />
        </>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState
          icon={tab === 'vencidos' ? <Trash2 /> : <Boxes />}
          title={tab === 'vencidos' ? 'No hay lotes vencidos con stock' : 'No hay lotes para mostrar'}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th className="min-w-56">Producto</Th>
                  <Th>Lote</Th>
                  {isAll && <Th>Sucursal</Th>}
                  <Th>Vencimiento</Th>
                  <Th numeric>Disponible</Th>
                  <Th numeric>Costo unit.</Th>
                  <Th numeric>Valorizado</Th>
                  <Th className="hidden xl:table-cell">Proveedor</Th>
                  {canAdjust && <Th className="w-28" />}
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <p className="font-medium text-ink">{l.product_name}</p>
                      <p className="text-xs text-muted">
                        <span className="font-mono">{l.product_sku}</span>
                        {l.laboratory && <> · {l.laboratory}</>}
                      </p>
                    </Td>
                    <Td className="text-xs">
                      <LotCode value={l.lot_number} />
                    </Td>
                    {isAll && (
                      <Td>
                        <BranchBadge name={l.branch_name} />
                      </Td>
                    )}
                    <Td>
                      <ExpiryMeter days={l.days_to_expiry} status={l.expiry_status} />
                    </Td>
                    <Td numeric>
                      <span className="font-semibold">{l.qty_available}</span>
                      <span className="text-faint"> / {l.qty_initial}</span>
                    </Td>
                    <Td numeric>{clp(l.unit_cost)}</Td>
                    <Td numeric className="font-semibold">
                      {clp(l.stock_value)}
                    </Td>
                    <Td className="hidden max-w-48 truncate text-muted xl:table-cell" title={l.supplier_name ?? undefined}>
                      {l.supplier_name ?? '—'}
                    </Td>
                    {canAdjust && (
                      <Td>
                        {/* En "Vencidos" la merma es la tarea: acción siempre visible; en el resto, al pasar el mouse. */}
                        <RowActions className={tab === 'vencidos' ? '[@media(hover:hover)]:opacity-100' : undefined}>
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={tab === 'vencidos' ? <Trash2 /> : <SlidersHorizontal />}
                            onClick={() => setAdjusting(l)}
                          >
                            {tab === 'vencidos' ? 'Merma' : 'Ajustar'}
                          </Button>
                        </RowActions>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {list.data.data.map((l) => (
              <MobileListItem key={l.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{l.product_name}</p>
                    <p className="text-xs text-muted">
                      <span className="font-mono">{l.product_sku}</span> · <LotCode value={l.lot_number} labeled />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums text-ink">
                      {l.qty_available} <span className="font-normal text-faint">/ {l.qty_initial}</span>
                    </p>
                    <p className="text-xs text-muted tabular-nums">{clp(l.stock_value)}</p>
                  </div>
                </div>
                <div className="mt-2.5 flex items-end justify-between gap-3">
                  <ExpiryMeter days={l.days_to_expiry} status={l.expiry_status} />
                  <ExpiryBadge status={l.expiry_status} />
                </div>
                {l.supplier_name && <p className="mt-2 truncate text-xs text-faint">{l.supplier_name}</p>}
                {canAdjust && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={tab === 'vencidos' ? <Trash2 /> : <SlidersHorizontal />}
                    className="mt-2.5 w-full"
                    onClick={() => setAdjusting(l)}
                  >
                    {tab === 'vencidos' ? 'Registrar merma' : 'Ajustar'}
                  </Button>
                )}
              </MobileListItem>
            ))}
          </MobileList>
          <Pagination page={page} pageSize={25} total={list.data.total} onChange={setPage} />
        </>
      )}
      <AdjustModal lot={adjusting} defaultType={tab === 'vencidos' ? 'merma' : 'ajuste_negativo'} onClose={() => setAdjusting(null)} />
    </Card>
  )
}

const adjustTypeInfo = {
  merma: { label: 'Merma (vencido, dañado, extraviado)', icon: Trash2 },
  ajuste_negativo: { label: 'Ajuste negativo (diferencia de inventario)', icon: Minus },
  ajuste_positivo: { label: 'Ajuste positivo (sobrante de inventario)', icon: Plus },
}

function AdjustModal({
  lot,
  defaultType,
  onClose,
}: {
  lot: LotView | null
  defaultType: 'merma' | 'ajuste_negativo'
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [type, setType] = useState<'ajuste_positivo' | 'ajuste_negativo' | 'merma'>(defaultType)
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const m = useMutation({
    mutationFn: () => inventoryApi.adjust({ lot_id: lot!.id, type, quantity: Number(qty), notes }),
    onSuccess: () => {
      toast.success('Ajuste registrado')
      qc.invalidateQueries({ queryKey: ['lots'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setQty('')
      setNotes('')
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!(Number(qty) > 0) || notes.trim().length < 3) return toast.error('Indique cantidad y motivo')
    m.mutate()
  }
  const Icon = adjustTypeInfo[type].icon
  const isOut = type !== 'ajuste_positivo'
  return (
    <Modal
      open={!!lot}
      onClose={onClose}
      title="Ajuste de inventario"
      description={lot && `${lot.product_name} · ${lotLabel(lot.lot_number)} · disponible ${lot.qty_available}`}
      icon={<SlidersHorizontal />}
      size="sm"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Tipo de ajuste">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {Object.entries(adjustTypeInfo).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Cantidad" required>
          {(id) => (
            <div className="flex gap-2">
              <Input id={id} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
              {type !== 'ajuste_positivo' && lot && (
                <Button variant="secondary" onClick={() => setQty(String(lot.qty_available))}>
                  Todo
                </Button>
              )}
            </div>
          )}
        </Field>
        {lot && Number(qty) > 0 && (
          <p
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium',
              isOut
                ? 'bg-danger-50 text-danger-700 dark:bg-danger-500/12 dark:text-danger-300'
                : 'bg-ok-50 text-ok-700 dark:bg-ok-500/12 dark:text-ok-300',
            )}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {isOut
              ? `Se descontarán ${qty} u. del lote (quedará ${Math.max(0, lot.qty_available - Number(qty))})`
              : `Se sumarán ${qty} u. al lote`}
          </p>
        )}
        <Field label="Motivo" required>
          {(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Caja dañada en bodega" />}
        </Field>
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={m.isPending}>
            Registrar ajuste
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function MovementsTable() {
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery({
    queryKey: ['movements', 'all', type, page],
    queryFn: () => inventoryApi.movements({ type, page, page_size: 30 }),
    placeholderData: (prev) => prev,
  })
  return (
    <Card>
      <FilterBar>
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value)
            setPage(1)
          }}
          className="w-60"
          aria-label="Tipo de movimiento"
        >
          <option value="">Todos los tipos</option>
          {(Object.keys(movementLabel) as MovementType[]).map((t) => (
            <option key={t} value={t}>
              {movementLabel[t]}
            </option>
          ))}
        </Select>
      </FilterBar>
      {list.isLoading ? (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Producto</Th>
                  <Th>Lote</Th>
                  <Th>Tipo</Th>
                  <Th numeric>Cantidad</Th>
                  <Th>Usuario</Th>
                  <Th>Nota</Th>
                </tr>
              </thead>
              <tbody>
                <SkeletonRows rows={10} cols={7} numeric={[4]} />
              </tbody>
            </Table>
          </div>
          <SkeletonList />
        </>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<ClipboardList />} title="Sin movimientos" />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Producto</Th>
                  <Th>Lote</Th>
                  <Th>Tipo</Th>
                  <Th numeric>Cantidad</Th>
                  <Th>Usuario</Th>
                  <Th>Nota</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((m) => (
                  <Tr key={m.id}>
                    <Td className="whitespace-nowrap">{dateTime(m.created_at)}</Td>
                    <Td className="font-medium">{m.product_name}</Td>
                    <Td className="text-xs">
                      <LotCode value={m.lot_number} />
                    </Td>
                    <Td>
                      {movementLabel[m.type]}
                      {m.reference_id ? <span className="text-xs text-faint"> #{m.reference_id}</span> : null}
                    </Td>
                    <Td numeric>
                      <MovementQty quantity={m.quantity} />
                    </Td>
                    <Td className="text-muted">{m.user_name}</Td>
                    <Td className="max-w-56 truncate text-muted">{m.notes ?? ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {list.data.data.map((m) => (
              <MobileListItem key={m.id} aside={<MovementQty quantity={m.quantity} />}>
                <p className="truncate font-medium text-ink">{m.product_name}</p>
                <p className="text-xs text-muted">
                  {movementLabel[m.type]} · {dateTime(m.created_at)}
                </p>
                <p className="text-xs text-faint">
                  <LotCode value={m.lot_number} />
                </p>
              </MobileListItem>
            ))}
          </MobileList>
          <Pagination page={page} pageSize={30} total={list.data.total} onChange={setPage} />
        </>
      )}
    </Card>
  )
}
