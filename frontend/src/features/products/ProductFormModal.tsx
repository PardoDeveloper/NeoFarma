import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Barcode, Package, Pencil, ShieldCheck } from 'lucide-react'
import { catalogApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { DosageForm, IngredientUnit, Product, ProductInput } from '@/api/types'
import { clp, dosageFormGroups, saleConditionLabel } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Modal, ModalActions } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, FormSection, Input, Select } from '@/components/ui/form'
import { IngredientsField } from './IngredientsField'
import { parseDose, productSchema, toForm, type ProductFormOutput, type ProductFormValues } from './productForm'

export function ProductFormModal({ open, onClose, product }: { open: boolean; onClose: () => void; product?: Product }) {
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories })
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
    control,
  } = useForm<ProductFormValues, unknown, ProductFormOutput>({ resolver: zodResolver(productSchema), defaultValues: toForm(product) })

  useEffect(() => {
    if (open) reset(toForm(product))
  }, [open, product, reset])

  const save = useMutation({
    mutationFn: (v: ProductFormOutput) => {
      const body: ProductInput = {
        ...v,
        barcode: v.barcode || null,
        ingredients: v.ingredients
          .filter((r) => r.name)
          .map((r) => ({ name: r.name, dose: r.dose ? parseDose(r.dose) : null, unit: r.dose ? (r.unit as IngredientUnit) : null })),
        presentation: v.presentation || null,
        laboratory: v.laboratory || null,
        dosage_form: (v.dosage_form || null) as DosageForm | null,
        isp_registry: v.isp_registry || null,
        category_id: v.category_id ? Number(v.category_id) : null,
      }
      return product ? catalogApi.updateProduct(product.id, body) : catalogApi.createProduct(body)
    },
    onSuccess: (p) => {
      toast.success(product ? 'Producto actualizado' : `Producto ${p.name} creado`)
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['product', p.id] })
      onClose()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setError('sku', { message: e.message })
      if (e instanceof ApiError && e.fields.isp_registry) setError('isp_registry', { message: 'Formato inválido. Ej: F-12345/20' })
      if (e instanceof ApiError && e.fields.dosage_form) setError('dosage_form', { message: 'Seleccione una forma de la lista' })
      if (e instanceof ApiError) {
        // Errores por fila del backend: "ingredients[0].unit" → ingredients.0.unit
        for (const [key, rule] of Object.entries(e.fields)) {
          const m = /^ingredients\[(\d+)\]\.(name|dose|unit)$/.exec(key)
          if (m) {
            const msg =
              rule === 'unique' ? 'Principio activo repetido' : m[2] === 'unit' ? 'Seleccione una unidad válida' : 'Valor inválido'
            setError(`ingredients.${Number(m[1])}.${m[2] as 'name' | 'dose' | 'unit'}`, { message: msg })
          }
        }
      }
      toast.error(errorMessage(e))
    },
  })

  const [priceRaw, costRaw] = useWatch({ control, name: ['price', 'cost'] })
  const price = Number(priceRaw) || 0
  const cost = Number(costRaw) || 0
  const net = Math.round(price / 1.19)
  const margin = net > 0 ? Math.round(((net - cost) / net) * 100) : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Editar producto' : 'Nuevo producto'}
      description={product ? product.name : 'Medicamento o insumo del catálogo'}
      icon={product ? <Pencil /> : <Package />}
      size="lg"
    >
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-6">
        <FormSection title="Identificación">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SKU" required error={errors.sku?.message}>
              {(id) => <Input id={id} {...register('sku')} invalid={!!errors.sku} className="font-mono uppercase" />}
            </Field>
            <Field label="Código de barras" error={errors.barcode?.message}>
              {(id) => <Input id={id} leftIcon={<Barcode />} {...register('barcode')} placeholder="EAN-13" className="font-mono" />}
            </Field>
            <Field label="Laboratorio">{(id) => <Input id={id} {...register('laboratory')} />}</Field>
          </div>
          <Field label="Nombre comercial" required error={errors.name?.message}>
            {(id) => <Input id={id} {...register('name')} invalid={!!errors.name} placeholder="Ej: Paracetamol 500 mg" />}
          </Field>
          <IngredientsField control={control} register={register} errors={errors} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Forma farmacéutica" error={errors.dosage_form?.message}>
              {(id) => (
                <Select id={id} {...register('dosage_form')} invalid={!!errors.dosage_form}>
                  <option value="">Sin especificar</option>
                  {dosageFormGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.forms.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Presentación">{(id) => <Input id={id} {...register('presentation')} placeholder="Comprimidos x 16" />}</Field>
            <Field label="Registro ISP" error={errors.isp_registry?.message} hint="Registro sanitario del ISP">
              {(id) => (
                <Input
                  id={id}
                  leftIcon={<ShieldCheck />}
                  {...register('isp_registry')}
                  invalid={!!errors.isp_registry}
                  placeholder="F-12345/20"
                  className="font-mono uppercase"
                />
              )}
            </Field>
          </div>
        </FormSection>

        <FormSection title="Clasificación">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoría">
              {(id) => (
                <Select id={id} {...register('category_id')}>
                  <option value="">Sin categoría</option>
                  {categories.data?.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Condición de venta" required>
              {(id) => (
                <Select id={id} {...register('sale_condition')}>
                  {Object.entries(saleConditionLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <Checkbox label="Bioequivalente" description="Se destaca con distintivo BE" {...register('is_bioequivalent')} />
            <Checkbox label="Genérico" description="Denominación común, sin marca comercial" {...register('is_generic')} />
            <Checkbox label="Activo" description="Visible en catálogo y ventas" {...register('active')} />
          </div>
        </FormSection>

        <FormSection title="Precio y stock">
          <div className="grid gap-4 rounded-xl border border-line bg-subtle/60 p-4 sm:grid-cols-4">
            <Field label="Precio venta (IVA incl.)" required error={errors.price?.message}>
              {(id) => <Input id={id} inputMode="numeric" {...register('price')} invalid={!!errors.price} />}
            </Field>
            <Field label="Costo neto" error={errors.cost?.message} hint="Se actualiza con cada ingreso">
              {(id) => <Input id={id} inputMode="numeric" {...register('cost')} invalid={!!errors.cost} />}
            </Field>
            <Field label="Stock mínimo" error={errors.min_stock?.message}>
              {(id) => <Input id={id} inputMode="numeric" {...register('min_stock')} />}
            </Field>
            <div className="text-sm">
              <p className="text-sm font-medium text-ink-soft">Margen</p>
              <p
                className={cn(
                  'mt-1.5 text-2xl font-bold tabular-nums',
                  price <= 0 ? 'text-faint' : margin < 15 ? 'text-warn-700 dark:text-warn-400' : 'text-ok-700 dark:text-ok-400',
                )}
              >
                {price > 0 ? `${margin}%` : '—'}
              </p>
              <p className="text-xs text-muted tabular-nums">Neto {clp(net)}</p>
            </div>
          </div>
        </FormSection>

        <ModalActions>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {product ? 'Guardar cambios' : 'Crear producto'}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}
