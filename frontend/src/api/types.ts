// Tipos alineados con docs/api.md. Montos en CLP enteros.

export type Role = 'admin' | 'quimico' | 'cajero' | 'bodega'
export type DosageForm =
  | 'comprimido'
  | 'comprimido_recubierto'
  | 'comprimido_efervescente'
  | 'comprimido_masticable'
  | 'comprimido_liberacion_prolongada'
  | 'capsula'
  | 'capsula_blanda'
  | 'jarabe'
  | 'suspension_oral'
  | 'solucion_oral'
  | 'gotas_orales'
  | 'polvo_suspension_oral'
  | 'granulado'
  | 'solucion_inyectable'
  | 'polvo_inyectable'
  | 'crema'
  | 'gel'
  | 'unguento'
  | 'locion'
  | 'solucion_topica'
  | 'supositorio'
  | 'ovulo'
  | 'aerosol_inhalacion'
  | 'polvo_inhalacion'
  | 'spray_nasal'
  | 'solucion_oftalmica'
  | 'gotas_oticas'
  | 'parche_transdermico'
  | 'otro'
export type SaleCondition = 'directa' | 'receta_simple' | 'receta_retenida' | 'receta_cheque'
export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia'
export type DocumentType = 'factura' | 'guia_despacho' | 'boleta'
export type MovementType =
  'compra' | 'venta' | 'anulacion_venta' | 'ajuste_positivo' | 'ajuste_negativo' | 'merma' | 'traspaso_salida' | 'traspaso_entrada'
export type ExpiryStatus = 'vencido' | 'critico' | 'proximo' | 'vigente'

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  page_size: number
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface User {
  id: number
  username: string
  full_name: string
  role: Role
  active: boolean
  /** Sucursales asignadas (el admin accede a todas y no tiene asignaciones) */
  branch_ids: number[]
  created_at: string
}

export interface LoginResult {
  token: string
  expires_at: string
  user: User
}

export interface Category {
  id: number
  name: string
  products: number
}

export type IngredientUnit = 'mg' | 'g' | 'mcg' | 'UI' | 'ml' | '%' | 'mg/ml' | 'mg/5 ml' | 'mcg/dosis' | 'mEq'

/** Principio activo de la composición de un producto (ej. Paracetamol 325 mg). */
export interface Ingredient {
  name: string
  dose: number | null
  unit: IngredientUnit | null
}

export interface Product {
  id: number
  sku: string
  barcode: string | null
  name: string
  /** Resumen de la composición: "Paracetamol + Cafeína" */
  active_ingredient: string | null
  /** Resumen de dosis: "325 mg + 30 mg" */
  concentration: string | null
  ingredients: Ingredient[]
  presentation: string | null
  laboratory: string | null
  category_id: number | null
  category_name: string | null
  sale_condition: SaleCondition
  is_bioequivalent: boolean
  is_generic: boolean
  dosage_form: DosageForm | null
  isp_registry: string | null
  price: number
  /** Costo neto de compra. La API lo omite para el cajero (solo ve el precio de venta). */
  cost?: number
  min_stock: number
  active: boolean
  stock: number
  stock_sellable: number
  next_expiry: string | null
  created_at: string
  updated_at: string
}

export interface Lot {
  id: number
  branch_id: number
  branch_name: string
  lot_number: string | null
  expiry_date: string
  qty_initial: number
  qty_available: number
  unit_cost: number
  purchase_id: number | null
  created_at: string
}

export interface ProductDetail extends Product {
  lots: Lot[]
}

export interface ProductInput {
  sku: string
  barcode: string | null
  name: string
  ingredients: Ingredient[]
  presentation: string | null
  laboratory: string | null
  category_id: number | null
  sale_condition: SaleCondition
  is_bioequivalent: boolean
  is_generic: boolean
  dosage_form: DosageForm | null
  isp_registry: string | null
  price: number
  cost: number
  min_stock: number
  active?: boolean
}

export interface Supplier {
  id: number
  rut: string
  business_name: string
  trade_name: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  payment_terms_days: number
  notes: string | null
  active: boolean
  purchases_count: number
  last_purchase_at: string | null
  created_at: string
}

export type SupplierInput = Omit<Supplier, 'id' | 'purchases_count' | 'last_purchase_at' | 'created_at' | 'active'> & {
  active?: boolean
}

export interface PurchaseItem {
  id: number
  product_id: number
  product_name: string
  product_sku: string
  lot_id: number
  lot_number: string | null
  expiry_date: string
  quantity: number
  unit_cost: number
  subtotal: number
}

export interface Purchase {
  id: number
  branch_id: number
  branch_name: string
  supplier_id: number
  supplier_name: string
  supplier_rut: string
  document_type: DocumentType
  document_number: string
  document_date: string
  user_name: string
  net_amount: number
  tax_amount: number
  total_amount: number
  items_count: number
  units_count: number
  notes: string | null
  created_at: string
  items?: PurchaseItem[]
}

export interface PurchaseInput {
  supplier_id: number
  document_type: DocumentType
  document_number: string
  document_date: string
  notes: string | null
  items: { product_id: number; lot_number?: string | null; expiry_date: string; quantity: number; unit_cost: number }[]
}

export interface LotView {
  id: number
  branch_id: number
  branch_name: string
  product_id: number
  product_name: string
  product_sku: string
  laboratory: string | null
  lot_number: string | null
  expiry_date: string
  days_to_expiry: number
  qty_initial: number
  qty_available: number
  unit_cost: number
  stock_value: number
  expiry_status: ExpiryStatus
  supplier_name: string | null
  received_at: string
}

