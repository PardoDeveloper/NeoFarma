import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Truck } from 'lucide-react'
import { transfersApi } from '@/api/endpoints'
import type { Transfer } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { date, dateTime, num } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Card,
  EmptyState,
  ErrorState,
  MiniStat,
  PageHeader,
  Pagination,
  SkeletonRows,
  SkeletonText,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Drawer } from '@/components/ui/drawer'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import { LotCode } from '@/components/LotCode'
import { NewTransferModal } from './NewTransferModal'

/**
 * Dirección del traspaso relativa a la sucursal activa: "Enviado a X" / "Recibido de Y".
 * En el consolidado ("Todas") no hay una sucursal de referencia: se muestra "Origen → Destino".
 */
function TransferDirection({ t, activeBranchId }: { t: Transfer; activeBranchId: number | null }) {
  if (activeBranchId == null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink">
        <span className="font-medium">{t.from_branch_name}</span>
        <ArrowRightLeft className="size-3.5 shrink-0 text-faint" aria-hidden />
        <span className="font-medium">{t.to_branch_name}</span>
      </span>
    )
  }
  const outgoing = t.from_branch_id === activeBranchId
  return outgoing ? (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink">
      <ArrowUpRight className="size-4 shrink-0 text-info-600 dark:text-info-400" aria-hidden />
      Enviado a <span className="font-medium">{t.to_branch_name}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink">
      <ArrowDownLeft className="size-4 shrink-0 text-ok-600 dark:text-ok-400" aria-hidden />
      Recibido de <span className="font-medium">{t.from_branch_name}</span>
    </span>
  )
}

export function TransfersPage() {
  const { current, isAll } = useBranch()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['transfers', page], queryFn: () => transfersApi.list({ page, page_size: 20 }) })
  const activeBranchId = current?.id ?? null

  return (
    <div>
      <PageHeader
        title="Traspasos"
        subtitle={
          isAll
            ? 'Movimientos de stock entre sucursales · todas las sucursales'
            : `Movimientos de stock entre sucursales${current ? ` · ${current.name}` : ''}`
        }
        actions={
          <Button icon={<Truck />} onClick={() => setCreating(true)}>
            Nuevo traspaso
          </Button>
        }
      />
      <Card>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.isLoading && !list.data?.data.length ? (
          <EmptyState
            icon={<Truck />}
            title="Sin traspasos registrados"
            message="Cuando envíe o reciba stock de otra sucursal, aparecerá aquí."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                Nuevo traspaso
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table containerClassName="max-h-[65vh]">
                <thead>
                  <tr>
                    <Th>Dirección</Th>
                    <Th>Fecha</Th>
                    <Th>Usuario</Th>
                    <Th numeric>Líneas / Unid.</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.isLoading ? (
                    <SkeletonRows rows={8} cols={4} numeric={[3]} />
                  ) : (
                    list.data!.data.map((t) => (
                      <Tr key={t.id} onClick={() => setSelected(t.id)} selected={selected === t.id}>
                        <Td>
                          <TransferDirection t={t} activeBranchId={activeBranchId} />
                        </Td>
                        <Td className="whitespace-nowrap text-ink-soft">{dateTime(t.created_at)}</Td>
                        <Td className="text-muted">{t.user_name}</Td>
                        <Td numeric>
                          {t.items_count} / {t.units_count}
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
            {list.isLoading ? (
              <SkeletonList />
            ) : (
              <MobileList>
                {list.data!.data.map((t) => (
                  <MobileListItem
                    key={t.id}
                    onClick={() => setSelected(t.id)}
                    selected={selected === t.id}
                    aside={
                      <>
                        <p className="font-semibold tabular-nums text-ink">{t.units_count} u.</p>
                        <p className="mt-1 text-xs text-muted tabular-nums">{t.items_count} líneas</p>
                      </>
                    }
                  >
                    <TransferDirection t={t} activeBranchId={activeBranchId} />
                    <p className="mt-1 text-xs text-muted">
                      {dateTime(t.created_at)} · {t.user_name}
                    </p>
                  </MobileListItem>
                ))}
              </MobileList>
            )}
            {list.data && <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />}
          </>
        )}
      </Card>
      <TransferDetailDrawer id={selected} activeBranchId={activeBranchId} onClose={() => setSelected(null)} />
      <NewTransferModal open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function TransferDetailDrawer({ id, activeBranchId, onClose }: { id: number | null; activeBranchId: number | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['transfer', id], queryFn: () => transfersApi.get(id!), enabled: !!id })
  const t = q.data

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={t ? `Traspaso #${t.id}` : `Traspaso #${id}`}
      description={t ? dateTime(t.created_at) : undefined}
      meta={t && <TransferDirection t={t} activeBranchId={activeBranchId} />}
      width="lg"
    >
      {!t ? (
        <SkeletonText lines={8} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Líneas" value={num(t.items_count)} />
            <MiniStat label="Unidades traspasadas" value={num(t.units_count)} tone="brand" />
          </div>
          <div>
            <p className="section-label mb-2">Productos</p>
            <Table containerClassName="rounded-xl border border-line">
              <thead>
                <tr>
                  <Th>Producto</Th>
                  <Th>Lote</Th>
                  <Th>Vencimiento</Th>
                  <Th numeric>Cantidad</Th>
                </tr>
              </thead>
              <tbody>
                {t.items?.map((it) => (
                  <Tr key={`${it.product_id}-${it.from_lot_id}`}>
                    <Td>
                      <p className="font-medium text-ink">{it.product_name}</p>
                      <p className="font-mono text-xs text-muted">{it.product_sku}</p>
                    </Td>
                    <Td className="text-xs">
                      <LotCode value={it.lot_number} />
                    </Td>
                    <Td>{date(it.expiry_date)}</Td>
                    <Td numeric className="font-semibold">
                      {it.quantity}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          {t.notes && (
            <p className="rounded-lg bg-subtle/60 px-3 py-2 text-sm text-muted">
              <span className="font-medium text-ink-soft">Notas: </span>
              {t.notes}
            </p>
          )}
          <p className="text-xs text-muted">Registrado por {t.user_name}</p>
        </div>
      )}
    </Drawer>
  )
}
