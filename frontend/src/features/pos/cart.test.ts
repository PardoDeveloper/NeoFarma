import { describe, expect, it } from 'vitest'
import type { Product } from '@/api/types'
import { addToCart, cartTotals, quickCashAmounts, removeFromCart, requiresPrescription, setQuantity } from './cart'

const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  sku: 'NF-1',
  barcode: null,
  name: 'Paracetamol',
  active_ingredient: null,
  concentration: null,
  ingredients: [],
  presentation: null,
  laboratory: null,
  category_id: null,
  category_name: null,
  sale_condition: 'directa',
  is_bioequivalent: false,
  is_generic: false,
  dosage_form: null,
  isp_registry: null,
  price: 1000,
  cost: 400,
  min_stock: 0,
  active: true,
  stock: 3,
  stock_sellable: 3,
  next_expiry: null,
  created_at: '',
  updated_at: '',
  ...over,
})

describe('carrito POS', () => {
  it('agrega y acumula cantidades del mismo producto', () => {
    let r = addToCart([], product())
    expect(r.ok).toBe(true)
    r = addToCart(r.cart, product(), 2)
    expect(r.cart).toHaveLength(1)
    expect(r.cart[0].quantity).toBe(3)
  })

  it('no permite superar el stock vendible', () => {
    const r = addToCart([{ product: product(), quantity: 3 }], product())
    expect(r.ok).toBe(false)
    expect(r.cart[0].quantity).toBe(3)
  })

  it('rechaza productos sin stock', () => {
    expect(addToCart([], product({ stock_sellable: 0 })).ok).toBe(false)
  })

  it('acota la cantidad entre 1 y el stock', () => {
    const cart = [{ product: product(), quantity: 1 }]
    expect(setQuantity(cart, 1, 99)[0].quantity).toBe(3)
    expect(setQuantity(cart, 1, 0)[0].quantity).toBe(1)
    expect(removeFromCart(cart, 1)).toHaveLength(0)
  })

  it('calcula totales con IVA incluido y descuento acotado', () => {
    const cart = [{ product: product({ price: 2990 }), quantity: 2 }]
    const t = cartTotals(cart, 980)
    expect(t).toMatchObject({ items: 2, subtotal: 5980, discount: 980, total: 5000, net: 4202, tax: 798 })
    expect(cartTotals(cart, 99999).total).toBe(0)
  })

  it('detecta recetas retenidas o cheque', () => {
    expect(requiresPrescription([{ product: product({ sale_condition: 'receta_simple' }), quantity: 1 }])).toBe(false)
    expect(requiresPrescription([{ product: product({ sale_condition: 'receta_cheque' }), quantity: 1 }])).toBe(true)
  })

  it('sugiere montos de pago en efectivo', () => {
    expect(quickCashAmounts(4500)).toEqual([4500, 5000, 6000, 10000, 20000])
    expect(quickCashAmounts(10000)[0]).toBe(10000)
  })
})
