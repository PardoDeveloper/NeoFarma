import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Boxes, FlaskConical, Layers, Pencil, Shield, ShoppingCart, Store, UserPlus } from 'lucide-react'
import { usersApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { Branch, Role, User } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { dateTime, roleLabel } from '@/lib/format'
import { initials } from '@/components/layout/nav'
import { Button, IconButton } from '@/components/ui/button'
import { Checkbox, Field, Input, Select } from '@/components/ui/form'
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  IconTile,
  PageHeader,
  RowActions,
  SkeletonRows,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import { Modal, ModalActions } from '@/components/ui/modal'
import { cn } from '@/lib/cn'

const rolePermissions: { role: Role; icon: typeof Shield; description: string }[] = [
  { role: 'admin', icon: Shield, description: 'Acceso total al sistema y gestión de usuarios.' },
  { role: 'quimico', icon: FlaskConical, description: 'Ventas, anulaciones, inventario, compras y reportes.' },
  { role: 'cajero', icon: ShoppingCart, description: 'Punto de venta, caja y consulta de ventas.' },
  { role: 'bodega', icon: Boxes, description: 'Productos, proveedores, ingresos y ajustes de stock.' },
]

const roleIcon = Object.fromEntries(rolePermissions.map((r) => [r.role, r.icon])) as Record<Role, typeof Shield>

/** Rol = dato, no estado: badge neutro con icono (los colores quedan para estados). */
function RoleBadge({ role }: { role: Role }) {
  const Icon = roleIcon[role]
  return <Badge icon={<Icon className="text-muted" aria-hidden />}>{roleLabel[role]}</Badge>
}

function Avatar({ user }: { user: User }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        user.active ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'bg-subtle text-muted',
      )}
      aria-hidden
    >
      {initials(user.full_name) || user.username.slice(0, 2).toUpperCase()}
    </span>
  )
}

/** Sucursales del usuario: "Todas" para admin; hasta 2 nombres y "+N" (con la lista completa en el tooltip). */
function UserBranches({ user, branches }: { user: User; branches: Branch[] }) {
  if (user.role === 'admin')
    return (
      <Badge tone="brand" icon={<Layers aria-hidden />} title="El administrador accede a todas las sucursales">
        Todas
      </Badge>
    )
  const mine = branches.filter((b) => user.branch_ids.includes(b.id))
  if (!mine.length) return <span className="text-xs font-medium text-danger-700 dark:text-danger-300">Sin sucursal</span>
  const shown = mine.slice(0, 2)
  const rest = mine.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1" title={mine.map((b) => b.name).join(', ')}>
      {shown.map((b) => (
        <Badge key={b.id} icon={<Store className="text-muted" aria-hidden />} className={b.active ? undefined : 'line-through opacity-70'}>
          {b.name}
        </Badge>
      ))}
      {rest > 0 && <Badge>+{rest}</Badge>}
    </span>
  )
}

