import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PackagePlus, PackageSearch } from 'lucide-react'
import { purchasesApi } from '@/api/endpoints'
import { useBranch } from '@/lib/branch-context'
import { useDebounce } from '@/lib/hooks'
import { clp, date, dateTime, documentLabel, formatRut } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { FilterBar, SearchField } from '@/components/ui/filters'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Skeleton,
  SkeletonRows,
  SummaryRow,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Drawer } from '@/components/ui/drawer'
import { LotCode } from '@/components/LotCode'
import { BranchBadge } from '@/components/badges'

export function PurchasesPage() {
  const { isAll } = useBranch()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const q = useDebounce(search)
  const list = useQuery({
    queryKey: ['purchases', q, page],
    queryFn: () => purchasesApi.list({ q, page, page_size: 20 }),
    placeholderData: (prev) => prev,
  })

  return (
    <div>
      <PageHeader
        title="Ingreso de mercadería"
        subtitle="Recepción de facturas y guías de proveedores con registro de lotes y vencimientos"
        actions={
          <Link to="/ingresos/nuevo">
            <Button icon={<PackagePlus />}>Nuevo ingreso</Button>
          </Link>
        }
      />
      <Card>
        <FilterBar>
          <SearchField
            placeholder="Buscar por N° de documento o proveedor"
            value={search}
            onValueChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            wrapperClassName="max-w-lg"
            aria-label="Buscar ingreso"
          />
        </FilterBar>
        {list.isLoading ? (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Recepción</Th>
                    {isAll && <Th>Sucursal</Th>}
                    <Th>Proveedor</Th>
                    <Th>Documento</Th>
                    <Th numeric>Líneas / Unid.</Th>
                    <Th numeric>Neto</Th>
                    <Th numeric>Total</Th>
                    <Th>Recibido por</Th>
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={8} cols={8 + (isAll ? 1 : 0)} numeric={isAll ? [5, 6, 7] : [4, 5, 6]} />
                </tbody>
              </Table>
            </div>
            <SkeletonList />
          </>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.data.length ? (
          <EmptyState
            icon={<PackageSearch />}
            title="Aún no hay ingresos"
            message="Registre el primer ingreso de mercadería para comenzar a llevar stock por lote."
            action={
              <Link to="/ingresos/nuevo">
                <Button size="sm">Registrar ingreso</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Recepción</Th>
                    {isAll && <Th>Sucursal</Th>}
                    <Th>Proveedor</Th>
                    <Th>Documento</Th>
                    <Th numeric>Líneas / Unid.</Th>
                    <Th numeric>Neto</Th>
                    <Th numeric>Total</Th>
                    <Th>Recibido por</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((p) => (
                    <Tr key={p.id} onClick={() => setSelected(p.id)} selected={p.id === selected}>
                      <Td className="font-mono text-[13px] font-medium text-brand-700 dark:text-brand-300">#{p.id}</Td>
                      <Td className="whitespace-nowrap text-ink-soft">{dateTime(p.created_at)}</Td>
                      {isAll && (
                        <Td>
                          <BranchBadge name={p.branch_name} />
                        </Td>
                      )}
                      <Td>
                        <p className="font-medium text-ink">{p.supplier_name}</p>
                        <p className="font-mono text-xs text-muted">{formatRut(p.supplier_rut)}</p>
                      </Td>
                      <Td>
                        <p>
                          {documentLabel[p.document_type]} N° <span className="font-mono">{p.document_number}</span>
                        </p>
                        <p className="text-xs text-muted">{date(p.document_date)}</p>
                      </Td>
                      <Td numeric>
                        {p.items_count} / {p.units_count}
                      </Td>
                      <Td numeric>{clp(p.net_amount)}</Td>
                      <Td numeric className="font-semibold">
                        {clp(p.total_amount)}
                      </Td>
                      <Td className="text-muted">{p.user_name}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <MobileList>
              {list.data.data.map((p) => (
                <MobileListItem
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  selected={p.id === selected}
                  aside={
                    <>
                      <p className="font-semibold tabular-nums text-ink">{clp(p.total_amount)}</p>
                      <p className="mt-1 text-xs text-muted tabular-nums">
                        {p.items_count} líneas · {p.units_count} u.
                      </p>
                    </>
                  }
                >
                  <p className="font-mono text-xs font-medium text-brand-700 dark:text-brand-300">#{p.id}</p>
                  <p className="mt-0.5 truncate font-medium text-ink">{p.supplier_name}</p>
                  <p className="text-xs text-muted">
                    {documentLabel[p.document_type]} N° <span className="font-mono">{p.document_number}</span> · {date(p.document_date)}
                  </p>
                  {isAll && (
                    <div className="mt-1.5">
                      <BranchBadge name={p.branch_name} />
                    </div>
                  )}
                </MobileListItem>
              ))}
            </MobileList>
            <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Card>
      <PurchaseDetailDrawer id={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export function PurchaseDetailDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { isAll } = useBranch()
  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => purchasesApi.get(id!), enabled: !!id })
  const p = q.data
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p ? `${documentLabel[p.document_type]} N° ${p.document_number}` : 'Ingreso'}
      description={p && `Ingreso #${p.id} · recibido ${dateTime(p.created_at)} por ${p.user_name}`}
      meta={
        p && (
          <>
            <span className="font-medium text-ink-soft">{p.supplier_name}</span>
            <span className="font-mono text-xs text-muted">{formatRut(p.supplier_rut)}</span>
            {isAll && <BranchBadge name={p.branch_name} />}
          </>
        )
      }
      width="xl"
    >
      {!p ? (
        <div className="space-y-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <Table containerClassName="rounded-xl border border-line">
            <thead>
              <tr>
                <Th>Producto</Th>
                <Th>Lote</Th>
                <Th>Vencimiento</Th>
                <Th numeric>Cantidad</Th>
                <Th numeric>Costo neto</Th>
                <Th numeric>Subtotal</Th>
              </tr>
            </thead>
            <tbody>
              {p.items?.map((it) => (
                <Tr key={it.id}>
                  <Td>
                    <p className="font-medium text-ink">{it.product_name}</p>
                    <p className="font-mono text-xs text-muted">{it.product_sku}</p>
                  </Td>
                  <Td className="text-xs">
                    <LotCode value={it.lot_number} />
                  </Td>
                  <Td>{date(it.expiry_date)}</Td>
                  <Td numeric>{it.quantity}</Td>
                  <Td numeric>{clp(it.unit_cost)}</Td>
                  <Td numeric className="font-semibold">
                    {clp(it.subtotal)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 ml-auto w-64 space-y-1.5">
            <SummaryRow label="Neto" value={clp(p.net_amount)} />
            <SummaryRow label="IVA 19%" value={clp(p.tax_amount)} />
            <SummaryRow label="Total" value={clp(p.total_amount)} strong />
          </div>
          {p.notes && (
            <p className="mt-4 rounded-lg bg-subtle/60 px-3 py-2 text-sm text-muted">
              <span className="font-medium text-ink-soft">Notas: </span>
              {p.notes}
            </p>
          )}
        </>
      )}
    </Drawer>
  )
}
