import { lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { BranchProvider } from '@/lib/branch'
import { RequireBranch } from '@/components/RequireBranch'
import type { Role } from '@/api/types'
import { AppLayout } from '@/components/layout/AppLayout'
import { Spinner } from '@/components/ui/display'
import { LoginPage } from '@/features/auth/LoginPage'
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const PosPage = lazy(() => import('@/features/pos/PosPage').then((m) => ({ default: m.PosPage })))
const CashPage = lazy(() => import('@/features/cash/CashPage').then((m) => ({ default: m.CashPage })))
const SalesPage = lazy(() => import('@/features/sales/SalesPage').then((m) => ({ default: m.SalesPage })))
const ProductsPage = lazy(() => import('@/features/products/ProductsPage').then((m) => ({ default: m.ProductsPage })))
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })))
const RotationPage = lazy(() => import('@/features/inventory/RotationPage').then((m) => ({ default: m.RotationPage })))
const BranchesPage = lazy(() => import('@/features/branches/BranchesPage').then((m) => ({ default: m.BranchesPage })))
const TransfersPage = lazy(() => import('@/features/transfers/TransfersPage').then((m) => ({ default: m.TransfersPage })))
const PurchasesPage = lazy(() => import('@/features/purchases/PurchasesPage').then((m) => ({ default: m.PurchasesPage })))
const NewPurchasePage = lazy(() => import('@/features/purchases/NewPurchasePage').then((m) => ({ default: m.NewPurchasePage })))
const SuppliersPage = lazy(() => import('@/features/suppliers/SuppliersPage').then((m) => ({ default: m.SuppliersPage })))
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })))
const DesignShowcase = lazy(() => import('@/features/design/DesignShowcase').then((m) => ({ default: m.DesignShowcase })))
const UsersPage = lazy(() => import('@/features/users/UsersPage').then((m) => ({ default: m.UsersPage })))

function RequireRole({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { can } = useAuth()
  if (roles && !can(...roles)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner label="Iniciando NeoFarma…" />
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  return (
    <BranchProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route
            path="pos"
            element={
              <RequireRole roles={['quimico', 'cajero']}>
                <RequireBranch action="vender">
                  <PosPage />
                </RequireBranch>
              </RequireRole>
            }
          />
          <Route
            path="caja"
            element={
              <RequireRole roles={['quimico', 'cajero']}>
                <CashPage />
              </RequireRole>
            }
          />
          <Route
            path="ventas"
            element={
              <RequireRole roles={['quimico', 'cajero']}>
                <SalesPage />
              </RequireRole>
            }
          />
          <Route
            path="productos"
            element={
              <RequireRole roles={['quimico', 'bodega']}>
                <ProductsPage />
              </RequireRole>
            }
          />
          <Route
            path="traspasos"
            element={
              <RequireRole roles={['quimico', 'bodega']}>
                <TransfersPage />
              </RequireRole>
            }
          />
          <Route
            path="sucursales"
            element={
              <RequireRole roles={[]}>
                <BranchesPage />
              </RequireRole>
            }
          />
          <Route
            path="rotacion"
            element={
              <RequireRole roles={[]}>
                <RotationPage />
              </RequireRole>
            }
          />
          <Route
            path="inventario"
            element={
              <RequireRole roles={['quimico', 'bodega']}>
                <InventoryPage />
              </RequireRole>
            }
          />
          <Route
            path="ingresos"
            element={
              <RequireRole roles={['quimico', 'bodega']}>
                <PurchasesPage />
              </RequireRole>
            }
          />
          <Route
            path="ingresos/nuevo"
            element={
              <RequireRole roles={['quimico', 'bodega']}>
                <RequireBranch action="registrar un ingreso">
                  <NewPurchasePage />
                </RequireBranch>
              </RequireRole>
            }
          />
          <Route
            path="proveedores"
            element={
              <RequireRole roles={['quimico', 'bodega']}>
                <SuppliersPage />
              </RequireRole>
            }
          />
          <Route
            path="reportes"
            element={
              <RequireRole roles={['quimico']}>
                <ReportsPage />
              </RequireRole>
            }
          />
          <Route
            path="usuarios"
            element={
              <RequireRole roles={[]}>
                <UsersPage />
              </RequireRole>
            }
          />
          {/* Catálogo de primitivas, solo en desarrollo */}
          {import.meta.env.DEV && <Route path="design" element={<DesignShowcase />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BranchProvider>
  )
}
