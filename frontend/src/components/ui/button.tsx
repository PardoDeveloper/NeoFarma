import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Kbd } from './kbd'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'soft'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

/** Anillo de foco estándar (reutilizable en controles propios). */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(11_83_60/0.25)] hover:bg-brand-700 dark:shadow-none',
  secondary: 'bg-surface text-ink border border-line-strong shadow-card hover:bg-subtle hover:border-line-strong',
  ghost: 'text-muted hover:bg-subtle hover:text-ink',
  danger: 'bg-danger-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-danger-700 dark:shadow-none',
  success: 'bg-ok-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-ok-700 dark:shadow-none',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25',
}

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1 rounded-md [&_svg:not([class*=size-])]:size-3.5',
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg [&_svg:not([class*=size-])]:size-4',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg [&_svg:not([class*=size-])]:size-4',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl [&_svg:not([class*=size-])]:size-5',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Muestra spinner y deshabilita. */
  loading?: boolean
  /** Icono a la izquierda (lucide). */
  icon?: ReactNode
  /** Icono a la derecha. */
  iconRight?: ReactNode
  /** Atajo de teclado visible a la derecha, p. ej. "F4" o "Ctrl K". Solo visual: registrar el atajo con useHotkeys. */
  kbd?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, iconRight, kbd, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const solid = variant === 'primary' || variant === 'danger' || variant === 'success'
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px',
        'disabled:pointer-events-none disabled:opacity-50',
        focusRing,
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
      {kbd && (
        <Kbd tone={solid ? 'inverse' : 'default'} className={cn('ml-1', size === 'lg' && 'h-6 text-xs')}>
          {kbd}
        </Kbd>
      )}
    </button>
  )
})

type IconButtonSize = 'sm' | 'md' | 'lg'
const iconSizes: Record<IconButtonSize, string> = {
  sm: 'size-8 rounded-md [&_svg:not([class*=size-])]:size-4',
  md: 'size-9 rounded-lg [&_svg:not([class*=size-])]:size-[18px]',
  lg: 'size-10 rounded-lg [&_svg:not([class*=size-])]:size-5',
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Texto accesible (aria-label y tooltip nativo). Obligatorio. */
  label: string
  size?: IconButtonSize
  variant?: 'ghost' | 'secondary' | 'danger'
}

/** Botón de solo icono. Siempre con `label` accesible. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, size = 'sm', variant = 'ghost', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-40',
        focusRing,
        variant === 'ghost' && 'text-muted hover:bg-subtle hover:text-ink',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink-soft shadow-card hover:bg-subtle hover:text-ink',
        variant === 'danger' && 'text-muted hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-500/15 dark:hover:text-danger-400',
        iconSizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})
