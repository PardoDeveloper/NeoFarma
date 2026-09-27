import { useFieldArray, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { FlaskConical, Plus, Trash2 } from 'lucide-react'
import { ingredientUnits } from '@/lib/format'
import { Button, IconButton } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form'
import { emptyIngredient, type ProductFormOutput, type ProductFormValues } from './productForm'

export const MAX_INGREDIENTS = 10

// Columnas: nombre (flexible) · dosis · concentración (unidad) · quitar. En móvil el nombre ocupa su propia fila.
const cols = 'grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_2.25rem]'

/** Lista editable de principios activos: Nombre · Dosis · Concentración (ej. Paracetamol · 325 · mg). */
export function IngredientsField({
  control,
  register,
  errors,
}: {
  control: Control<ProductFormValues, unknown, ProductFormOutput>
  register: UseFormRegister<ProductFormValues>
  errors: FieldErrors<ProductFormValues>
}) {
  const errs = errors.ingredients
  const { fields, append, remove } = useFieldArray({ control, name: 'ingredients' })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink-soft">Principios activos</p>
        <p className="text-xs text-muted">
          {fields.length === 0 ? 'Sin principios activos (insumo)' : `${fields.length} de ${MAX_INGREDIENTS}`}
        </p>
      </div>

      {fields.length > 0 && (
        <div className="rounded-xl border border-line bg-subtle/40 p-3">
          <div className={`${cols} mb-1.5 hidden px-0.5 text-xs font-medium text-muted sm:grid`}>
            <span>Nombre</span>
            <span>Dosis</span>
            <span>Concentración</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {fields.map((f, i) => {
              const e = errs?.[i]
              return (
                <div key={f.id} className="border-b border-line pb-2 last:border-0 last:pb-0 sm:border-0 sm:pb-0">
                  <div className={cols}>
                    <Input
                      aria-label={`Nombre del principio activo ${i + 1}`}
                      placeholder={i === 0 ? 'Ej: Paracetamol' : 'Nombre'}
                      leftIcon={<FlaskConical />}
                      {...register(`ingredients.${i}.name`)}
                      invalid={!!e?.name}
                      wrapperClassName="col-span-3 sm:col-span-1"
                    />
                    <Input
                      aria-label={`Dosis del principio activo ${i + 1}`}
                      placeholder="325"
                      inputMode="decimal"
                      {...register(`ingredients.${i}.dose`)}
                      invalid={!!e?.dose}
                      className="text-right tabular-nums"
                    />
                    <Select
                      aria-label={`Concentración del principio activo ${i + 1}`}
                      {...register(`ingredients.${i}.unit`)}
                      invalid={!!e?.unit}
                    >
                      {ingredientUnits.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </Select>
                    <IconButton
                      label={`Quitar principio activo ${i + 1}`}
                      variant="danger"
                      onClick={() => remove(i)}
                      className="self-center"
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                  {(e?.name || e?.dose || e?.unit) && (
                    <p className="mt-1 text-xs text-danger-600 dark:text-danger-400" role="alert">
                      {[e?.name?.message, e?.dose?.message, e?.unit?.message].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <Button
          variant="soft"
          size="sm"
          icon={<Plus />}
          disabled={fields.length >= MAX_INGREDIENTS}
          onClick={() => append({ ...emptyIngredient }, { shouldFocus: true })}
        >
          Agregar principio activo
        </Button>
      </div>
    </div>
  )
}
