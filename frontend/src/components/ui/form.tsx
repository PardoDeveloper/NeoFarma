import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Clases base de un control de formulario (reutilizable para controles propios). */
export const controlCls =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink shadow-card placeholder:text-faint ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-faint/70 ' +
  'focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted disabled:hover:border-line-strong ' +
  'dark:bg-canvas/40 dark:focus:ring-brand-400/15'

const invalidCls = 'border-danger-500 hover:border-danger-500 focus:border-danger-500 focus:ring-danger-500/15'

const inputSizes = { sm: 'h-9', md: 'h-10', lg: 'h-12 text-base px-4' }

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
  /** Icono dentro del campo, a la izquierda (p. ej. `<Search />`). */
  leftIcon?: ReactNode
  /** Contenido a la derecha dentro del campo (Kbd, unidad, botón pequeño). */
  rightSlot?: ReactNode
  /** Alto del control. `size` nativo queda libre. */
  inputSize?: keyof typeof inputSizes
  /** Clases del contenedor cuando hay `leftIcon`/`rightSlot` (ancho, margen). */
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leftIcon, rightSlot, inputSize = 'md', wrapperClassName, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      className={cn(
        controlCls,
        inputSizes[inputSize],
        'tabular-nums',
        leftIcon && (inputSize === 'lg' ? 'pl-11' : 'pl-9'),
        rightSlot && 'pr-12',
        invalid && invalidCls,
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
  if (!leftIcon && !rightSlot) return input
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      {leftIcon && (
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 flex items-center text-faint [&_svg:not([class*=size-])]:size-4',
            inputSize === 'lg' ? 'pl-4 [&_svg:not([class*=size-])]:size-5' : 'pl-3',
          )}
          aria-hidden
        >
          {leftIcon}
        </span>
      )}
      {input}
      {rightSlot && <span className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2.5 text-sm text-faint">{rightSlot}</span>}
    </div>
  )
})

// Chevron propio (clase .select-chevron en index.css): el nativo difiere entre navegadores y no respeta el tema.
const chevron = 'select-chevron'

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; inputSize?: keyof typeof inputSizes }
>(function Select({ className, invalid, inputSize = 'md', children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(controlCls, inputSizes[inputSize], 'cursor-pointer appearance-none pr-9', chevron, invalid && invalidCls, className)}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(controlCls, 'min-h-20 resize-y py-2.5 leading-relaxed', invalid && invalidCls, className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    )
  },
)

/** Campo con etiqueta, ayuda y error. Pasa el id generado al hijo mediante render prop. */
export function Field({
  label,
  error,
  hint,
  required,
  className,
  labelAction,
  children,
}: {
  label: ReactNode
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  /** Contenido a la derecha de la etiqueta (p. ej. enlace "Generar"). */
  labelAction?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-ink-soft">
          {label}
          {required && (
            <span className="ml-0.5 text-danger-600 dark:text-danger-400" aria-hidden>
              *
            </span>
          )}
        </label>
        {labelAction && <div className="text-xs">{labelAction}</div>}
      </div>
      {children(id)}
      {error ? (
        <p className="flex items-center gap-1 text-xs font-medium text-danger-600 dark:text-danger-400" role="alert">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

/** Casilla con etiqueta (y descripción opcional). Acepta todas las props nativas del input. */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; description?: ReactNode }) {
  const id = useId()
  return (
    <label
      htmlFor={rest.id ?? id}
      className={cn(
        'group inline-flex cursor-pointer items-start gap-2.5 text-sm text-ink-soft select-none has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
    >
      <span className="relative mt-0.5 flex size-[18px] shrink-0 items-center justify-center">
        <input
          id={id}
          type="checkbox"
          className={cn(
            'peer absolute inset-0 cursor-pointer appearance-none rounded-[5px] border border-line-strong bg-surface transition-colors',
            'group-hover:border-faint checked:border-brand-600 checked:bg-brand-600 group-hover:checked:border-brand-700 group-hover:checked:bg-brand-700',
            'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas focus-visible:outline-none',
          )}
          {...rest}
        />
        <Check
          className="pointer-events-none relative size-3.5 text-white opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
          aria-hidden
        />
      </span>
      <span className="flex flex-col">
        <span>{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
    </label>
  )
}

/**
 * Grupo de campos con título de sección para formularios largos (Identificación, Clasificación, Precio…).
 * `columns` arma la grilla responsiva (1 columna en móvil).
 */
export function FormSection({
  title,
  description,
  columns,
  className,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  /** Columnas desde `sm` (2) o `lg` (3/4). Sin valor: apila los hijos. */
  columns?: 2 | 3 | 4
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('space-y-4', className)}>
      <div>
        <h3 className="section-label">{title}</h3>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      <div
        className={cn(
          columns ? 'grid gap-4' : 'space-y-4',
          columns === 2 && 'sm:grid-cols-2',
          columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
          columns === 4 && 'sm:grid-cols-2 lg:grid-cols-4',
        )}
      >
        {children}
      </div>
    </section>
  )
}
