import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Store } from 'lucide-react'
import { branchesApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { Branch, BranchInput } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Checkbox, Field, FormSection, Input } from '@/components/ui/form'
import { Modal, ModalActions } from '@/components/ui/modal'

/** Código: mayúsculas, dígitos, guion y guion bajo (lo exige la BD). */
const normalizeCode = (v: string) =>
  v
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 20)

export function BranchFormModal({ open, branch, onClose }: { open: boolean; branch?: Branch; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={branch ? 'Editar sucursal' : 'Nueva sucursal'}
      description={branch ? branch.name : 'Un local con su propio stock, cajas y ventas'}
      icon={branch ? <Pencil /> : <Store />}
      size="md"
    >
      {/* key: al cambiar de registro se reinicia el formulario */}
      <BranchForm key={branch?.id ?? 'new'} branch={branch} onClose={onClose} />
    </Modal>
  )
}

function BranchForm({ branch, onClose }: { branch?: Branch; onClose: () => void }) {
  const qc = useQueryClient()
  const [code, setCode] = useState(branch?.code ?? '')
  const [name, setName] = useState(branch?.name ?? '')
  const [address, setAddress] = useState(branch?.address ?? '')
  const [phone, setPhone] = useState(branch?.phone ?? '')
  const [active, setActive] = useState(branch?.active ?? true)
  const [touched, setTouched] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      const body: BranchInput = {
        code,
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        active,
      }
      return branch ? branchesApi.update(branch.id, body) : branchesApi.create(body)
    },
    onSuccess: (b) => {
      toast.success(branch ? `Sucursal ${b.name} actualizada` : `Sucursal ${b.name} creada`)
      // ['branches'] incluye la lista del selector de sucursal (BranchProvider).
      qc.invalidateQueries({ queryKey: ['branches'] })
      onClose()
    },
  })

  const err = save.error instanceof ApiError ? save.error : null
  const fields = err?.fields ?? {}
  const codeClientErr = code.length < 2 ? 'Mínimo 2 caracteres' : undefined
  const nameClientErr = name.trim().length < 2 ? 'Mínimo 2 caracteres' : undefined
  const codeErr = codeClientErr ?? (err?.code === 'invalid_code' ? err.message : fields.code ? 'Código inválido' : undefined)
  const nameErr = nameClientErr ?? (fields.name ? 'Nombre inválido' : undefined)
  const deactivating = !!branch?.active && !active

  function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (codeClientErr || nameClientErr) return
    save.mutate()
  }

  // Errores que no son de un campo concreto (cajas abiertas, duplicado, red) se muestran arriba, junto al formulario.
  const generalError = save.error && !(err?.code === 'invalid_code') ? errorMessage(save.error) : null

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {generalError && (
        <Callout tone="danger" role="alert" title={err?.code === 'open_sessions' ? 'No se puede desactivar' : 'No se pudo guardar'}>
          {generalError}
        </Callout>
      )}
      <FormSection title="Identificación" columns={2}>
        <Field label="Código" required error={touched || save.isError ? codeErr : undefined} hint="Mayúsculas, números, - o _ (ej. CENTRO)">
          {(id) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              invalid={(touched || save.isError) && !!codeErr}
              className="font-mono tracking-wide uppercase"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              placeholder="CENTRO"
            />
          )}
        </Field>
        <Field label="Nombre" required error={touched || save.isError ? nameErr : undefined}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              invalid={(touched || save.isError) && !!nameErr}
              maxLength={80}
              placeholder="Sucursal Centro"
            />
          )}
        </Field>
      </FormSection>
      <FormSection title="Contacto" columns={2}>
        <Field label="Dirección" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={200}
              placeholder="Av. Principal 123, Comuna"
            />
          )}
        </Field>
        <Field label="Teléfono">
          {(id) => (
            <Input
              id={id}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={40}
              placeholder="+56 2 2345 6789"
            />
          )}
        </Field>
      </FormSection>
      {branch && (
        <div className="space-y-3">
          <Checkbox
            label="Sucursal activa"
            description="Una sucursal inactiva no aparece para operar ni como destino de traspasos."
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {deactivating && err?.code !== 'open_sessions' && (
            <Callout tone="warn" compact>
              Sus usuarios dejarán de poder operar en ella. Debe cerrar antes las cajas abiertas.
            </Callout>
          )}
        </div>
      )}
      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending} variant={deactivating ? 'danger' : 'primary'}>
          {branch ? (deactivating ? 'Desactivar y guardar' : 'Guardar cambios') : 'Crear sucursal'}
        </Button>
      </ModalActions>
    </form>
  )
}
