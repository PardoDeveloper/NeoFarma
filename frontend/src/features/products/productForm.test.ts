import { describe, expect, it } from 'vitest'
import { productSchema, toForm, type ProductFormValues } from './productForm'

const base = (over: Partial<ProductFormValues> = {}): ProductFormValues => ({
  ...toForm(),
  sku: 'X-1',
  name: 'Producto',
  price: '1000',
  ...over,
})

describe('formulario de producto: principios activos', () => {
  it('un producto nuevo parte con una fila vacía que se ignora', () => {
    const r = productSchema.safeParse(base())
    expect(r.success).toBe(true)
  })

  it('acepta varios principios activos con dosis decimal con coma', () => {
    const r = productSchema.safeParse(
      base({
        ingredients: [
          { name: 'Paracetamol', dose: '325', unit: 'mg' },
          { name: 'Cafeína', dose: '32,5', unit: 'mg' },
        ],
      }),
    )
    expect(r.success).toBe(true)
  })

  it('rechaza nombre faltante, repetido y dosis inválida en la fila correcta', () => {
    const r = productSchema.safeParse(
      base({
        ingredients: [
          { name: 'Ibuprofeno', dose: '400', unit: 'mg' },
          { name: 'ibuprofeno', dose: 'abc', unit: 'mg' },
          { name: '', dose: '10', unit: 'mg' },
        ],
      }),
    )
    expect(r.success).toBe(false)
    const paths = r.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['ingredients.1.name', 'ingredients.1.dose', 'ingredients.2.name']))
  })
})
