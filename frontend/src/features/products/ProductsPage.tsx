import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArchiveX, Beaker, Package, Pencil, Plus, X } from 'lucide-react'
import { catalogApi, inventoryApi } from '@/api/endpoints'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import { useDebounce } from '@/lib/hooks'
import { clp, date, dateTime, dose, dosageFormLabel, movementLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/button'
import { Select } from '@/components/ui/form'
import { FilterBar, FilterChip, SearchField } from '@/components/ui/filters'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  MiniStat,
  PageHeader,
  Pagination,
  RowActions,
  SkeletonRows,
  SkeletonText,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Drawer } from '@/components/ui/drawer'
import { BranchBadge, ExpiryBadge, MovementQty, SaleConditionBadge, StockBadge } from '@/components/badges'
import { expiryStatusFromDays } from '@/lib/expiry'
import { ProductFormModal } from './ProductFormModal'
import type { Product } from '@/api/types'
import { LotCode } from '@/components/LotCode'

export function ProductsPage() {
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Product | undefined>()
  const [formOpen, setFormOpen] = useState(false)
  const lowStock = params.get('low_stock') === 'true'
  const idParam = params.get('id')
  const selectedId = idParam ? Number(idParam) : null
  const q = useDebounce(search)

  function openProduct(id: number) {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('id', String(id))
      return next
    })
  }
  function closeProduct() {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('id')
      return next
    })
  }
  function toggleLowStock() {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (lowStock) next.delete('low_stock')
      else next.set('low_stock', 'true')
      return next
    })
    setPage(1)
  }

  const categories = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories })
  const list = useQuery({
    queryKey: ['products', { q, categoryId, lowStock, includeInactive, page }],
    queryFn: () =>
      catalogApi.products({
        q,
        category_id: categoryId,
        low_stock: lowStock || undefined,
        include_inactive: includeInactive || undefined,
        page,
        page_size: 20,
      }),
    placeholderData: (prev) => prev,
  })
  const canEdit = can('quimico', 'bodega')
  const hasFilters = !!q || !!categoryId || lowStock || includeInactive

  function clearFilters() {
    setSearch('')
    setCategoryId('')
    setIncludeInactive(false)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('low_stock')
      return next
    })
    setPage(1)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setFormOpen(true)
  }

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle="Catálogo de medicamentos e insumos, precios, condición de venta y stock"
        actions={
          canEdit && (
            <Button
              icon={<Plus />}
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
            >
              Nuevo producto
            </Button>
          )
        }
      />
      <Card>
        <FilterBar>
          <SearchField
            autoFocus
            placeholder="Buscar por nombre, principio activo, laboratorio, SKU o código"
            value={search}
            onValueChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            aria-label="Buscar producto"
          />
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value)
              setPage(1)
            }}
            className="w-52"
            aria-label="Categoría"
          >
            <option value="">Todas las categorías</option>
            {categories.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.products})
              </option>
            ))}
          </Select>
          <FilterChip active={lowStock} onClick={toggleLowStock} icon={<AlertTriangle />}>
            Stock bajo
          </FilterChip>
          <FilterChip active={includeInactive} onClick={() => setIncludeInactive((v) => !v)} icon={<ArchiveX />}>
            Inactivos
          </FilterChip>
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={<X />} onClick={clearFilters}>
              Limpiar
            </Button>
          )}
        </FilterBar>
        {list.isLoading ? (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Producto</Th>
                    <Th>Laboratorio</Th>
                    <Th>Categoría</Th>
                    <Th>Condición</Th>
                    <Th numeric>Precio</Th>
                    <Th>Stock</Th>
                    <Th>Próx. vencimiento</Th>
                    {canEdit && <Th className="w-12" />}
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={8} cols={canEdit ? 8 : 7} numeric={[4]} />
                </tbody>
              </Table>
            </div>
            <SkeletonList />
          </>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.data.length ? (
          <EmptyState
            icon={<Package />}
            title="No se encontraron productos"
            message="Pruebe con otro término o limpie los filtros."
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Producto</Th>
                    <Th>Laboratorio</Th>
                    <Th>Categoría</Th>
                    <Th>Condición</Th>
                    <Th numeric>Precio</Th>
                    <Th>Stock</Th>
                    <Th>Próx. vencimiento</Th>
                    {canEdit && <Th className="w-12" />}
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((p) => (
                    <Tr
                      key={p.id}
                      onClick={() => openProduct(p.id)}
                      selected={p.id === selectedId}
                      className={!p.active ? 'opacity-60' : undefined}
                    >
                      <Td>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-ink">{p.name}</p>
                          {p.is_bioequivalent && (
                            <Badge tone="amber" size="sm" title="Bioequivalente">
                              BE
                            </Badge>
                          )}
                          {p.is_generic && (
                            <Badge tone="info" size="sm" title="Genérico">
                              GEN
                            </Badge>
                          )}
                          {!p.active && (
                            <Badge size="sm" title="Producto inactivo">
                              Inactivo
                            </Badge>
                          )}
                        </div>
                        <p className="font-mono text-xs text-muted">
                          {p.sku}
                          {(p.active_ingredient || p.presentation) && (
                            <span className="font-sans"> · {[p.active_ingredient, p.presentation].filter(Boolean).join(' · ')}</span>
                          )}
                        </p>
                      </Td>
                      <Td className="text-muted">{p.laboratory ?? '—'}</Td>
                      <Td className="text-muted">{p.category_name ?? '—'}</Td>
                      <Td>
                        <SaleConditionBadge value={p.sale_condition} />
                      </Td>
                      <Td numeric className="font-semibold">
                        {clp(p.price)}
                      </Td>
                      <Td>
                        <StockBadge stock={p.stock_sellable} min={p.min_stock} />
                      </Td>
                      <Td className="text-muted">{date(p.next_expiry)}</Td>
                      {canEdit && (
                        <Td onClick={(e) => e.stopPropagation()}>
                          <RowActions>
                            <IconButton label={`Editar ${p.name}`} onClick={() => openEdit(p)}>
                              <Pencil />
                            </IconButton>
                          </RowActions>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <MobileList>
              {list.data.data.map((p) => (
                <MobileListItem
                  key={p.id}
                  onClick={() => openProduct(p.id)}
                  selected={p.id === selectedId}
                  dimmed={!p.active}
                  aside={
                    <>
                      <p className="font-semibold tabular-nums text-ink">{clp(p.price)}</p>
                      <p className="mt-1 text-xs text-muted">{p.next_expiry ? date(p.next_expiry) : '—'}</p>
                    </>
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-medium text-ink">{p.name}</p>
                    {p.is_bioequivalent && (
                      <Badge tone="amber" size="sm">
                        BE
                      </Badge>
                    )}
                    {p.is_generic && (
                      <Badge tone="info" size="sm">
                        GEN
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-muted">{p.sku}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <SaleConditionBadge value={p.sale_condition} />
                    <StockBadge stock={p.stock_sellable} min={p.min_stock} />
                  </div>
                </MobileListItem>
              ))}
            </MobileList>
            <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Card>
      <ProductDetailDrawer id={selectedId} onClose={closeProduct} onEdit={openEdit} canEdit={canEdit} />
      <ProductFormModal open={formOpen} onClose={() => setFormOpen(false)} product={editing} />
    </div>
  )
}

function ProductDetailDrawer({
  id,
  onClose,
  onEdit,
  canEdit,
}: {
  id: number | null
  onClose: () => void
  onEdit: (p: Product) => void
  canEdit: boolean
}) {
  const { isAll } = useBranch()
  const [tab, setTab] = useState<'lotes' | 'movimientos'>('lotes')
  const q = useQuery({ queryKey: ['product', id], queryFn: () => catalogApi.product(id!), enabled: !!id })
  const movs = useQuery({
    queryKey: ['movements', id],
    queryFn: () => inventoryApi.movements({ product_id: id, page_size: 30 }),
    enabled: !!id && tab === 'movimientos',
  })
  const p = q.data
  const net = p ? Math.round(p.price / 1.19) : 0
  const margin = p && net > 0 ? Math.round(((net - (p.cost ?? 0)) / net) * 100) : 0
  const stockMax = p ? Math.max(p.min_stock * 2, p.stock_sellable, 1) : 1
  const stockPct = p ? Math.min(100, Math.round((p.stock_sellable / stockMax) * 100)) : 0
  const stockTone = !p ? 'ok' : p.stock_sellable <= 0 ? 'danger' : p.stock_sellable <= p.min_stock ? 'warn' : 'ok'

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={p?.name ?? (q.isLoading ? 'Cargando…' : 'Producto')}
      description={p?.laboratory ?? undefined}
      meta={
        p && (
          <>
            <span className="font-mono text-xs text-muted">{p.sku}</span>
            {p.barcode && <span className="font-mono text-xs text-faint">· {p.barcode}</span>}
            <SaleConditionBadge value={p.sale_condition} />
            {p.is_bioequivalent && <Badge tone="amber">Bioequivalente</Badge>}
            {p.is_generic && <Badge tone="info">Genérico</Badge>}
            {!p.active && <Badge>Inactivo</Badge>}
          </>
        )
      }
      actions={
        p &&
        canEdit && (
          <IconButton label={`Editar ${p.name}`} size="md" onClick={() => onEdit(p)}>
            <Pencil />
          </IconButton>
        )
      }
      toolbar={
        p && (
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'lotes', label: 'Lotes', icon: <Beaker />, count: p.lots.length },
              { value: 'movimientos', label: 'Movimientos' },
            ]}
            size="sm"
          />
        )
      }
    >
      {!p ? (
        <SkeletonText lines={6} />
      ) : (
        <div className="space-y-5">
          {p.category_name && (
            <div className="flex flex-wrap gap-1.5">
              <Badge>{p.category_name}</Badge>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2.5">
            <MiniStat label="Precio venta" value={clp(p.price)} />
            <MiniStat label="Costo neto" value={clp(p.cost)} />
            <MiniStat label="Margen" value={`${margin}%`} tone={margin < 15 ? 'warn' : 'ok'} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line px-3.5 py-3 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-muted">{p.ingredients.length > 1 ? 'Principios activos' : 'Principio activo'}</dt>
              {p.ingredients.length === 0 ? (
                <dd className="text-faint">—</dd>
              ) : (
                <dd>
                  <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                    {p.ingredients.map((i) => (
                      <li key={i.name} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                        <span className="truncate font-medium text-ink">{i.name}</span>
                        <span className="shrink-0 tabular-nums text-ink-soft">
                          {i.dose != null && i.unit ? `${dose(i.dose)} ${i.unit}` : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              )}
            </div>
            <SpecItem label="Forma farmacéutica" value={p.dosage_form && dosageFormLabel[p.dosage_form]} />
            <SpecItem label="Presentación" value={p.presentation} />
            <SpecItem label="Registro ISP" value={p.isp_registry} mono />
            <SpecItem
              label="Tipo"
              value={[p.is_generic && 'Genérico', p.is_bioequivalent && 'Bioequivalente'].filter(Boolean).join(' · ') || 'De marca'}
            />
          </dl>
          <div className="rounded-xl border border-line bg-subtle/60 px-3.5 py-3">
            <div className="flex items-baseline justify-between">
              <p className="section-label">Stock vendible vs. mínimo</p>
              <p className="text-xs text-muted">
                mínimo <span className="font-medium tabular-nums text-ink-soft">{p.min_stock} u.</span>
              </p>
            </div>
            <p
              className={cn(
                'mt-1 text-2xl font-bold tabular-nums',
                stockTone === 'danger' && 'text-danger-600 dark:text-danger-400',
                stockTone === 'warn' && 'text-warn-700 dark:text-warn-400',
                stockTone === 'ok' && 'text-ok-700 dark:text-ok-400',
              )}
            >
              {p.stock_sellable} u.
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line/70">
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  stockTone === 'danger' && 'bg-danger-500',
                  stockTone === 'warn' && 'bg-warn-500',
                  stockTone === 'ok' && 'bg-ok-500',
                )}
                style={{ width: `${Math.max(stockPct, p.stock_sellable > 0 ? 4 : 0)}%` }}
              />
            </div>
          </div>

          {tab === 'lotes' ? (
            p.lots.length === 0 ? (
              <EmptyState icon={<Beaker />} title="Sin lotes con stock" compact />
            ) : (
              <Table containerClassName="max-h-[50vh] rounded-xl border border-line">
                <thead>
                  <tr>
                    <Th>Lote</Th>
                    {isAll && <Th>Sucursal</Th>}
                    <Th>Vencimiento</Th>
                    <Th numeric>Disponible</Th>
                    <Th numeric>Costo</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.lots.map((l) => {
                    const days = Math.floor(
                      (new Date(l.expiry_date.slice(0, 10)).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000,
                    )
                    return (
                      <Tr key={l.id}>
                        <Td className="text-xs">
                          <LotCode value={l.lot_number} />
                        </Td>
                        {isAll && (
                          <Td>
                            <BranchBadge name={l.branch_name} />
                          </Td>
                        )}
                        <Td>{date(l.expiry_date)}</Td>
                        <Td numeric>
                          {l.qty_available} <span className="text-faint">/ {l.qty_initial}</span>
                        </Td>
                        <Td numeric>{clp(l.unit_cost)}</Td>
                        <Td>
                          <ExpiryBadge status={expiryStatusFromDays(days)} />
                        </Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </Table>
            )
          ) : movs.isLoading ? (
            <SkeletonText lines={6} />
          ) : !movs.data?.data.length ? (
            <EmptyState title="Sin movimientos" compact />
          ) : (
            <Table containerClassName="max-h-[50vh] rounded-xl border border-line">
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Tipo</Th>
                  <Th>Lote</Th>
                  {isAll && <Th>Sucursal</Th>}
                  <Th numeric>Cantidad</Th>
                  <Th>Usuario</Th>
                </tr>
              </thead>
              <tbody>
                {movs.data.data.map((m) => (
                  <Tr key={m.id}>
                    <Td className="whitespace-nowrap">{dateTime(m.created_at)}</Td>
                    <Td>
                      {movementLabel[m.type]}
                      {m.reference_id ? <span className="text-xs text-faint"> #{m.reference_id}</span> : null}
                    </Td>
                    <Td className="text-xs">
                      <LotCode value={m.lot_number} />
                    </Td>
                    {isAll && (
                      <Td>
                        <BranchBadge name={m.branch_name} />
                      </Td>
                    )}
                    <Td numeric>
                      <MovementQty quantity={m.quantity} />
                    </Td>
                    <Td className="text-muted">{m.user_name}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </Drawer>
  )
}

function SpecItem({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('truncate font-medium text-ink', mono && 'font-mono text-[13px]', !value && 'font-normal text-faint')}>
        {value || '—'}
      </dd>
    </div>
  )
}
