import type { DosageForm, Ingredient, IngredientUnit, MovementType, PaymentMethod, Role, SaleCondition } from '@/api/types'

const clpFmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const numFmt = new Intl.NumberFormat('es-CL')

/** 12990 → "$12.990" · −2000 → "−$2.000" (signo tipográfico antes del símbolo, no "$-2.000"). */
export const clp = (n: number | null | undefined) => {
  const v = n ?? 0
  const s = clpFmt.format(Math.abs(v)).replace(/\s/g, '')
  return v < 0 ? `\u2212${s}` : s
}

export const num = (n: number | null | undefined) => numFmt.format(n ?? 0)

/** "2026-09-25" o ISO → "25-09-2026" (sin conversión de zona horaria para fechas puras). */
export function date(s: string | null | undefined): string {
  if (!s) return '—'
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

/** ISO timestamp → "25-09-2026 14:05" en hora local. */
export function dateTime(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function time(s: string): string {
  const d = new Date(s)
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

/** Fecha local como "AAAA-MM-DD". */
export function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(d: Date, days: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + days)
  return c
}

/** "12345678-9" → "12.345.678-9" */
export function formatRut(rut: string | null | undefined): string {
  if (!rut) return '—'
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2) return rut
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}

/** Valida RUT chileno con dígito verificador (módulo 11). */
export function isValidRut(rut: string): boolean {
  const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2) return false
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  let sum = 0
  let mul = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul
    mul = mul === 7 ? 2 : mul + 1
  }
  const r = 11 - (sum % 11)
  const expected = r === 11 ? '0' : r === 10 ? 'K' : String(r)
  return Number(body) > 0 && dv === expected
}

export const roleLabel: Record<Role, string> = {
  admin: 'Administrador',
  quimico: 'Químico farmacéutico',
  cajero: 'Cajero',
  bodega: 'Bodega',
}

export const paymentLabel: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
}

export const saleConditionLabel: Record<SaleCondition, string> = {
  directa: 'Venta directa',
  receta_simple: 'Receta simple',
  receta_retenida: 'Receta retenida',
  receta_cheque: 'Receta cheque',
}

export const movementLabel: Record<MovementType, string> = {
  compra: 'Compra',
  venta: 'Venta',
  anulacion_venta: 'Anulación venta',
  ajuste_positivo: 'Ajuste (+)',
  ajuste_negativo: 'Ajuste (−)',
  merma: 'Merma',
  traspaso_salida: 'Traspaso enviado',
  traspaso_entrada: 'Traspaso recibido',
}

export const documentLabel = { factura: 'Factura', guia_despacho: 'Guía de despacho', boleta: 'Boleta' } as const

/** Parsea input de moneda tolerando puntos: "12.990" → 12990 */
export function parseAmount(s: string): number {
  const n = Number(s.replace(/[^\d]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Formas farmacéuticas agrupadas por vía, en el orden en que se muestran en el desplegable. */
export const dosageFormGroups: { label: string; forms: [DosageForm, string][] }[] = [
  {
    label: 'Sólidos orales',
    forms: [
      ['comprimido', 'Comprimido'],
      ['comprimido_recubierto', 'Comprimido recubierto'],
      ['comprimido_efervescente', 'Comprimido efervescente'],
      ['comprimido_masticable', 'Comprimido masticable'],
      ['comprimido_liberacion_prolongada', 'Comprimido de liberación prolongada'],
      ['capsula', 'Cápsula'],
      ['capsula_blanda', 'Cápsula blanda'],
      ['granulado', 'Granulado'],
    ],
  },
  {
    label: 'Líquidos orales',
    forms: [
      ['jarabe', 'Jarabe'],
      ['suspension_oral', 'Suspensión oral'],
      ['solucion_oral', 'Solución oral'],
      ['gotas_orales', 'Gotas orales'],
      ['polvo_suspension_oral', 'Polvo para suspensión oral'],
    ],
  },
  {
    label: 'Inyectables',
    forms: [
      ['solucion_inyectable', 'Solución inyectable'],
      ['polvo_inyectable', 'Polvo para solución inyectable'],
    ],
  },
  {
    label: 'Tópicos',
    forms: [
      ['crema', 'Crema'],
      ['gel', 'Gel'],
      ['unguento', 'Ungüento'],
      ['locion', 'Loción'],
      ['solucion_topica', 'Solución tópica'],
      ['parche_transdermico', 'Parche transdérmico'],
    ],
  },
  {
    label: 'Otras vías',
    forms: [
      ['supositorio', 'Supositorio'],
      ['ovulo', 'Óvulo'],
      ['aerosol_inhalacion', 'Aerosol para inhalación'],
      ['polvo_inhalacion', 'Polvo para inhalación'],
      ['spray_nasal', 'Spray nasal'],
      ['solucion_oftalmica', 'Solución oftálmica'],
      ['gotas_oticas', 'Gotas óticas'],
      ['otro', 'Otra'],
    ],
  },
]

export const dosageFormLabel = Object.fromEntries(dosageFormGroups.flatMap((g) => g.forms)) as Record<DosageForm, string>

/** Formato del registro sanitario ISP, ej. "F-12345/20" (espejo de la validación del backend). */
export const ISP_REGISTRY_RE = /^[A-Z]{1,3}-\d{1,6}\/\d{2,4}$/

/** Unidades de dosis de un principio activo (espejo del CHECK de la migración 00003). */
export const ingredientUnits: IngredientUnit[] = ['mg', 'g', 'mcg', 'UI', 'ml', '%', 'mg/ml', 'mg/5 ml', 'mcg/dosis', 'mEq']

/** 0.5 → "0,5" · 325 → "325" */
export const dose = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 }).format(n)

/** { Paracetamol, 325, mg } → "Paracetamol 325 mg" */
export function ingredientLabel(i: Ingredient): string {
  return i.dose != null && i.unit ? `${i.name} ${dose(i.dose)} ${i.unit}` : i.name
}

/** Texto plano de un lote para descripciones: "Lote ABC123" o "Sin lote". */
export const lotLabel = (lot: string | null | undefined) => (lot ? `Lote ${lot}` : 'Sin lote')

/** Tasa en puntos básicos → texto: 250 → "2,5%" · 0 → "0%" */
export const percentBps = (bps: number) => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(bps / 100)}%`

/** Texto de porcentaje → puntos básicos: "2,5" → 250 · "" → 0 · inválido → null */
export function parsePercentToBps(s: string): number | null {
  const t = s.trim().replace('%', '').replace(',', '.')
  if (t === '') return 0
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return Math.round(n * 100)
}
