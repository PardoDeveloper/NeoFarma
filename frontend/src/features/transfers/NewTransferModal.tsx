import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRightLeft, Package, Plus, Trash2, Truck, X } from 'lucide-react'
import { inventoryApi, transfersApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { Branch, LotView, Product } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { date } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Callout, EmptyState, SkeletonText } from '@/components/ui/display'
import { Modal, ModalActions } from '@/components/ui/modal'
import { ProductPicker } from '@/components/ProductPicker'
import { LotCode } from '@/components/LotCode'
import { RequireBranch } from '@/components/RequireBranch'

interface Line {
  key: number
  product: Product
  lot: LotView
  quantity: string
}

let lineKey = 0

/** Mensajes de apoyo por código de error del backend, además del mensaje ya en español de la API. */
const errorHints: Record<string, string> = {
  insufficient_stock: 'Actualice la cantidad o elija otro lote e intente nuevamente.',
  expired_lot: 'Ese lote está vencido; elija otro.',
  duplicate_lot: 'Ese lote ya está en la lista de líneas.',
  same_branch: 'Elija una sucursal de destino distinta a la actual.',
  invalid_branch: 'La sucursal de destino no es válida.',
}

/**
 * Traspaso de stock entre sucursales: lotes de la sucursal activa (origen) hacia una sucursal de
 * destino distinta. El modal se desmonta al cerrar (ver `Modal`), por lo que el formulario siempre
 * arranca limpio en cada apertura.
 */
export function NewTransferModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo traspaso"
      description="Mueva stock de esta sucursal a otra en una sola operación"
      size="lg"
      icon={<Truck />}
    >
      <NewTransferForm onDone={onClose} />
    </Modal>
  )
}

function NewTransferForm({ onDone }: { onDone: () => void }) {
  const { branches, current } = useBranch()
  return (
    <RequireBranch action="crear un traspaso">
      {current && (
        <TransferFields origin={current} destinations={branches.filter((b) => b.active && b.id !== current.id)} onDone={onDone} />
      )}
    </RequireBranch>
  )
}

