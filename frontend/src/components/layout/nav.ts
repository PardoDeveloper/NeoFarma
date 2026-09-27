import type { ComponentType } from 'react'
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  LayoutDashboard,
  Package,
  PackagePlus,
  Receipt,
  ShoppingCart,
  Shuffle,
  Store,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import type { Role } from '@/api/types'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /** Roles que lo ven además de admin; undefined = todos. */
  roles?: Role[]
  /** Palabras extra para la paleta de comandos. */
  keywords?: string
}

export const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operación',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'inicio resumen' },
      { to: '/pos', label: 'Punto de venta', icon: ShoppingCart, roles: ['quimico', 'cajero'], keywords: 'pos vender boleta' },
      { to: '/caja', label: 'Caja', icon: Wallet, roles: ['quimico', 'cajero'], keywords: 'arqueo cierre apertura' },
      { to: '/ventas', label: 'Ventas', icon: Receipt, roles: ['quimico', 'cajero'], keywords: 'boletas historial anular' },
    ],
  },
  {
    title: 'Inventario',
    items: [
      { to: '/productos', label: 'Productos', icon: Package, roles: ['quimico', 'bodega'], keywords: 'catálogo medicamentos precios' },
      {
        to: '/inventario',
        label: 'Stock y vencimientos',
        icon: Boxes,
        roles: ['quimico', 'bodega'],
        keywords: 'lotes vencidos inventario',
      },
      {
        to: '/traspasos',
        label: 'Traspasos',
        icon: Shuffle,
        roles: ['quimico', 'bodega'],
        keywords: 'sucursales envío reposición mover stock',
      },
      {
        to: '/rotacion',
        label: 'Rotación de productos',
        icon: ArrowLeftRight,
        roles: [], // solo administrador
        keywords: 'kardex movimientos ingresos egresos saldo',
      },
      {
        to: '/ingresos',
        label: 'Ingreso de mercadería',
        icon: PackagePlus,
        roles: ['quimico', 'bodega'],
        keywords: 'compras recepción factura',
      },
      { to: '/proveedores', label: 'Proveedores', icon: Truck, roles: ['quimico', 'bodega'], keywords: 'laboratorios distribuidores' },
    ],
  },
  {
    title: 'Gestión',
    items: [
      { to: '/reportes', label: 'Reportes', icon: BarChart3, roles: ['quimico'], keywords: 'estadísticas informes' },
      { to: '/sucursales', label: 'Sucursales', icon: Store, roles: [], keywords: 'locales cajas farmacias' },
      { to: '/usuarios', label: 'Usuarios', icon: Users, roles: [], keywords: 'cuentas roles permisos' },
    ],
  },
]

export function initials(fullName?: string) {
  if (!fullName) return ''
  return fullName
    .split(' ')
    .filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
}
