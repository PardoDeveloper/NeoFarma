import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeftRight, Banknote, CreditCard, FileText, Landmark } from 'lucide-react'
import { salesApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { CashSession, PaymentMethod, Sale } from '@/api/types'
import { clp, isValidRut, parseAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Kbd } from '@/components/ui/display'
import { cartTotals, quickCashAmounts, requiresPrescription, type CartLine } from './cart'

const methods: { value: PaymentMethod; label: string; icon: typeof Banknote; key: string }[] = [
  { value: 'efectivo', label: 'Efectivo', icon: Banknote, key: '1' },
  { value: 'debito', label: 'Débito', icon: CreditCard, key: '2' },
  { value: 'credito', label: 'Crédito', icon: Landmark, key: '3' },
  { value: 'transferencia', label: 'Transferencia', icon: ArrowLeftRight, key: '4' },
]

interface Props {
  open: boolean
  onClose: () => void
  cart: CartLine[]
  discount: number
  onDone: (sale: Sale) => void
  /** Caja abierta del usuario: si el backend rechaza el cobro por `branch_mismatch`, permite ofrecer el cambio. */
  session: CashSession
  onSwitchBranch: () => void
}

export function CheckoutModal({ open, onClose, ...rest }: Props) {
  const totals = cartTotals(rest.cart, rest.discount)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cobrar venta"
      description={`${totals.items} unidades · ${rest.cart.length} productos`}
      size="lg"
    >
      <CheckoutForm {...rest} />
    </Modal>
  )
}