export function UsersPage() {
  const q = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { branches } = useBranch()
  const multiBranch = branches.length > 1
  const [editing, setEditing] = useState<User | undefined>()
  const [open, setOpen] = useState(false)
  const activeCount = q.data?.data.filter((u) => u.active).length ?? 0
  const edit = (u: User) => {
    setEditing(u)
    setOpen(true)
  }

  return (
    <div>
      <PageHeader
        title="Usuarios"
        subtitle={q.data ? `${q.data.data.length} cuentas · ${activeCount} activas` : 'Cuentas del personal y sus permisos'}
        actions={
          <Button
            icon={<UserPlus className="size-4" />}
            onClick={() => {
              setEditing(undefined)
              setOpen(true)
            }}
          >
            Nuevo usuario
          </Button>
        }
      />
      <Card>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Nombre</Th>
                    <Th>Usuario</Th>
                    <Th>Rol</Th>
                    {multiBranch && <Th>Sucursales</Th>}
                    <Th>Estado</Th>
                    <Th className={multiBranch ? 'hidden 2xl:table-cell' : undefined}>Creado</Th>
                    <Th className="w-14" />
                  </tr>
                </thead>
                <tbody>
                  {q.isLoading ? (
                    <SkeletonRows rows={5} cols={6} />
                  ) : (
                    q.data?.data.map((u) => (
                      <Tr key={u.id} onClick={() => edit(u)} className={u.active ? undefined : 'opacity-60'}>
                        <Td>
                          <div className="flex items-center gap-3">
                            <Avatar user={u} />
                            <span className="font-medium whitespace-nowrap text-ink">{u.full_name}</span>
                          </div>
                        </Td>
                        <Td className="font-mono text-xs text-muted">{u.username}</Td>
                        <Td>
                          <RoleBadge role={u.role} />
                        </Td>
                        {multiBranch && (
                          <Td>
                            <UserBranches user={u} branches={branches} />
                          </Td>
                        )}
                        <Td>
                          {u.active ? (
                            <Badge tone="ok" dot>
                              Activo
                            </Badge>
                          ) : (
                            <Badge dot>Inactivo</Badge>
                          )}
                        </Td>
                        <Td className={cn('whitespace-nowrap text-muted', multiBranch && 'hidden 2xl:table-cell')}>
                          {dateTime(u.created_at)}
                        </Td>
                        <Td>
                          <RowActions>
                            <IconButton
                              label={`Editar ${u.full_name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                edit(u)
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
              <SkeletonList rows={5} />
            ) : (
              <MobileList>
                {q.data?.data.map((u) => (
                  <MobileListItem
                    key={u.id}
                    onClick={() => edit(u)}
                    dimmed={!u.active}
                    aside={
                      u.active ? (
                        <Badge tone="ok" dot>
                          Activo
                        </Badge>
                      ) : (
                        <Badge dot>Inactivo</Badge>
                      )
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Avatar user={u} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{u.full_name}</p>
                        <p className="mt-0.5 flex items-center gap-2">
                          <span className="font-mono text-xs text-muted">{u.username}</span>
                          <RoleBadge role={u.role} />
                        </p>
                        {multiBranch && (
                          <div className="mt-1.5">
                            <UserBranches user={u} branches={branches} />
                          </div>
                        )}
                      </div>
                    </div>
                  </MobileListItem>
                ))}
              </MobileList>
            )}
          </>
        )}
      </Card>

      <Card className="mt-6 p-5">
        <CardHeader bordered={false} className="px-0 pt-0 pb-4" title="Permisos por rol" subtitle="Qué puede hacer cada tipo de cuenta" />
        <div className="grid gap-3 sm:grid-cols-2">
          {rolePermissions.map(({ role, icon: Icon, description }) => (
            <div key={role} className="flex items-start gap-3 rounded-xl border border-line bg-subtle/50 p-4">
              <IconTile tone="brand">
                <Icon />
              </IconTile>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{roleLabel[role]}</p>
                <p className="mt-0.5 text-sm text-muted">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <UserFormModal open={open} user={editing} onClose={() => setOpen(false)} />
    </div>
  )
}

function UserFormModal({ open, user, onClose }: { open: boolean; user?: User; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? 'Editar usuario' : 'Nuevo usuario'}
      description={user ? `Cuenta de ${user.full_name}` : 'Crea una cuenta de acceso para el personal'}
      icon={user ? <Pencil /> : <UserPlus />}
      size="sm"
    >
      <UserForm user={user} onClose={onClose} />
    </Modal>
  )
}

function UserForm({ user, onClose }: { user?: User; onClose: () => void }) {
  const qc = useQueryClient()
  const { branches, current } = useBranch()
  const [username, setUsername] = useState(user?.username ?? '')
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'cajero')
  const [active, setActive] = useState(user?.active ?? true)
  const [password, setPassword] = useState('')
  // Nuevo usuario: se propone la sucursal activa (o la única activa). Al editar se respetan sus asignaciones.
  const [branchIds, setBranchIds] = useState<number[]>(() => {
    if (user) return user.branch_ids
    const activeBranches = branches.filter((b) => b.active)
    if (current?.active) return [current.id]
    return activeBranches.length === 1 ? [activeBranches[0].id] : []
  })
  const [touched, setTouched] = useState(false)
  const isAdminRole = role === 'admin'

  const save = useMutation({
    mutationFn: () => {
      const branch_ids = isAdminRole ? [] : branchIds
      return user
        ? usersApi.update(user.id, { full_name: fullName, role, active, password: password || undefined, branch_ids })
        : usersApi.create({ username, full_name: fullName, role, password, branch_ids })
    },
    onSuccess: () => {
      toast.success(user ? 'Usuario actualizado' : 'Usuario creado')
      qc.invalidateQueries({ queryKey: ['users'] })
      // El conteo de usuarios por sucursal cambia (página Sucursales).
      qc.invalidateQueries({ queryKey: ['branches'] })
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === 'branches_required' || e.code === 'invalid_branch')) return
      toast.error(errorMessage(e))
    },
  })

  const serverBranchErr =
    save.error instanceof ApiError && (save.error.code === 'branches_required' || save.error.code === 'invalid_branch')
      ? save.error.message
      : undefined
  const branchErr = isAdminRole
    ? undefined
    : branchIds.length === 0
      ? touched
        ? 'Asigne al menos una sucursal'
        : undefined
      : serverBranchErr

  const pwdInvalid = (!user && password.length < 8) || (!!user && password !== '' && password.length < 8)
  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (pwdInvalid) return toast.error('La contraseña debe tener al menos 8 caracteres')
    if (!isAdminRole && branchIds.length === 0) return
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Usuario" required hint="Minúsculas, números, punto o guion">
        {(id) => <Input id={id} value={username} disabled={!!user} onChange={(e) => setUsername(e.target.value.toLowerCase())} required />}
      </Field>
      <Field label="Nombre completo" required>
        {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} required />}
      </Field>
      <Field label="Rol" required>
        {(id) => (
          <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(roleLabel) as Role[]).map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {isAdminRole ? (
        <Callout tone="info" compact icon={<Layers />}>
          El administrador accede a todas las sucursales; no necesita asignación.
        </Callout>
      ) : (
        <BranchPicker branches={branches} value={branchIds} onChange={setBranchIds} error={branchErr} />
      )}
      <Field label={user ? 'Nueva contraseña (opcional)' : 'Contraseña'} required={!user} hint="Mínimo 8 caracteres">
        {(id) => (
          <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      {user && (
        <Checkbox
          label="Usuario activo"
          description="Puede iniciar sesión en el sistema"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      )}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending}>
          {user ? 'Guardar cambios' : 'Crear usuario'}
        </Button>
      </ModalActions>
    </form>
  )
}

/**
 * Sucursales donde trabaja el usuario (≥1). Muestra las activas y, si el usuario ya tenía asignada
 * alguna inactiva, también esa (marcada) para no quitársela sin querer.
 */
function BranchPicker({
  branches,
  value,
  onChange,
  error,
}: {
  branches: Branch[]
  value: number[]
  onChange: (ids: number[]) => void
  error?: string
}) {
  const options = branches.filter((b) => b.active || value.includes(b.id))
  const allSelected = options.length > 1 && options.every((b) => value.includes(b.id))
  const toggle = (id: number, on: boolean) => onChange(on ? [...value, id] : value.filter((v) => v !== id))
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby="user-branches-help">
      <div className="flex items-baseline justify-between gap-2">
        <legend className="float-left text-sm font-medium text-ink-soft">
          Sucursales
          <span className="ml-0.5 text-danger-600 dark:text-danger-400" aria-hidden>
            *
          </span>
        </legend>
        {options.length > 1 && (
          <button
            type="button"
            onClick={() => onChange(allSelected ? [] : options.filter((b) => b.active).map((b) => b.id))}
            className="rounded text-xs font-medium text-brand-700 hover:underline focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none dark:text-brand-300"
          >
            {allSelected ? 'Quitar todas' : 'Marcar todas'}
          </button>
        )}
      </div>
      <div
        className={cn(
          'divide-y divide-line overflow-hidden rounded-lg border bg-surface dark:bg-canvas/40',
          error ? 'border-danger-500' : 'border-line-strong',
        )}
      >
        {options.map((b) => (
          <Checkbox
            key={b.id}
            className="flex w-full px-3 py-2.5 transition-colors hover:bg-subtle/60"
            checked={value.includes(b.id)}
            onChange={(e) => toggle(b.id, e.target.checked)}
            label={
              <span className="flex items-center gap-2">
                <span className={b.active ? 'font-medium text-ink' : 'font-medium text-muted'}>{b.name}</span>
                <span className="font-mono text-xs text-faint">{b.code}</span>
                {!b.active && <Badge size="sm">Inactiva</Badge>}
              </span>
            }
          />
        ))}
      </div>
      {error ? (
        <p className="flex items-center gap-1 text-xs font-medium text-danger-600 dark:text-danger-400" role="alert">
          {error}
        </p>
      ) : (
        <p id="user-branches-help" className="text-xs text-muted">
          Solo verá y operará el stock, la caja y las ventas de estas sucursales.
        </p>
      )}
    </fieldset>
  )
}
