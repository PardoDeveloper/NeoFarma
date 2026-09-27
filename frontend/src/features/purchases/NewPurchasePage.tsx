import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, PackageCheck, Plus, Trash2 } from 'lucide-react'
import { suppliersApi, purchasesApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { DocumentType, Product } from '@/api/types'
import { addDays, clp, formatRut, isoDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import { ProductPicker } from '@/components/ProductPicker'
import { SupplierFormModal } from '@/features/suppliers/SuppliersPage'

interface Line {
  key: number
  product: Product
  lot_number: string
  expiry_date: string
  quantity: string
  unit_cost: string
}

let lineKey = 0

export function NewPurchasePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const suppliers = useQuery({ queryKey: ['suppliers', 'all-active'], queryFn: () => suppliersApi.list({ page_size: 100 }) })
  const [supplierId, setSupplierId] = useState('')
  const [docType, setDocType] = useState<DocumentType>('factura')
  const [docNumber, setDocNumber] = useState('')
  const [docDate, setDocDate] = useState(isoDate())
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [newSupplier, setNewSupplier] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const today = isoDate()

  const totals = useMemo(() => {
    const net = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0)
    const tax = Math.round(net * 0.19)
    return { net, tax, total: net + tax, units: lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0) }
  }, [lines])

  function addLine(p: Product) {
    setLines((ls) => [
      ...ls,
      {
        key: ++lineKey,
        product: p,
        lot_number: '',
        expiry_date: isoDate(addDays(new Date(), 365)),
        quantity: '',
        unit_cost: String(p.cost || ''),
      },
    ])
  }
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const lineErrors = (l: Line) => ({
    expiry: !l.expiry_date || l.expiry_date <= today,
    qty: !(Number(l.quantity) > 0),
    cost: l.unit_cost === '' || Number(l.unit_cost) < 0,
  })
  const hasErrors = !supplierId || !docNumber.trim() || lines.length === 0 || lines.some((l) => Object.values(lineErrors(l)).some(Boolean))

  const save = useMutation({
    mutationFn: () =>
      purchasesApi.create({
        supplier_id: Number(supplierId),
        document_type: docType,
        document_number: docNumber.trim(),
        document_date: docDate,
        notes: notes.trim() || null,
        items: lines.map((l) => ({
          product_id: l.product.id,
          lot_number: l.lot_number.trim() || null,
          expiry_date: l.expiry_date,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
        })),
      }),
    onSuccess: (p) => {
      toast.success(`Ingreso #${p.id} registrado: ${p.units_count} unidades en ${p.items_count} líneas`)
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['lots'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      navigate('/ingresos')
    },
    onError: (e) =>
      toast.error(errorMessage(e), {
        description: e instanceof ApiError && e.code === 'validation_error' ? 'Revise los campos marcados' : undefined,
      }),
  })

  /** Controles de una línea; se reutilizan en la tabla (desktop) y en las tarjetas (móvil). */
  function lineControls(l: Line) {
    const err = submitted ? lineErrors(l) : { expiry: false, qty: false, cost: false }
    const errText = (msg: string) => <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">{msg}</p>
    return {
      invalid: err.expiry || err.qty || err.cost,
      product: (
        <>
          <p className="font-medium text-ink">{l.product.name}</p>
          <p className="font-mono text-xs text-muted">
            {l.product.sku} <span className="font-sans">· stock actual {l.product.stock}</span>
          </p>
        </>
      ),
      qty: (
        <>
          <Input
            aria-label="Cantidad"
            inputMode="numeric"
            value={l.quantity}
            onChange={(e) => update(l.key, { quantity: e.target.value.replace(/\D/g, '') })}
            invalid={err.qty}
            inputSize="sm"
            className="text-right md:w-24"
          />
          {err.qty && errText('Debe ser mayor a 0')}
        </>
      ),
      cost: (
        <>
          <Input
            aria-label="Costo unitario neto"
            inputMode="numeric"
            value={l.unit_cost}
            onChange={(e) => update(l.key, { unit_cost: e.target.value.replace(/\D/g, '') })}
            invalid={err.cost}
            inputSize="sm"
            className="text-right md:w-28"
          />
          {err.cost && errText('Inválido')}
        </>
      ),
      lot: (
        <Input
          aria-label="Lote (opcional)"
          value={l.lot_number}
          onChange={(e) => update(l.key, { lot_number: e.target.value.toUpperCase() })}
          placeholder="Opcional"
          autoComplete="off"
          inputSize="sm"
          className="font-mono placeholder:font-sans md:w-32"
        />
      ),
      expiry: (
        <>
          <Input
            aria-label="Vencimiento"
            type="date"
            min={isoDate(addDays(new Date(), 1))}
            value={l.expiry_date}
            onChange={(e) => update(l.key, { expiry_date: e.target.value })}
            invalid={err.expiry}
            inputSize="sm"
            className="md:w-40"
          />
          {err.expiry && errText('Debe ser posterior a hoy')}
        </>
      ),
      subtotal: clp((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)),
      remove: (
        <IconButton label="Quitar línea" variant="danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
          <Trash2 />
        </IconButton>
      ),
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (hasErrors) return toast.error('Complete los datos del documento y de cada línea')
    save.mutate()
  }

  return (
    <>
      <form onSubmit={submit}>
        <PageHeader
          title="Nuevo ingreso de mercadería"
          subtitle="Registre el documento del proveedor y cada producto recibido con su vencimiento"
          actions={
            <Link to="/ingresos">
              <Button variant="ghost" icon={<ArrowLeft />}>
                Volver
              </Button>
            </Link>
          }
        />
        <Card>
          <CardHeader title="Documento" subtitle="Datos de la factura o guía de despacho del proveedor" />
          <div className="grid gap-4 p-5 md:grid-cols-4">
            <Field
              label="Proveedor"
              required
              error={submitted && !supplierId ? 'Seleccione un proveedor' : undefined}
              className="md:col-span-2"
            >
              {(id) => (
                <div className="flex gap-2">
                  <Select id={id} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} invalid={submitted && !supplierId}>
                    <option value="">Seleccione…</option>
                    {suppliers.data?.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.business_name} · {formatRut(s.rut)}
                      </option>
                    ))}
                  </Select>
                  <Button variant="secondary" onClick={() => setNewSupplier(true)} aria-label="Nuevo proveedor" title="Nuevo proveedor">
                    <Plus />
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Tipo" required>
              {(id) => (
                <Select id={id} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
                  <option value="factura">Factura</option>
                  <option value="guia_despacho">Guía de despacho</option>
                  <option value="boleta">Boleta</option>
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="N° documento" required error={submitted && !docNumber.trim() ? 'Requerido' : undefined}>
                {(id) => (
                  <Input
                    id={id}
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    invalid={submitted && !docNumber.trim()}
                    className="font-mono"
                  />
                )}
              </Field>
              <Field label="Fecha" required>
                {(id) => <Input id={id} type="date" value={docDate} max={today} onChange={(e) => setDocDate(e.target.value)} />}
              </Field>
            </div>
            <Field label="Observaciones" className="md:col-span-4">
              {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </div>
        </Card>

        <Card className="mt-6">
          <CardHeader title="Productos recibidos" subtitle="Costos unitarios netos (sin IVA) · lote opcional" />
          <div className="border-b border-line p-4">
            <ProductPicker onSelect={addLine} placeholder="Agregar producto: busque por nombre, SKU o escanee el código…" />
          </div>
          {lines.length === 0 ? (
            <EmptyState
              icon={<PackageCheck />}
              title="Sin productos"
              message="Busque y agregue los productos del documento. Por cada uno indique cantidad, costo neto y vencimiento; el lote es opcional."
            />
          ) : (
            <>
              {/* Desktop: tabla. Orden de columnas = orden de tabulación: cantidad → costo → lote → vencimiento. */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                      <th className="px-4 py-2.5">Producto</th>
                      <th className="px-2 py-2.5">Cantidad</th>
                      <th className="px-2 py-2.5">Costo neto</th>
                      <th className="px-2 py-2.5">
                        Lote <span className="font-medium tracking-normal text-faint normal-case">(opcional)</span>
                      </th>
                      <th className="px-2 py-2.5">Vencimiento</th>
                      <th className="px-4 py-2.5 text-right">Subtotal</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const c = lineControls(l)
                      return (
                        <tr
                          key={l.key}
                          className={cn('border-b border-line align-top', c.invalid && 'bg-danger-50/40 dark:bg-danger-500/8')}
                        >
                          <td className="px-4 py-2.5">{c.product}</td>
                          <td className="px-2 py-2.5">{c.qty}</td>
                          <td className="px-2 py-2.5">{c.cost}</td>
                          <td className="px-2 py-2.5">{c.lot}</td>
                          <td className="px-2 py-2.5">{c.expiry}</td>
                          <td className="px-4 py-2.5 pt-4 text-right font-medium tabular-nums text-ink">{c.subtotal}</td>
                          <td className="px-2 py-2.5 pt-3.5">{c.remove}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Móvil: una tarjeta por línea, mismos campos en el mismo orden. */}
              <ul className="divide-y divide-line md:hidden">
                {lines.map((l) => {
                  const c = lineControls(l)
                  return (
                    <li key={l.key} className={cn('space-y-3 px-4 py-4', c.invalid && 'bg-danger-50/40 dark:bg-danger-500/8')}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">{c.product}</div>
                        {c.remove}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <MobileField label="Cantidad">{c.qty}</MobileField>
                        <MobileField label="Costo neto">{c.cost}</MobileField>
                        <MobileField label="Lote" optional>
                          {c.lot}
                        </MobileField>
                        <MobileField label="Vencimiento">{c.expiry}</MobileField>
                      </div>
                      <p className="flex justify-between text-sm">
                        <span className="text-muted">Subtotal</span>
                        <span className="font-medium tabular-nums text-ink">{c.subtotal}</span>
                      </p>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <div className="flex flex-wrap items-end justify-between gap-6 rounded-b-2xl border-t border-line bg-subtle/60 p-5">
            <p className="text-sm text-muted">
              <span className="font-medium tabular-nums text-ink">{lines.length}</span> líneas ·{' '}
              <span className="font-medium tabular-nums text-ink">{totals.units}</span> unidades
            </p>
            <div className="flex flex-wrap items-end gap-8">
              <dl className="w-56 space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Neto</dt>
                  <dd className="tabular-nums">{clp(totals.net)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">IVA 19%</dt>
                  <dd className="tabular-nums">{clp(totals.tax)}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-1 text-base font-bold text-ink">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{clp(totals.total)}</dd>
                </div>
              </dl>
              <Button type="submit" size="lg" loading={save.isPending} icon={<PackageCheck />}>
                Registrar ingreso
              </Button>
            </div>
          </div>
        </Card>
      </form>
      <SupplierFormModal
        open={newSupplier}
        onClose={() => setNewSupplier(false)}
        onSaved={(s) => {
          qc.invalidateQueries({ queryKey: ['suppliers'] })
          setSupplierId(String(s.id))
        }}
      />
    </>
  )
}

function MobileField({ label, optional, children }: { label: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">
        {label} {optional && <span className="font-medium tracking-normal text-faint normal-case">(opcional)</span>}
      </p>
      {children}
    </div>
  )
}
