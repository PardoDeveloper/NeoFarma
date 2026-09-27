import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArchiveX, Building2, Mail, Pencil, Phone, Plus } from 'lucide-react'
import { suppliersApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { Supplier } from '@/api/types'
import { useDebounce } from '@/lib/hooks'
import { date, formatRut, isValidRut } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { Checkbox, Field, FormSection, Input, Textarea } from '@/components/ui/form'
import { FilterBar, FilterChip, SearchField } from '@/components/ui/filters'
import { MobileList, MobileListItem, SkeletonList } from '@/components/ui/list'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  RowActions,
  SkeletonRows,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { Modal, ModalActions } from '@/components/ui/modal'

export function SuppliersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Supplier | undefined>()
  const [open, setOpen] = useState(false)
  const q = useDebounce(search)
  const list = useQuery({
    queryKey: ['suppliers', q, page, includeInactive],
    queryFn: () => suppliersApi.list({ q, page, page_size: 20, include_inactive: includeInactive || undefined }),
    placeholderData: (prev) => prev,
  })

  function openEdit(s: Supplier) {
    setEditing(s)
    setOpen(true)
  }

  return (
    <div>
      <PageHeader
        title="Proveedores"
        subtitle="Droguerías, laboratorios y distribuidores"
        actions={
          <Button
            icon={<Plus />}
            onClick={() => {
              setEditing(undefined)
              setOpen(true)
            }}
          >
            Nuevo proveedor
          </Button>
        }
      />
      <Card>
        <FilterBar>
          <SearchField
            placeholder="Buscar por razón social, nombre de fantasía o RUT"
            value={search}
            onValueChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            aria-label="Buscar proveedor"
          />
          <FilterChip active={includeInactive} onClick={() => setIncludeInactive((v) => !v)} icon={<ArchiveX />}>
            Incluir inactivos
          </FilterChip>
        </FilterBar>
        {list.isLoading ? (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Proveedor</Th>
                    <Th>RUT</Th>
                    <Th>Contacto</Th>
                    <Th>Condición pago</Th>
                    <Th numeric>Ingresos</Th>
                    <Th>Último ingreso</Th>
                    <Th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  <SkeletonRows rows={6} cols={7} numeric={[4]} />
                </tbody>
              </Table>
            </div>
            <SkeletonList rows={4} />
          </>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.data.length ? (
          <EmptyState
            icon={<Building2 />}
            title="No hay proveedores"
            message="Registre droguerías, laboratorios o distribuidores para agilizar los ingresos de mercadería."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Registrar proveedor
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Proveedor</Th>
                    <Th>RUT</Th>
                    <Th>Contacto</Th>
                    <Th>Condición pago</Th>
                    <Th numeric>Ingresos</Th>
                    <Th>Último ingreso</Th>
                    <Th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((s) => (
                    <Tr key={s.id} onClick={() => openEdit(s)} className={!s.active ? 'opacity-60' : undefined}>
                      <Td>
                        <p className="flex items-center gap-1.5 font-medium text-ink">
                          {s.business_name} {!s.active && <Badge size="sm">Inactivo</Badge>}
                        </p>
                        {s.trade_name && <p className="text-xs text-muted">{s.trade_name}</p>}
                      </Td>
                      <Td className="font-mono text-xs">{formatRut(s.rut)}</Td>
                      <Td>
                        <p className="text-ink-soft">{s.contact_name ?? '—'}</p>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                          {s.phone && (
                            <a
                              href={`tel:${s.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-muted hover:text-brand-700 dark:hover:text-brand-400"
                            >
                              <Phone className="size-3" />
                              {s.phone}
                            </a>
                          )}
                          {s.email && (
                            <a
                              href={`mailto:${s.email}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-muted hover:text-brand-700 dark:hover:text-brand-400"
                            >
                              <Mail className="size-3" />
                              {s.email}
                            </a>
                          )}
                        </div>
                      </Td>
                      <Td className="text-muted">{s.payment_terms_days === 0 ? 'Contado' : `${s.payment_terms_days} días`}</Td>
                      <Td numeric>{s.purchases_count}</Td>
                      <Td className="text-muted">{date(s.last_purchase_at)}</Td>
                      <Td>
                        <RowActions>
                          <IconButton
                            label={`Editar ${s.business_name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openEdit(s)
                            }}
                          >
                            <Pencil />
                          </IconButton>
                        </RowActions>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <MobileList>
              {list.data.data.map((s) => (
                <MobileListItem
                  key={s.id}
                  dimmed={!s.active}
                  aside={
                    <IconButton label={`Editar ${s.business_name}`} onClick={() => openEdit(s)}>
                      <Pencil />
                    </IconButton>
                  }
                >
                  <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                    {s.business_name}
                    {!s.active && <Badge size="sm">Inactivo</Badge>}
                  </p>
                  <p className="font-mono text-xs text-muted">{formatRut(s.rut)}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {s.phone && (
                      <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 text-muted">
                        <Phone className="size-3" />
                        {s.phone}
                      </a>
                    )}
                    {s.email && (
                      <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 text-muted">
                        <Mail className="size-3" />
                        {s.email}
                      </a>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {s.payment_terms_days === 0 ? 'Contado' : `${s.payment_terms_days} días de plazo`} · {s.purchases_count} ingresos
                  </p>
                </MobileListItem>
              ))}
            </MobileList>
            <Pagination page={page} pageSize={20} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Card>
      <SupplierFormModal open={open} onClose={() => setOpen(false)} supplier={editing} />
    </div>
  )
}

const schema = z.object({
  rut: z.string().trim().refine(isValidRut, 'RUT inválido'),
  business_name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(200),
  trade_name: z.string().trim().max(200),
  contact_name: z.string().trim().max(120),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(''), z.email('Email inválido')]),
  address: z.string().trim().max(250),
  payment_terms_days: z.coerce.number<string>().int().min(0).max(365),
  notes: z.string().max(1000),
  active: z.boolean(),
})
type FormValues = z.input<typeof schema>

const toForm = (s?: Supplier): FormValues => ({
  rut: s ? formatRut(s.rut) : '',
  business_name: s?.business_name ?? '',
  trade_name: s?.trade_name ?? '',
  contact_name: s?.contact_name ?? '',
  phone: s?.phone ?? '',
  email: s?.email ?? '',
  address: s?.address ?? '',
  payment_terms_days: String(s?.payment_terms_days ?? 30),
  notes: s?.notes ?? '',
  active: s?.active ?? true,
})

export function SupplierFormModal({
  open,
  onClose,
  supplier,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  supplier?: Supplier
  onSaved?: (s: Supplier) => void
}) {
  const qc = useQueryClient()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: toForm(supplier),
  })
  useEffect(() => {
    if (open) reset(toForm(supplier))
  }, [open, supplier, reset])

  const save = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      const nil = (s: string) => (s.trim() ? s.trim() : null)
      const body = {
        ...v,
        trade_name: nil(v.trade_name),
        contact_name: nil(v.contact_name),
        phone: nil(v.phone),
        email: nil(v.email),
        address: nil(v.address),
        notes: nil(v.notes),
      }
      return supplier ? suppliersApi.update(supplier.id, body) : suppliersApi.create(body)
    },
    onSuccess: (s) => {
      toast.success(supplier ? 'Proveedor actualizado' : 'Proveedor registrado')
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      onSaved?.(s)
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setError('rut', { message: e.message })
      toast.error(errorMessage(e))
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
      description={supplier ? supplier.business_name : 'Droguería, laboratorio o distribuidor'}
      icon={supplier ? <Pencil /> : <Building2 />}
      size="lg"
    >
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-6">
        <FormSection title="Identificación" columns={3}>
          <Field label="RUT" required error={errors.rut?.message} hint={!errors.rut ? 'Con dígito verificador' : undefined}>
            {(id) => (
              <Input
                id={id}
                placeholder="76.123.456-7"
                className="font-mono"
                invalid={!!errors.rut}
                {...register('rut', { onBlur: (e) => setValue('rut', formatRut(e.target.value), { shouldValidate: true }) })}
              />
            )}
          </Field>
          <Field label="Razón social" required error={errors.business_name?.message} className="sm:col-span-1 lg:col-span-2">
            {(id) => <Input id={id} {...register('business_name')} invalid={!!errors.business_name} />}
          </Field>
          <Field label="Nombre de fantasía" className="sm:col-span-2 lg:col-span-3">
            {(id) => <Input id={id} {...register('trade_name')} />}
          </Field>
        </FormSection>
        <FormSection title="Contacto" columns={2}>
          <Field label="Persona de contacto">{(id) => <Input id={id} {...register('contact_name')} />}</Field>
          <Field label="Teléfono">
            {(id) => <Input id={id} leftIcon={<Phone />} {...register('phone')} placeholder="+56 9 1234 5678" />}
          </Field>
          <Field label="Email" error={errors.email?.message}>
            {(id) => <Input id={id} type="email" leftIcon={<Mail />} {...register('email')} invalid={!!errors.email} />}
          </Field>
          <Field label="Dirección">{(id) => <Input id={id} {...register('address')} />}</Field>
        </FormSection>
        <FormSection title="Condiciones" columns={2}>
          <Field label="Plazo de pago (días)" error={errors.payment_terms_days?.message} hint="0 = contado">
            {(id) => <Input id={id} inputMode="numeric" {...register('payment_terms_days')} />}
          </Field>
          <div className="flex items-center sm:pt-7">
            <Checkbox label="Proveedor activo" description="Disponible al registrar ingresos" {...register('active')} />
          </div>
          <Field label="Notas" className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={2} {...register('notes')} />}
          </Field>
        </FormSection>
        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {supplier ? 'Guardar cambios' : 'Registrar proveedor'}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}
