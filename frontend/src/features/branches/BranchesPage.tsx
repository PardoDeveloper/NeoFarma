import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin, Pencil, Phone, Plus, Store, Wallet } from 'lucide-react'
import { branchesApi } from '@/api/endpoints'
import type { Branch } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { Button, IconButton } from '@/components/ui/button'
import { Badge, Card, EmptyState, ErrorState, PageHeader, RowActions, SkeletonRows, Table, Td, Th, Tr } from '@/components/ui/display'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import { BranchCode, BranchStatusBadge } from './BranchBits'
import { BranchFormModal } from './BranchForm'
import { RegistersDrawer } from './RegistersDrawer'

/**
 * Administración de sucursales (solo admin): datos de cada local y, al seleccionarlo, sus cajas (drawer).
 * Las cajas se administran con `X-Branch-ID` explícito de esa sucursal (`cashApi.*Register(branchId, …)`),
 * sin cambiar la sucursal activa del usuario.
 */
export function BranchesPage() {
  // Misma query que BranchProvider (comparte caché): admin recibe todas, incluidas las inactivas.
  const q = useQuery({ queryKey: ['branches', 'mine'], queryFn: branchesApi.list })
  const { current } = useBranch()
  const [form, setForm] = useState<{ open: boolean; branch?: Branch }>({ open: false })
  const [registersOf, setRegistersOf] = useState<number | null>(null)
  const list = q.data?.data ?? []
  const active = list.filter((b) => b.active).length
  const selected = list.find((b) => b.id === registersOf)
  const edit = (b?: Branch) => setForm({ open: true, branch: b })

  return (
    <div>
      <PageHeader
        title="Sucursales"
        subtitle={
          q.data ? `${list.length} ${list.length === 1 ? 'local' : 'locales'} · ${active} activas` : 'Locales de la farmacia y sus cajas'
        }
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => edit()}>
            Nueva sucursal
          </Button>
        }
      />

      <Card>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.isLoading && list.length === 0 ? (
          <EmptyState
            icon={<Store />}
            title="Aún no hay sucursales"
            message="Cree el primer local para asignarle usuarios y cajas."
            action={<Button onClick={() => edit()}>Nueva sucursal</Button>}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th className="w-28">Código</Th>
                    <Th>Sucursal</Th>
                    <Th className="hidden xl:table-cell">Dirección</Th>
                    <Th>Teléfono</Th>
                    <Th numeric>Usuarios</Th>
                    <Th numeric>Cajas</Th>
                    <Th>Estado</Th>
                    <Th className="w-32" />
                  </tr>
                </thead>
                <tbody>
                  {q.isLoading ? (
                    <SkeletonRows rows={3} cols={8} numeric={[4, 5]} />
                  ) : (
                    list.map((b) => (
                      <Tr key={b.id} onClick={() => setRegistersOf(b.id)} selected={registersOf === b.id}>
                        <Td>
                          <BranchCode code={b.code} />
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className={b.active ? 'font-medium text-ink' : 'font-medium text-muted'}>{b.name}</span>
                            {current?.id === b.id && (
                              <Badge tone="brand" size="sm">
                                Sucursal actual
                              </Badge>
                            )}
                          </div>
                          {b.address && <p className="mt-0.5 truncate text-xs text-muted xl:hidden">{b.address}</p>}
                        </Td>
                        <Td className="hidden max-w-xs truncate text-muted xl:table-cell" title={b.address ?? undefined}>
                          {b.address ?? <span className="text-faint">—</span>}
                        </Td>
                        <Td className="whitespace-nowrap text-muted tabular-nums">{b.phone ?? <span className="text-faint">—</span>}</Td>
                        <Td numeric>{b.users}</Td>
                        <Td numeric>{b.registers}</Td>
                        <Td>
                          <BranchStatusBadge active={b.active} />
                        </Td>
                        <Td>
                          <RowActions>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Wallet />}
                              onClick={(e) => {
                                e.stopPropagation()
                                setRegistersOf(b.id)
                              }}
                            >
                              Cajas
                            </Button>
                            <IconButton
                              label={`Editar ${b.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                edit(b)
                              }}
                            >
                              <Pencil />
                            </IconButton>
                          </RowActions>
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
            {q.isLoading ? (
              <SkeletonList rows={3} />
            ) : (
              <MobileList>
                {list.map((b) => (
                  <MobileListItem
                    key={b.id}
                    onClick={() => setRegistersOf(b.id)}
                    dimmed={!b.active}
                    aside={<BranchStatusBadge active={b.active} />}
                  >
                    <div className="flex items-center gap-2">
                      <BranchCode code={b.code} />
                      <span className="truncate font-medium text-ink">{b.name}</span>
                    </div>
                    {b.address && (
                      <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-muted">
                        <MapPin className="size-3.5 shrink-0 text-faint" aria-hidden />
                        {b.address}
                      </p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
                      {b.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="size-3.5 text-faint" aria-hidden />
                          {b.phone}
                        </span>
                      )}
                      <span>
                        {b.users} {b.users === 1 ? 'usuario' : 'usuarios'} · {b.registers} {b.registers === 1 ? 'caja' : 'cajas'}
                      </span>
                    </p>
                  </MobileListItem>
                ))}
              </MobileList>
            )}
          </>
        )}
      </Card>
      {!q.isLoading && list.length > 0 && <p className="mt-3 text-xs text-muted">Seleccione una sucursal para administrar sus cajas.</p>}

      <BranchFormModal open={form.open} branch={form.branch} onClose={() => setForm((f) => ({ ...f, open: false }))} />
      <RegistersDrawer
        branch={selected}
        onClose={() => setRegistersOf(null)}
        onEdit={(b) => {
          edit(b)
        }}
      />
    </div>
  )
}
