import { z } from 'zod'
import type { IngredientUnit, Product } from '@/api/types'
import { ISP_REGISTRY_RE } from '@/lib/format'

/** Fila editable de principio activo (dosis como texto para aceptar "0,5"). */
export interface IngredientRow {
  name: string
  dose: string
  unit: IngredientUnit
}

export const emptyIngredient: IngredientRow = { name: '', dose: '', unit: 'mg' }

export const parseDose = (v: string) => Number(v.replace(',', '.'))

const ingredientsSchema = z
  .array(
    z.object({
      name: z.string().trim().max(120),
      dose: z.string().trim(),
      unit: z.enum(['mg', 'g', 'mcg', 'UI', 'ml', '%', 'mg/ml', 'mg/5 ml', 'mcg/dosis', 'mEq']),
    }),
  )
  .superRefine((rows, ctx) => {
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      if (!r.name && !r.dose) return // fila vacía: se ignora al guardar
      if (!r.name) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: 'Ingrese el nombre del principio activo' })
      else if (r.name.length < 2) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: 'El nombre debe tener al menos 2 caracteres' })
      else if (seen.has(r.name.toLowerCase())) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: 'Principio activo repetido' })
      if (r.dose && !(parseDose(r.dose) > 0))
        ctx.addIssue({ code: 'custom', path: [i, 'dose'], message: 'La dosis debe ser un número mayor a 0 (ej. 325 o 0,5)' })
      seen.add(r.name.toLowerCase())
    })
  })

export const productSchema = z.object({
  sku: z.string().trim().min(1, 'Requerido').max(40),
  barcode: z.string().trim().max(40),
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(200),
  ingredients: ingredientsSchema,
  dosage_form: z.string(),
  presentation: z.string().trim().max(120),
  isp_registry: z
    .string()
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .refine((v) => v === '' || ISP_REGISTRY_RE.test(v), 'Formato inválido. Ej: F-12345/20'),
  laboratory: z.string().trim().max(120),
  category_id: z.string(),
  sale_condition: z.enum(['directa', 'receta_simple', 'receta_retenida', 'receta_cheque']),
  is_bioequivalent: z.boolean(),
  is_generic: z.boolean(),
  price: z.coerce.number<string>().int('Sin decimales').min(0, 'Debe ser ≥ 0'),
  cost: z.coerce.number<string>().int('Sin decimales').min(0, 'Debe ser ≥ 0'),
  min_stock: z.coerce.number<string>().int().min(0),
  active: z.boolean(),
})
export type ProductFormValues = z.input<typeof productSchema>
export type ProductFormOutput = z.output<typeof productSchema>

export const toForm = (p?: Product): ProductFormValues => ({
  sku: p?.sku ?? '',
  barcode: p?.barcode ?? '',
  name: p?.name ?? '',
  ingredients: p
    ? p.ingredients.map<IngredientRow>((i) => ({
        name: i.name,
        dose: i.dose != null ? String(i.dose).replace('.', ',') : '',
        unit: i.unit ?? 'mg',
      }))
    : [{ ...emptyIngredient }],
  dosage_form: p?.dosage_form ?? '',
  presentation: p?.presentation ?? '',
  isp_registry: p?.isp_registry ?? '',
  laboratory: p?.laboratory ?? '',
  category_id: p?.category_id ? String(p.category_id) : '',
  sale_condition: p?.sale_condition ?? 'directa',
  is_bioequivalent: p?.is_bioequivalent ?? false,
  is_generic: p?.is_generic ?? false,
  price: String(p?.price ?? ''),
  cost: String(p?.cost ?? ''),
  min_stock: String(p?.min_stock ?? 0),
  active: p?.active ?? true,
})
