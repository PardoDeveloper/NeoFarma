import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { branchStore } from '@/api/client'
import { branchesApi } from '@/api/endpoints'
import type { Branch } from '@/api/types'
import { useAuth } from './auth-context'
import { BranchContext, type BranchState } from './branch-context'
import { ErrorState, Spinner } from '@/components/ui/display'

const BRANCHES_KEY = ['branches', 'mine'] as const

/** Elige la sucursal válida: la guardada si sigue siendo accesible; si no, "Todas" (admin) o la primera activa. */
function resolveSelection(stored: string | null, branches: Branch[], isAdmin: boolean): string | null {
  const usable = isAdmin ? branches : branches.filter((b) => b.active)
  if (stored === 'all' && isAdmin) return 'all'
  if (stored && usable.some((b) => String(b.id) === stored)) return stored
  if (isAdmin && branches.length > 1) return 'all'
  return usable[0] ? String(usable[0].id) : null
}

/**
 * Provee la sucursal activa. No renderiza la app hasta conocer las sucursales del usuario, para que ningún
 * request salga con una sucursal inválida o ajena. Al cambiar de sucursal se descarta toda la caché de datos.
 */
export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin'
  const q = useQuery({ queryKey: BRANCHES_KEY, queryFn: branchesApi.list, staleTime: 5 * 60_000 })
  const branches = useMemo(() => q.data?.data ?? [], [q.data])
  const [stored, setStored] = useState(() => branchStore.read())

  const selected = q.data ? resolveSelection(stored, branches, isAdmin) : null
  // Si lo guardado ya no es válido (sucursal desactivada, otro usuario en el equipo…) se corrige de inmediato,
  // antes de renderizar a los hijos: sus efectos (y requests) corren antes que cualquier efecto de este componente.
  if (selected && selected !== branchStore.get()) branchStore.set(selected)

  const setBranch = useCallback(
    (value: 'all' | number) => {
      const v = String(value)
      if (v === branchStore.get() && v === stored) return
      // 1) header de los próximos requests; 2) se descartan (y cancelan) todos los datos de la sucursal anterior
      // salvo la lista de sucursales; 3) el re-render remonta la app, que vuelve a pedir todo con la nueva sucursal.
      branchStore.set(v)
      const other = (qq: { queryKey: readonly unknown[] }) => qq.queryKey[0] !== BRANCHES_KEY[0]
      void qc.cancelQueries({ predicate: other })
      qc.removeQueries({ predicate: other })
      setStored(v)
    },
    [qc, stored],
  )

  const value = useMemo<BranchState>(() => {
    const current = selected && selected !== 'all' ? (branches.find((b) => String(b.id) === selected) ?? null) : null
    return {
      branches,
      current,
      isAll: selected === 'all',
      canUseAll: isAdmin && branches.length > 1,
      setBranch,
    }
  }, [branches, selected, isAdmin, setBranch])

  if (q.isLoading) return <Spinner label="Cargando sucursales…" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!selected) {
    return (
      <ErrorState
        title="Sin sucursal asignada"
        error={new Error('Su usuario no tiene sucursales activas asignadas. Contacte al administrador.')}
      />
    )
  }
  // key: al cambiar de sucursal se remonta el árbol, descartando estado local (carrito, formularios) de la sucursal anterior.
  return (
    <BranchContext.Provider value={value}>
      <div key={selected} className="contents">
        {children}
      </div>
    </BranchContext.Provider>
  )
}
