import type { Sale } from '@/api/types'
import { clp, dateTime, formatRut, paymentLabel } from '@/lib/format'

/**
 * Comprobante interno de venta (formato ticket 80 mm, imprimible).
 * `.print-area` fuerza tokens claros (ver index.css), por lo que usar tokens semánticos
 * aquí es seguro: se ve igual en pantalla (claro/oscuro) y al imprimir.
 */
export function SaleReceipt({ sale }: { sale: Sale }) {
  return (
    <div className="print-area mx-auto w-full max-w-[320px] bg-surface p-4 font-mono text-[12px] leading-relaxed text-ink">
      <div className="text-center">
        <p className="text-base font-bold">NeoFarma</p>
        <p>Comprobante de venta N° {sale.id}</p>
        <p>{dateTime(sale.created_at)}</p>
        <p>
          {sale.register_name} · {sale.user_name}
        </p>
        {sale.status === 'anulada' && <p className="mt-1 font-bold text-danger-600">*** VENTA ANULADA ***</p>}
      </div>
      <div className="my-2 border-t border-dashed border-line-strong" />
      {sale.items?.map((it) => (
        <div key={it.id} className="mb-1">
          <p className="truncate">{it.product_name}</p>
          <div className="flex justify-between">
            <span>
              {it.quantity} x {clp(it.unit_price)}
            </span>
            <span>{clp(it.total)}</span>
          </div>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-line-strong" />
      <Row label="Subtotal" value={clp(sale.subtotal)} />
      {sale.discount > 0 && <Row label="Descuento" value={`-${clp(sale.discount)}`} />}
      <Row label="Neto" value={clp(sale.net_amount)} />
      <Row label="IVA 19%" value={clp(sale.tax_amount)} />
      <Row label="TOTAL" value={clp(sale.total)} bold />
      <div className="my-2 border-t border-dashed border-line-strong" />
      <Row label={paymentLabel[sale.payment_method]} value={clp(sale.amount_paid)} />
      {sale.change_amount > 0 && <Row label="Vuelto" value={clp(sale.change_amount)} />}
      {(sale.customer_name || sale.customer_rut) && (
        <p className="mt-2">
          Cliente: {sale.customer_name ?? ''} {sale.customer_rut ? formatRut(sale.customer_rut) : ''}
        </p>
      )}
      {sale.prescription_number && (
        <p>
          Receta N° {sale.prescription_number} · Dr(a). {sale.prescriber_name}
        </p>
      )}
      <p className="mt-3 text-center">¡Gracias por su compra!</p>
    </div>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'text-sm font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