function TransferFields({ origin, destinations, onDone }: { origin: Branch; destinations: Branch[]; onDone: () => void }) {
  const qc = useQueryClient()
  const [toBranchId, setToBranchId] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pickedProduct, setPickedProduct] = useState<Product | null>(null)
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null)
  const [qty, setQty] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const lotsQ = useQuery({
    queryKey: ['transfer-lots', pickedProduct?.id],
    queryFn: () => inventoryApi.lots({ product_id: pickedProduct!.id, page_size: 50 }),
    enabled: !!pickedProduct,
  })
  const usedLotIds = new Set(lines.map((l) => l.lot.id))
  // Solo lotes vigentes con stock de esta sucursal, que no estén ya en una línea.
  const availableLots = (lotsQ.data?.data ?? []).filter(
    (l) => l.expiry_status !== 'vencido' && l.qty_available > 0 && !usedLotIds.has(l.id),
  )
  const selectedLot = availableLots.find((l) => l.id === selectedLotId) ?? null
  const qtyInvalid = qty !== '' && selectedLot && (!(Number(qty) > 0) || Number(qty) > selectedLot.qty_available)

  function cancelProduct() {
    setPickedProduct(null)
    setSelectedLotId(null)
    setQty('')
  }
  function addLine() {
    if (!pickedProduct || !selectedLot) return
    const n = Number(qty)
    if (!(n > 0) || n > selectedLot.qty_available) return
    setLines((ls) => [...ls, { key: ++lineKey, product: pickedProduct, lot: selectedLot, quantity: qty }])
    cancelProduct()
  }
  function updateQuantity(key: number, value: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity: value.replace(/\D/g, '') } : l)))
  }
  function removeLine(key: number) {
    setLines((ls) => ls.filter((l) => l.key !== key))
  }

  const totalUnits = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const destBranch = destinations.find((b) => String(b.id) === toBranchId)
  const lineInvalid = (l: Line) => !(Number(l.quantity) > 0) || Number(l.quantity) > l.lot.qty_available
  const hasErrors = !toBranchId || lines.length === 0 || lines.some(lineInvalid)

  const create = useMutation({
    mutationFn: () =>
      transfersApi.create({
        to_branch_id: Number(toBranchId),
        notes: notes.trim() || null,
        items: lines.map((l) => ({ lot_id: l.lot.id, quantity: Number(l.quantity) })),
      }),
    onSuccess: (t) => {
      toast.success(`Traspaso #${t.id} registrado: ${t.units_count} unidades a ${t.to_branch_name}`)
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['lots'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      onDone()
    },
    onError: (e) => toast.error(errorMessage(e), { description: e instanceof ApiError ? errorHints[e.code] : undefined }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (hasErrors) return toast.error('Elija la sucursal de destino y revise las líneas')
    create.mutate()
  }

  if (destinations.length === 0) {
    return (
      <EmptyState
        icon={<Truck />}
        title="No hay otra sucursal activa"
        message="Para crear un traspaso se necesita al menos otra sucursal activa distinta a la actual."
      />
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field
        label="Sucursal de destino"
        required
        error={submitted && !toBranchId ? 'Seleccione una sucursal' : undefined}
        hint={`Origen: ${origin.name}`}
      >
        {(id) => (
          <Select id={id} value={toBranchId} onChange={(e) => setToBranchId(e.target.value)} invalid={submitted && !toBranchId}>
            <option value="">Seleccione…</option>
            {destinations.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div>
        <p className="mb-2 text-sm font-medium text-ink-soft">Productos a traspasar</p>
        <ProductPicker
          onSelect={(p) => {
            setPickedProduct(p)
            setSelectedLotId(null)
            setQty('')
          }}
          placeholder="Buscar producto por nombre, SKU o código…"
        />

        {pickedProduct && (
          <div className="mt-3 rounded-xl border border-line bg-subtle/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-ink">
                <Package className="size-3.5 shrink-0 text-muted" aria-hidden />
                {pickedProduct.name}
              </p>
              <IconButton label="Cancelar selección" size="sm" onClick={cancelProduct}>
                <X />
              </IconButton>
            </div>
            {lotsQ.isLoading ? (
              <SkeletonText lines={2} />
            ) : availableLots.length === 0 ? (
              <EmptyState
                compact
                tone="amber"
                icon={<AlertTriangle />}
                title="Sin lotes disponibles"
                message="No hay lotes vigentes con stock de este producto en la sucursal actual."
              />
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableLots.map((l) => {
                    const active = selectedLotId === l.id
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setSelectedLotId(l.id)}
                        aria-pressed={active}
                        className={cn(
                          'flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left text-sm transition-colors',
                          active
                            ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                            : 'border-line bg-surface hover:border-line-strong hover:bg-subtle',
                        )}
                      >
                        <span className="font-medium text-ink">
                          <LotCode value={l.lot_number} labeled />
                        </span>
                        <span className="text-xs text-muted">
                          Vence {date(l.expiry_date)} · disponible{' '}
                          <span className="font-medium text-ink-soft tabular-nums">{l.qty_available}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {selectedLot && (
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <Field label="Cantidad" className="w-28" error={qtyInvalid ? `Máx. ${selectedLot.qty_available}` : undefined}>
                      {(id) => (
                        <Input
                          id={id}
                          autoFocus
                          inputMode="numeric"
                          value={qty}
                          onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))}
                          invalid={!!qtyInvalid}
                        />
                      )}
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      icon={<Plus />}
                      disabled={!(Number(qty) > 0) || Number(qty) > selectedLot.qty_available}
                      onClick={addLine}
                    >
                      Agregar línea
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <EmptyState
          compact
          icon={<Truck />}
          title="Sin productos agregados"
          message="Busque un producto y elija el lote y cantidad a traspasar."
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {lines.map((l) => {
            const invalid = submitted && lineInvalid(l)
            return (
              <li
                key={l.key}
                className={cn('flex flex-wrap items-center gap-3 px-3 py-2.5', invalid && 'bg-danger-50/40 dark:bg-danger-500/8')}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{l.product.name}</p>
                  <p className="text-xs text-muted">
                    <LotCode value={l.lot.lot_number} labeled /> · vence {date(l.lot.expiry_date)}
                  </p>
                </div>
                <Input
                  aria-label={`Cantidad de ${l.product.name}`}
                  inputMode="numeric"
                  inputSize="sm"
                  className="w-20 text-right tabular-nums"
                  value={l.quantity}
                  onChange={(e) => updateQuantity(l.key, e.target.value)}
                  invalid={invalid}
                />
                <span className="w-12 shrink-0 text-xs text-faint tabular-nums">/ {l.lot.qty_available}</span>
                <IconButton label={`Quitar ${l.product.name}`} variant="danger" onClick={() => removeLine(l.key)}>
                  <Trash2 />
                </IconButton>
              </li>
            )
          })}
        </ul>
      )}

      <Field label="Notas" hint="Opcional">
        {(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />}
      </Field>

      {destBranch && totalUnits > 0 && (
        <Callout tone="info" icon={<ArrowRightLeft />}>
          Se moverán <strong className="tabular-nums">{totalUnits}</strong> unidades de <strong>{origin.name}</strong> a{' '}
          <strong>{destBranch.name}</strong>.
        </Callout>
      )}

      <ModalActions>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" loading={create.isPending} icon={<Truck />}>
          Confirmar traspaso
        </Button>
      </ModalActions>
    </form>
  )
}
