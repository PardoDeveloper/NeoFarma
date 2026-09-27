import type { ApiErrorBody } from './types'

const TOKEN_KEY = 'neofarma.token'

export class ApiError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.status = status
    this.code = body.code
    this.details = body.details
  }

  /** Errores de validación por campo: { "items[0].quantity": "gt" } */
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) ?? {}
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

const BRANCH_KEY = 'neofarma.branch'

/**
 * Sucursal activa: se envía en el header X-Branch-ID de cada request. "all" = consolidado (solo admin, solo lectura).
 * El backend valida que el usuario pertenezca a la sucursal; aquí solo se recuerda la elección.
 */
export const branchStore = {
  /** Sucursal que se envía en los requests (memoria). */
  get: (): string | null => current,
  /** Última elección guardada (puede haber cambiado en otra pestaña o por otro usuario del equipo). */
  read: (): string | null => {
    try {
      return localStorage.getItem(BRANCH_KEY) ?? current
    } catch {
      return current
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(BRANCH_KEY, v)
    } catch {
      /* almacenamiento no disponible: se usa solo en memoria */
    }
    current = v
  },
  clear: () => {
    try {
      localStorage.removeItem(BRANCH_KEY)
    } catch {
      /* ignorar */
    }
    current = null
  },
}
let current: string | null = null
current = branchStore.read()

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

type Query = Record<string, string | number | boolean | null | undefined>

function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return `/api${path}${qs ? `?${qs}` : ''}`
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown; branch?: number } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  // `branch` explícito (p. ej. administrar las cajas de otra sucursal) tiene prioridad sobre la sucursal activa.
  const branch = opts.branch !== undefined ? String(opts.branch) : current
  if (branch) headers['X-Branch-ID'] = branch
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, { code: 'network', message: 'No se pudo conectar con el servidor' })
  }

  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized?.()
    throw new ApiError(res.status, data?.error ?? { code: 'http_error', message: `Error ${res.status}` })
  }
  return data as T
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  /** Igual que get/post/put pero en una sucursal explícita (ignora la sucursal activa). Solo para admin. */
  inBranch: (branch: number) => ({
    get: <T>(path: string, query?: Query) => request<T>('GET', path, { query, branch }),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {}, branch }),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body, branch }),
  }),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Error inesperado'
}
