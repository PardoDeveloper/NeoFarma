import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, Plus, Power, Wallet, X } from 'lucide-react'
import { cashApi } from '@/api/endpoints'
import { errorMessage } from '@/api/client'
import type { Branch, CashRegister } from '@/api/types'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/components/ui/button'
import { Badge, Callout, EmptyState, ErrorState, Skeleton } from '@/components/ui/display'
import { Drawer } from '@/components/ui/drawer'
import { Input } from '@/components/ui/form'
import { BranchCode, BranchStatusBadge } from './BranchBits'

const registersKey = (branchId: number) => ['branches', branchId, 'registers'] as const

/** Tras crear/editar cajas: conteo de la sucursal, su lista y las cajas de la sucursal activa (abrir caja). */
function useInvalidateRegisters(branchId: number) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: registersKey(branchId) })
    qc.invalidateQueries({ queryKey: ['branches', 'mine'] })
    qc.invalidateQueries({ queryKey: ['cash'] })
  }
}

/** Panel lateral con las cajas de una sucursal: estado (libre / en uso), crear, renombrar y (des)activar. */
export function RegistersDrawer({ branch, onClose, onEdit }: { branch?: Branch; onClose: () => void; onEdit: (b: Branch) => void }) {
  return (
    <Drawer
      open={!!branch}
      onClose={onClose}
      width="lg"
      title={branch?.name ?? ''}
      description={branch?.address ?? undefined}
      meta={
        branch && (
          <>
            <BranchCode code={branch.code} />
            <BranchStatusBadge active={branch.active} />
          </>
        )
      }
      actions={
        branch && (
          <IconButton label={`Editar ${branch.name}`} size="md" onClick={() => onEdit(branch)}>
            <Pencil />
          </IconButton>
        )
      }
      toolbar={branch && <NewRegisterForm key={branch.id} branchId={branch.id} />}
    >
      {branch && <RegistersList key={branch.id} branch={branch} />}
    </Drawer>
  )
}

function NewRegisterForm({ branchId }: { branchId: number }) {
  const [name, setName] = useState('')
  const invalidate = useInvalidateRegisters(branchId)
  const create = useMutation({
    mutationFn: () => cashApi.createRegister(branchId, { name: name.trim() }),
    onSuccess: (r) => {
      toast.success(`${r.name} creada`)
      setName('')
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const tooShort = name.trim().length < 2
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!tooShort) create.mutate()
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label htmlFor={`new-register-${branchId}`} className="sr-only">
        Nombre de la nueva caja
      </label>
      <Input
        id={`new-register-${branchId}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre de la nueva caja (ej. Caja 2)"
        maxLength={40}
        leftIcon={<Wallet />}
      />
      <Button type="submit" icon={<Plus />} loading={create.isPending} disabled={tooShort}>
        Agregar
      </Button>
    </form>
  )
}

function RegistersList({ branch }: { branch: Branch }) {
  const q = useQuery({ queryKey: registersKey(branch.id), queryFn: () => cashApi.registersOf(branch.id) })
  const list = q.data?.data ?? []
  const inUse = list.filter((r) => r.open_session_id).length
  const activeCount = list.filter((r) => r.active).length

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return (
    <div className="space-y-4">
      {!branch.active && (
        <Callout tone="warn" compact>
          Sucursal inactiva: sus cajas no se pueden usar hasta reactivarla.
        </Callout>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="section-label">Cajas</h3>
        {q.data && list.length > 0 && (
          <p className="text-xs text-muted tabular-nums">
            {activeCount} {activeCount === 1 ? 'activa' : 'activas'} · {inUse} en uso
          </p>
        )}
      </div>
      {q.isLoading ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          compact
          icon={<Wallet />}
          title="Sin cajas"
          message="Agregue la primera caja para poder abrir turnos y vender en esta sucursal."
          className="rounded-xl border border-dashed border-line-strong"
        />
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <RegisterRow key={r.id} branchId={branch.id} register={r} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RegisterStatus({ register: r }: { register: CashRegister }) {
  if (!r.active) return <Badge dot>Inactiva</Badge>
  if (r.open_session_id)
    return (
      <Badge tone="info" dot>
        En uso
      </Badge>
    )
  return (
    <Badge tone="ok" dot>
      Libre
    </Badge>
  )
}

function RegisterRow({ branchId, register: r }: { branchId: number; register: CashRegister }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(r.name)
  const invalidate = useInvalidateRegisters(branchId)
  const update = useMutation({
    mutationFn: (body: { name: string; active?: boolean }) => cashApi.updateRegister(branchId, r.id, body),
    onSuccess: (_, body) => {
      toast.success(body.active === undefined ? 'Caja renombrada' : body.active ? `${r.name} activada` : `${r.name} desactivada`)
      setEditing(false)
      invalidate()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const open = !!r.open_session_id
  const rename = (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (n.length < 2) return
    if (n === r.name) return setEditing(false)
    update.mutate({ name: n })
  }

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-xl border border-line bg-surface p-3 pl-3.5',
        !r.active && 'bg-subtle/50',
        open && 'border-info-200 dark:border-info-500/30',
      )}
    >
      <span
        className={cn(
          'hidden size-9 shrink-0 items-center justify-center rounded-lg sm:flex',
          r.active ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'bg-subtle text-faint',
        )}
        aria-hidden
      >
        <Wallet className="size-[18px]" />
      </span>

      {editing ? (
        <form onSubmit={rename} data-escape-local className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            autoFocus
            aria-label={`Nuevo nombre de ${r.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setName(r.name)
                setEditing(false)
              }
            }}
            maxLength={40}
            inputSize="sm"
          />
          <IconButton label="Guardar nombre" type="submit" disabled={name.trim().length < 2 || update.isPending}>
            <Check />
          </IconButton>
          <IconButton
            label="Cancelar"
            onClick={() => {
              setName(r.name)
              setEditing(false)
            }}
          >
            <X />
          </IconButton>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={cn('truncate font-medium', r.active ? 'text-ink' : 'text-muted')}>{r.name}</p>
              <RegisterStatus register={r} />
            </div>
            {open && (
              <p className="mt-1 truncate text-xs text-muted">
                Turno abierto
                {r.open_session_user && (
                  <>
                    {' '}
                    por <span className="font-medium text-ink-soft">{r.open_session_user}</span>
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label={`Renombrar ${r.name}`} onClick={() => setEditing(true)}>
              <Pencil />
            </IconButton>
            {/* Con turno abierto no se puede desactivar: se explica en el tooltip del contenedor (el botón deshabilitado no lo muestra). */}
            <span title={r.active && open ? 'Cierre el turno para desactivarla' : undefined}>
              <Button
                variant={r.active ? 'ghost' : 'secondary'}
                size="sm"
                icon={<Power />}
                loading={update.isPending}
                disabled={r.active && open}
                aria-label={`${r.active ? 'Desactivar' : 'Activar'} ${r.name}`}
                onClick={() => update.mutate({ name: r.name, active: !r.active })}
                className={cn('px-2 sm:px-3', r.active && 'text-muted hover:text-danger-700 dark:hover:text-danger-300')}
              >
                <span className="hidden sm:inline">{r.active ? 'Desactivar' : 'Activar'}</span>
              </Button>
            </span>
          </div>
        </>
      )}
    </li>
  )
}