export interface StockMovement {
  id: number
  product_id: number
  product_name: string
  branch_id: number
  branch_name: string
  lot_id: number
  lot_number: string | null
  type: MovementType
  quantity: number
  reference_type: string | null
  reference_id: number | null
  user_name: string
  notes: string | null
  created_at: string
}

export interface CashRegister {
  id: number
  branch_id: number
  branch_name: string
  name: string
  active: boolean
  open_session_id: number | null
  open_session_user: string | null
}

export interface CashSummary {
  sales_count: number
  voided_count: number
  sales_total: number
  by_method: Record<PaymentMethod, number>
  cash_in: number
  cash_out: number
  expected_cash: number
}

export interface CashMovement {
  id: number
  type: 'ingreso' | 'egreso'
  amount: number
  reason: string
  user_name: string
  created_at: string
}

export interface CashSession {
  id: number
  branch_id: number
  branch_name: string
  register_id: number
  register_name: string
  user_id: number
  user_name: string
  status: 'abierta' | 'cerrada'
  opening_amount: number
  opened_at: string
  closed_at: string | null
  expected_cash: number | null
  counted_cash: number | null
  difference: number | null
  closing_notes: string | null
  summary?: CashSummary
  movements?: CashMovement[]
}

export interface SaleItem {
  id: number
  product_id: number
  product_name: string
  product_sku: string
  quantity: number
  unit_price: number
  total: number
  lots: string
}

export interface Sale {
  id: number
  session_id: number
  user_id: number
  branch_id: number
  branch_name: string
  register_name: string
  user_name: string
  status: 'completada' | 'anulada'
  payment_method: PaymentMethod
  subtotal: number
  discount: number
  total: number
  net_amount: number
  tax_amount: number
  amount_paid: number
  change_amount: number
  customer_rut: string | null
  customer_name: string | null
  prescription_number: string | null
  prescriber_name: string | null
  items_count: number
  voided_at: string | null
  void_reason: string | null
  created_at: string
  items?: SaleItem[]
}

export interface SaleInput {
  payment_method: PaymentMethod
  amount_paid: number
  discount: number
  customer_rut?: string | null
  customer_name?: string | null
  prescription_number?: string | null
  prescriber_name?: string | null
  items: { product_id: number; quantity: number }[]
}

export interface DayPoint {
  date: string
  total: number
  count: number
}

export interface TopProduct {
  product_id: number
  name: string
  quantity: number
  total: number
  margin: number
}

export interface StockAlert {
  product_id: number
  name: string
  sku: string
  stock_sellable: number
  min_stock: number
  lot_number?: string | null
  expiry_date?: string
  days_to_expiry?: number
  quantity?: number
  branch_name?: string
}

export interface Dashboard {
  /** "all": farmacia completa · "own": solo las ventas del cajero (inventario, margen y listas vienen vacíos) */
  scope: 'all' | 'own'
  today_sales_total: number
  today_sales_count: number
  today_avg_ticket: number
  today_margin: number
  month_sales_total: number
  month_sales_count: number
  inventory_value: number
  active_products: number
  low_stock_count: number
  expiring_soon_count: number
  expired_count: number
  open_sessions: number
  last_14_days: DayPoint[]
  today_by_method: Record<PaymentMethod, number>
  top_products: TopProduct[]
  low_stock: StockAlert[]
  expiring: StockAlert[]
}

export interface SalesReport {
  from: string
  to: string
  total: number
  net: number
  tax: number
  discount: number
  count: number
  voided_count: number
  margin: number
  avg_ticket: number
  by_method: Record<PaymentMethod, number>
  daily: DayPoint[]
  top_products: TopProduct[]
  by_user: { user_name: string; count: number; total: number }[]
  by_branch: { branch_id: number; branch_name: string; count: number; total: number }[]
}

/** Movimiento del kardex de un producto (Rotación de productos). */
export interface RotationRow {
  id: number
  branch_name: string
  created_at: string
  type: MovementType
  lot_number: string | null
  reference_type: string | null
  reference_id: number | null
  /** "Factura N° 123456", "Venta #368"… (null en ajustes/mermas) */
  document: string | null
  user_name: string
  notes: string | null
  qty_in: number
  qty_out: number
  /** Stock total del producto después del movimiento */
  balance: number
}

export interface Rotation {
  product_id: number
  product_name: string
  product_sku: string
  barcode: string | null
  from: string
  to: string
  opening_balance: number
  total_in: number
  total_out: number
  closing_balance: number
  /** true si el rango tiene más de 5.000 movimientos y se muestran los primeros */
  truncated: boolean
  rows: RotationRow[]
}

/** Sucursal (local) de la farmacia. */
export interface Branch {
  id: number
  code: string
  name: string
  address: string | null
  phone: string | null
  active: boolean
  users: number
  registers: number
  created_at: string
}

export interface BranchInput {
  code: string
  name: string
  address: string | null
  phone: string | null
  active?: boolean
}

export interface TransferItem {
  product_id: number
  product_name: string
  product_sku: string
  lot_number: string | null
  expiry_date: string
  quantity: number
  from_lot_id: number
  to_lot_id: number
}

/** Traspaso de stock entre sucursales. */
export interface Transfer {
  id: number
  from_branch_id: number
  from_branch_name: string
  to_branch_id: number
  to_branch_name: string
  user_name: string
  notes: string | null
  items_count: number
  units_count: number
  created_at: string
  items?: TransferItem[]
}

export interface TransferInput {
  to_branch_id: number
  notes?: string | null
  items: { lot_id: number; quantity: number }[]
}
