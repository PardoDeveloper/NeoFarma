import { api } from './client'
import type {
  CommissionReport,
  CommissionSale,
  Branch,
  BranchInput,
  Transfer,
  TransferInput,
  CashRegister,
  CashSession,
  Category,
  Dashboard,
  LoginResult,
  LotView,
  Paginated,
  Product,
  ProductDetail,
  ProductInput,
  Purchase,
  Rotation,
  PurchaseInput,
  Role,
  Sale,
  SaleInput,
  SalesReport,
  StockMovement,
  Supplier,
  SupplierInput,
  User,
} from './types'

type Q = Record<string, string | number | boolean | null | undefined>

export const authApi = {
  login: (username: string, password: string) => api.post<LoginResult>('/auth/login', { username, password }),
  me: () => api.get<User>('/auth/me'),
}

export const usersApi = {
  list: () => api.get<{ data: User[] }>('/users'),
  create: (b: { username: string; full_name: string; password: string; role: Role; branch_ids: number[]; commission_bps: number }) =>
    api.post<User>('/users', b),
  update: (
    id: number,
    b: { full_name: string; role: Role; active: boolean; password?: string; branch_ids: number[]; commission_bps: number },
  ) => api.put<User>(`/users/${id}`, b),
}

export const catalogApi = {
  categories: () => api.get<{ data: Category[] }>('/categories'),
  createCategory: (name: string) => api.post<Category>('/categories', { name }),
  products: (q: Q) => api.get<Paginated<Product>>('/products', q),
  product: (id: number) => api.get<ProductDetail>(`/products/${id}`),
  lookup: (code: string) => api.get<Product>('/products/lookup', { code }),
  createProduct: (b: ProductInput) => api.post<ProductDetail>('/products', b),
  updateProduct: (id: number, b: ProductInput) => api.put<ProductDetail>(`/products/${id}`, b),
}

export const suppliersApi = {
  list: (q: Q) => api.get<Paginated<Supplier>>('/suppliers', q),
  get: (id: number) => api.get<Supplier>(`/suppliers/${id}`),
  create: (b: SupplierInput) => api.post<Supplier>('/suppliers', b),
  update: (id: number, b: SupplierInput) => api.put<Supplier>(`/suppliers/${id}`, b),
}

export const purchasesApi = {
  list: (q: Q) => api.get<Paginated<Purchase>>('/purchases', q),
  get: (id: number) => api.get<Purchase>(`/purchases/${id}`),
  create: (b: PurchaseInput) => api.post<Purchase>('/purchases', b),
}

export const inventoryApi = {
  lots: (q: Q) => api.get<Paginated<LotView>>('/inventory/lots', q),
  movements: (q: Q) => api.get<Paginated<StockMovement>>('/inventory/movements', q),
  rotation: (product_id: number, from: string, to: string) => api.get<Rotation>('/inventory/rotation', { product_id, from, to }),
  adjust: (b: { lot_id: number; type: 'ajuste_positivo' | 'ajuste_negativo' | 'merma'; quantity: number; notes: string }) =>
    api.post<void>('/inventory/adjustments', b),
}

export const branchesApi = {
  list: () => api.get<{ data: Branch[] }>('/branches'),
  create: (b: BranchInput) => api.post<Branch>('/branches', b),
  update: (id: number, b: BranchInput) => api.put<Branch>(`/branches/${id}`, b),
}

export const transfersApi = {
  list: (q: Q) => api.get<Paginated<Transfer>>('/transfers', q),
  get: (id: number) => api.get<Transfer>(`/transfers/${id}`),
  create: (b: TransferInput) => api.post<Transfer>('/transfers', b),
}

export const cashApi = {
  /** Cajas de una sucursal específica (administración desde la página Sucursales; solo admin). */
  registersOf: (branchId: number) => api.inBranch(branchId).get<{ data: CashRegister[] }>('/cash/registers'),
  createRegister: (branchId: number, b: { name: string; active?: boolean }) =>
    api.inBranch(branchId).post<CashRegister>('/cash/registers', b),
  updateRegister: (branchId: number, id: number, b: { name: string; active?: boolean }) =>
    api.inBranch(branchId).put<CashRegister>(`/cash/registers/${id}`, b),
  registers: () => api.get<{ data: CashRegister[] }>('/cash/registers'),
  current: () => api.get<{ session: CashSession | null }>('/cash/sessions/current'),
  sessions: (q: Q) => api.get<Paginated<CashSession>>('/cash/sessions', q),
  session: (id: number) => api.get<CashSession>(`/cash/sessions/${id}`),
  open: (register_id: number, opening_amount: number) => api.post<CashSession>('/cash/sessions', { register_id, opening_amount }),
  movement: (id: number, b: { type: 'ingreso' | 'egreso'; amount: number; reason: string }) =>
    api.post<CashSession>(`/cash/sessions/${id}/movements`, b),
  close: (id: number, counted_cash: number, notes: string | null) =>
    api.post<CashSession>(`/cash/sessions/${id}/close`, { counted_cash, notes }),
}

export const salesApi = {
  list: (q: Q) => api.get<Paginated<Sale>>('/sales', q),
  get: (id: number) => api.get<Sale>(`/sales/${id}`),
  create: (b: SaleInput) => api.post<Sale>('/sales', b),
  void: (id: number, reason: string) => api.post<Sale>(`/sales/${id}/void`, { reason }),
}

export const reportsApi = {
  dashboard: () => api.get<Dashboard>('/reports/dashboard'),
  sales: (from: string, to: string) => api.get<SalesReport>('/reports/sales', { from, to }),
  /** Comisiones por vendedor en el período (solo admin). */
  commissions: (from: string, to: string) => api.get<CommissionReport>('/reports/commissions', { from, to }),
  commissionDetail: (userId: number, from: string, to: string) =>
    api.get<{ data: CommissionSale[] }>(`/reports/commissions/${userId}`, { from, to }),
}
