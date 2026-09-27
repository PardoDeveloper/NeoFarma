import { createContext, useContext } from 'react'
import type { Branch } from '@/api/types'

export interface BranchState {
  /** Sucursales accesibles para el usuario (admin: todas, incluidas inactivas). */
  branches: Branch[]
  /** Sucursal activa; null cuando el admin está en "Todas las sucursales". */
  current: Branch | null
  /** true si el alcance es consolidado ("Todas"): solo lectura, sin operaciones de escritura. */
  isAll: boolean
  /** true si el usuario puede elegir "Todas" (solo admin con más de una sucursal). */
  canUseAll: boolean
  /** Cambia la sucursal activa ("all" o id). Vacía la caché de datos para no mostrar información de otra sucursal. */
  setBranch: (value: 'all' | number) => void
}

export const BranchContext = createContext<BranchState | null>(null)

export function useBranch() {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch debe usarse dentro de BranchProvider')
  return ctx
}
