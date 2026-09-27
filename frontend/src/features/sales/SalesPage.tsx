import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Ban, Printer } from 'lucide-react'
import { salesApi } from '@/api/endpoints'
import { errorMessage } from '@/api/client'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import { useDebounce } from '@/lib/hooks'
import { addDays, clp, dateTime, formatRut, isoDate } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/form'
import { DateRange, FilterBar, SearchField } from '@/components/ui/filters'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Segmented,
  SkeletonRows,
  SkeletonText,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Modal, ModalActions } from '@/components/ui/modal'
import { Drawer } from '@/components/ui/drawer'
import { BranchBadge, PaymentBadge } from '@/components/badges'
import { SaleReceipt } from './SaleReceipt'

const statusItems = [
  { value: '', label: 'Todas' },
  { value: 'completada', label: 'Completadas' },
  { value: 'anulada', label: 'Anuladas' },
] as const

const methodItems = [
  { value: '', label: 'Todos' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'debito', label: 'Débito' },
  { value: 'credito', label: 'Crédito' },
  { value: 'transferencia', label: 'Transferencia' },
] as const

export function SalesPage() {
  const [from, setFrom] = useState(isoDate(addDays(new Date(), -7)))
  const [to, setTo] = useState(isoDate())
  const [status, setStatus] = useState<(typeof statusItems)[number]['value']>('')
  const [method, setMethod] = useState<(typeof methodItems)[number]['value']>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const q = useDebounce(search)

  const list = useQuery({
    queryKey: ['sales', { from, to, status, method, q, page }],
    queryFn: () => salesApi.list({ from, to, status, payment_method: method, q, page, page_size: 20 }),
  })

  // El cajero solo recibe sus propias ventas (lo impone la API): la vista se titula y simplifica en consecuencia.
  const ownOnly = useAuth().user?.role === 'cajero'
  // Consolidado del admin ("Todas las sucursales"): cada fila necesita decir de qué sucursal es.
  const { isAll } = useBranch()
  const cols = 8 + (isAll ? 1 : 0)
  const numericCols = isAll ? [5, 7] : [4, 6]

  const reset =
    <T,>(fn: (v: T) => void) =>
    (v: T) => {
      fn(v)
      setPage(1)
    }

  return (
    <div>
      <PageHeader
        title={ownOnly ? 'Mis ventas' : 'Ventas'}
        subtitle={
          ownOnly
            ? 'Tus ventas registradas, detalle y reimpresión de comprobantes'
            : 'Historial de ventas, detalle, reimpresión y anulaciones'
        }
      />
      <Card>
        <FilterBar>
          <SearchField placeholder="N° de venta, cliente o RUT" value={search} onValueChange={reset(setSearch)} aria-label="Buscar venta" />
          <DateRange from={from} to={to} onFromChange={reset(setFrom)} onToChange={reset(setTo)} />
          <Segmented
            aria-label="Filtrar por estado"
            value={status}
            onChange={reset(setStatus)}
            items={[...statusItems]}
            className="p-[3px]"
          />
          <Select
            aria-label="Filtrar por medio de pago"
            value={method}
            onChange={(e) => reset(setMethod)(e.target.value as (typeof methodItems)[number]['value'])}
            className="w-48"
          >
            {methodItems.map((m) => (
              <option key={m.value} value={m.value}>
                {m.value ? m.label : 'Todos los medios'}
              </option>
            ))}
          </Select>
        </FilterBar>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.isLoading && !list.data?.data.length ? (
          <EmptyState title="No hay ventas para los filtros seleccionados" message="Ajuste el rango de fechas o limpie los filtros." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table containerClassName="max-h-[65vh]">
                <thead>
                  <tr>
                    <Th>N°</Th>
                    <Th>Fecha</Th>
                    {isAll && <Th>Sucursal</Th>}
                    <Th>{ownOnly ? 'Caja' : 'Caja / Vendedor'}</Th>
                    <Th>Cliente</Th>
                    <Th numeric>Unid.</Th>
                    <Th>Pago</Th>
                    <Th numeric>Total</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.isLoading ? (
                    <SkeletonRows rows={10} cols={cols} numeric={numericCols} />
                  ) : (
                    list.data!.data.map((s) => (
                      <Tr key={s.id} onClick={() => setSelected(s.id)} selected={selected === s.id}>
                        <Td className="font-mono text-[13px] font-medium text-brand-700 dark:text-brand-300">#{s.id}</Td>
                        <Td className="whitespace-nowrap text-ink-soft">{dateTime(s.created_at)}</Td>
                        {isAll && (
                          <Td>
                            <BranchBadge name={s.branch_name} />
                          </Td>
                        )}
                        <Td>
                          <p>{s.register_name}</p>
                          {!ownOnly && <p className="text-xs text-muted">{s.user_name}</p>}
                        </Td>
                        <Td className="text-ink-soft">{s.customer_name ?? (s.customer_rut ? formatRut(s.customer_rut) : '—')}</Td>
                        <Td numeric>{s.items_count}</Td>
                        <Td>
                          <PaymentBadge method={s.payment_method} />
                        </Td>
                        <Td numeric className={`font-semibold ${s.status === 'anulada' ? 'text-faint line-through' : 'text-ink'}`}>
                          {clp(s.total)}
                        </Td>
                        <Td>
                          {s.status === 'anulada' ? (
                            <Badge tone="danger" dot>
                              Anulada
                            </Badge>
                          ) : (
                            <Badge tone="ok" dot>
                              Completada
                            </Badge>
                          )}
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
            {list.isLoading ? (
              <SkeletonList rows={8} />
            ) : (
              <MobileList>
                {list.data!.data.map((s) => (
                  <MobileListItem
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    selected={selected === s.id}
                    dimmed={s.status === 'anulada'}
                    aside={
                      <>
                        <p className={`font-semibold tabular-nums ${s.status === 'anulada' ? 'text-faint line-through' : 'text-ink'}`}>
                          {clp(s.total)}
                        </p>
                        <p className="mt-1 text-xs text-muted tabular-nums">{s.items_count} u.</p>
                      </>
                    }
                  >
                    <p className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-medium text-brand-700 dark:text-brand-300">#{s.id}</span>
                      <span className="text-xs text-muted">{dateTime(s.created_at)}</span>
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-soft">
                      {ownOnly ? s.register_name : `${s.register_name} · ${s.user_name}`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <PaymentBadge method={s.payment_method} />
                      {isAll && <BranchBadge name={s.branch_name} />}
                      {s.status === 'anulada' && (
                        <Badge tone="danger" dot>
                          Anulada
                        </Badge>
                      )}
                    </div>
                  </MobileListItem>
                ))}
              </MobileList>
            )}
            {list.data && <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
          </>
        )}
      </Card>
      <SaleDetailDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function SaleDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const { isAll } = useBranch()
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const q = useQuery({ queryKey: ['sale', id], queryFn: () => salesApi.get(id!), enabled: !!id })
  const voidM = useMutation({
    mutationFn: () => salesApi.void(id!, reason),
    onSuccess: () => {
      toast.success('Venta anulada y stock restaurado')
      setVoiding(false)
      setReason('')
      qc.invalidateQueries({ queryKey: ['sales'] })
      qc.invalidateQueries({ queryKey: ['sale', id] })
      qc.invalidateQueries({ queryKey: ['cash'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const sale = q.data

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={sale ? `Venta #${sale.id}` : `Venta #${id}`}
      description={sale ? dateTime(sale.created_at) : undefined}
      meta={
        sale && (
          <>
            <PaymentBadge method={sale.payment_method} />
            {isAll && <BranchBadge name={sale.branch_name} />}
            {sale.status === 'anulada' ? (
              <Badge tone="danger" dot>
                Anulada
              </Badge>
            ) : (
              <Badge tone="ok" dot>
                Completada
              </Badge>
            )}
          </>
        )
      }
      actions={
        sale && (
          <IconButton label="Reimprimir comprobante" size="md" onClick={() => window.print()}>
            <Printer />
          </IconButton>
        )
      }
      width="lg"
      footer={
        sale && (
          <>
            {can('quimico') && sale.status === 'completada' && (
              <Button variant="danger" icon={<Ban />} onClick={() => setVoiding(true)} className="mr-auto">
                Anular venta
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Cerrar
            </Button>
          </>
        )
      }
    >
      {q.isLoading || !sale ? (
        <SkeletonText lines={8} />
      ) : (
        <div className="space-y-6">
          {sale.status === 'anulada' && (
            <Callout tone="danger" icon={<Ban />} title={`Venta anulada el ${dateTime(sale.voided_at)}`}>
              Motivo: {sale.void_reason}
            </Callout>
          )}
          <div>
            <p className="section-label mb-2">Productos</p>
            <Table containerClassName="rounded-lg border border-line">
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th numeric>Cant.</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {sale.items?.map((it) => (
                  <tr key={it.id}>
                    <Td>
                      <p className="font-medium text-ink">{it.product_name}</p>
                      <p className="text-xs text-muted">
                        {clp(it.unit_price)} c/u · Lotes: <span className="font-mono">{it.lots || '—'}</span>
                      </p>
                    </Td>
                    <Td numeric>{it.quantity}</Td>
                    <Td numeric className="font-semibold text-ink">
                      {clp(it.total)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {sale.prescription_number && (
            <Callout tone="rx" title={`Receta N° ${sale.prescription_number}`}>
              Dr(a). {sale.prescriber_name}
            </Callout>
          )}
          <div>
            <p className="section-label mb-2">Comprobante</p>
            <div className="overflow-hidden rounded-lg border border-line">
              <SaleReceipt sale={sale} />
            </div>
          </div>
        </div>
      )}

      <Modal
        open={voiding}
        onClose={() => setVoiding(false)}
        title="Anular venta"
        description="El stock se devolverá a los lotes originales. Esta acción no se puede deshacer."
        size="sm"
        icon={<AlertTriangle />}
        iconTone="danger"
      >
        <Field label="Motivo de la anulación" required hint="Mínimo 5 caracteres">
          {(fid) => <Textarea id={fid} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <ModalActions>
          <Button variant="secondary" onClick={() => setVoiding(false)}>
            Cancelar
          </Button>
          <Button variant="danger" loading={voidM.isPending} disabled={reason.trim().length < 5} onClick={() => voidM.mutate()}>
            Confirmar anulación
          </Button>
        </ModalActions>
      </Modal>
    </Drawer>
  )
}
