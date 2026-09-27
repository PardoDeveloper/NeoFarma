import type { Product } from '@/api/types'

export interface CartLine {
  product: Product
  quantity: number
}

export type AddResult = { ok: true; cart: CartLine[] } | { ok: false; reason: string; cart: CartLine[] }

/** Agrega (o suma) un producto al carrito respetando el stock vendible. */
export function addToCart(cart: CartLine[], product: Product, qty = 1): AddResult {
  const existing = cart.find((l) => l.product.id === product.id)
  const current = existing?.quantity ?? 0
  if (product.stock_sellable <= 0) return { ok: false, reason: `${product.name} no tiene stock disponible`, cart }
  if (current + qty > product.stock_sellable) {
    return { ok: false, reason: `Solo hay ${product.stock_sellable} unidades de ${product.name}`, cart }
  }
  if (existing) {
    return { ok: true, cart: cart.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + qty } : l)) }
  }
  return { ok: true, cart: [...cart, { product, quantity: qty }] }
}

/** Fija la cantidad de una línea (acotada entre 1 y el stock vendible). */
export function setQuantity(cart: CartLine[], productId: number, qty: number): CartLine[] {
  return cart.map((l) =>
    l.product.id === productId ? { ...l, quantity: Math.max(1, Math.min(Math.floor(qty) || 1, l.product.stock_sellable)) } : l,
  )
}

export function removeFromCart(cart: CartLine[], productId: number): CartLine[] {
  return cart.filter((l) => l.product.id !== productId)
}

export interface Totals {
  items: number
  subtotal: number
  discount: number
  total: number
  net: number
  tax: number
}

/** Calcula totales; los precios incluyen IVA 19%. El descuento se acota al subtotal. */
export function cartTotals(cart: CartLine[], discount = 0): Totals {
  const subtotal = cart.reduce((s, l) => s + l.product.price * l.quantity, 0)
  const d = Math.max(0, Math.min(discount, subtotal))
  const total = subtotal - d
  const net = Math.round(total / 1.19)
  return { items: cart.reduce((s, l) => s + l.quantity, 0), subtotal, discount: d, total, net, tax: total - net }
}

/** ¿El carrito requiere N° de receta y médico? (receta retenida o cheque) */
export function requiresPrescription(cart: CartLine[]): boolean {
  return cart.some((l) => l.product.sale_condition === 'receta_retenida' || l.product.sale_condition === 'receta_cheque')
}

/** Montos sugeridos de pago en efectivo: exacto y billetes chilenos siguientes. */
export function quickCashAmounts(total: number): number[] {
  const bills = [1000, 2000, 5000, 10000, 20000]
  const out = new Set<number>([total])
  for (const b of bills) {
    const v = Math.ceil(total / b) * b
    if (v > total) out.add(v)
  }
  return [...out].sort((a, b) => a - b).slice(0, 5)
}
