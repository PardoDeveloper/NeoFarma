import type { ReactNode } from 'react'
import { Store } from 'lucide-react'
import { useBranch } from '@/lib/branch-context'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/ui/display'

/**
 * Las operaciones que escriben (vender, caja, ingresos, traspasos) exigen una sucursal concreta.
 * En "Todas las sucursales" (consolidado del admin) se pide elegir una antes de continuar.
 */
export function RequireBranch({ children, action = 'operar' }: { children: ReactNode; action?: string }) {
  const { isAll, branches, setBranch } = useBranch()
  if (!isAll) return children
  const active = branches.filter((b) => b.active)
  return (
    <Card className="mx-auto mt-6 max-w-2xl">
      <EmptyState
        icon={<Store />}
        title="Seleccione una sucursal"
        message={`Está viendo el consolidado de todas las sucursales. Para ${action} elija en qué sucursal trabajar.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {active.map((b) => (
              <Button key={b.id} variant="secondary" icon={<Store />} onClick={() => setBranch(b.id)}>
                {b.name}
              </Button>
            ))}
          </div>
        }
      />
    </Card>
  )
}