// Se monta al abrir el modal, por lo que su estado se reinicia en cada cobro.
function CheckoutForm({ cart, discount, onDone, session, onSwitchBranch }: Omit<Props, 'open' | 'onClose'>) {
  const totals = cartTotals(cart, discount)
  const needsRx = requiresPrescription(cart)
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [received, setReceived] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerRut, setCustomerRut] = useState('')
  const [rxNumber, setRxNumber] = useState('')
  const [prescriber, setPrescriber] = useState('')
  const receivedRef = useRef<HTMLInputElement>(null)

  // Teclas 1-4 cambian medio de pago cuando el foco no está en un campo de texto libre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      const m = methods.find((x) => x.key === e.key)
      if (m) {
        e.preventDefault()
        setMethod(m.value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paid = method === 'efectivo' ? parseAmount(received) || totals.total : totals.total
  const change = Math.max(0, paid - totals.total)
  const insufficient = method === 'efectivo' && paid < totals.total
  const rutInvalid = customerRut.trim() !== '' && !isValidRut(customerRut)
  const rxMissing = needsRx && (!rxNumber.trim() || !prescriber.trim())

  const create = useMutation({
    mutationFn: () =>
      salesApi.create({
        payment_method: method,
        amount_paid: paid,
        discount: totals.discount,
        customer_name: customerName.trim() || null,
        customer_rut: customerRut.trim() || null,
        prescription_number: rxNumber.trim() || null,
        prescriber_name: prescriber.trim() || null,
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
      }),
    onSuccess: (sale) => {
      toast.success(`Venta N° ${sale.id} registrada`)
      onDone(sale)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'branch_mismatch') {
        toast.error(e.message, {
          description: `Su caja "${session.register_name}" es de ${session.branch_name}.`,
          action: { label: `Cambiar a ${session.branch_name}`, onClick: onSwitchBranch },
        })
        return
      }
      toast.error(errorMessage(e), {
        description: e instanceof ApiError && e.code === 'insufficient_stock' ? 'Actualice el carrito e intente nuevamente.' : undefined,
      })
    },
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (insufficient || rutInvalid || rxMissing || create.isPending) return
    create.mutate()
  }

  return (
    <form onSubmit={submit} className="grid gap-6 md:grid-cols-5">
      <div className="space-y-5 md:col-span-3">
        <div>
          <p className="mb-2 text-sm font-medium text-ink-soft">Medio de pago</p>
          <div className="grid grid-cols-2 gap-2.5">
            {methods.map((m) => {
              const active = method === m.value
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  aria-pressed={active}
                  className={cn(
                    'relative flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-4 text-center transition-all',
                    active
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
                      : 'border-line bg-surface hover:border-line-strong hover:bg-subtle',
                  )}
                >
                  <Kbd className="absolute top-2 right-2">{m.key}</Kbd>
                  <span
                    className={cn(
                      'flex size-11 items-center justify-center rounded-full',
                      active ? 'bg-brand-600 text-white' : 'bg-subtle text-muted',
                    )}
                  >
                    <m.icon className="size-5" />
                  </span>
                  <span className={cn('text-sm font-semibold', active ? 'text-brand-800 dark:text-brand-200' : 'text-ink')}>{m.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {method === 'efectivo' && (
          <div>
            <Field label="Monto recibido" error={insufficient ? 'El monto es menor al total' : undefined}>
              {(id) => (
                <Input
                  id={id}
                  ref={receivedRef}
                  autoFocus
                  inputMode="numeric"
                  placeholder={totals.total.toLocaleString('es-CL')}
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  invalid={insufficient}
                  className="h-12 text-xl font-semibold tabular-nums"
                />
              )}
            </Field>
            <div className="mt-2 flex flex-wrap gap-2">
              {quickCashAmounts(totals.total).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setReceived(a.toLocaleString('es-CL'))}
                  className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-sm font-medium text-ink-soft tabular-nums hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/12"
                >
                  {a === totals.total ? 'Exacto' : clp(a)}
                </button>
              ))}
            </div>
          </div>
        )}

        {needsRx && (
          <div className="rounded-lg border border-rx-200 bg-rx-50 p-4 dark:border-rx-500/25 dark:bg-rx-500/10">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-rx-800 dark:text-rx-300">
              <FileText className="size-4" /> Receta retenida / cheque requerida
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="N° de receta" required>
                {(id) => <Input id={id} value={rxNumber} onChange={(e) => setRxNumber(e.target.value)} />}
              </Field>
              <Field label="Médico prescriptor" required>
                {(id) => <Input id={id} value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />}
              </Field>
            </div>
          </div>
        )}

        <details className="group rounded-lg border border-line" open={needsRx}>
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-ink-soft select-none">
            Datos del cliente (opcional)
          </summary>
          <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
            <Field label="Nombre">{(id) => <Input id={id} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />}</Field>
            <Field label="RUT" error={rutInvalid ? 'RUT inválido' : undefined}>
              {(id) => (
                <Input
                  id={id}
                  placeholder="12.345.678-9"
                  value={customerRut}
                  onChange={(e) => setCustomerRut(e.target.value)}
                  invalid={rutInvalid}
                />
              )}
            </Field>
          </div>
        </details>
      </div>

      <div className="flex flex-col justify-between rounded-xl bg-brand-900 p-5 text-brand-50 md:col-span-2">
        <div className="space-y-2 text-sm">
          <Line label="Subtotal" value={clp(totals.subtotal)} />
          {totals.discount > 0 && <Line label="Descuento" value={`−${clp(totals.discount)}`} />}
          <Line label="Neto" value={clp(totals.net)} muted />
          <Line label="IVA 19%" value={clp(totals.tax)} muted />
          <div className="my-3 border-t border-white/10" />
          <p className="text-[11px] font-semibold tracking-wider text-brand-300 uppercase">Total a pagar</p>
          <p className="text-4xl font-bold tabular-nums">{clp(totals.total)}</p>
          {method === 'efectivo' && (
            <div className="mt-4 rounded-lg bg-black/15 p-3.5">
              <p className="text-[11px] font-semibold tracking-wider text-brand-300 uppercase">Vuelto</p>
              <p className={cn('text-4xl font-bold tabular-nums', change > 0 ? 'text-ok-300' : 'text-brand-100/40')}>{clp(change)}</p>
            </div>
          )}
        </div>
        <Button
          type="submit"
          variant="success"
          size="lg"
          kbd="Enter"
          className="mt-6 w-full"
          loading={create.isPending}
          disabled={insufficient || rutInvalid || rxMissing}
        >
          Confirmar venta
        </Button>
      </div>
    </form>
  )
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn('flex justify-between tabular-nums', muted && 'text-brand-200/70')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
