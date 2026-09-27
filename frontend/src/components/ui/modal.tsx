import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, IconButton } from './button'
import { useOverlay } from './overlay'

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  size?: keyof typeof widths
  children: ReactNode
  /** Acciones al pie (alineadas a la derecha). */
  footer?: ReactNode
  /** Icono en círculo tintado junto al título. */
  icon?: ReactNode
  /** Tono del círculo del icono. */
  iconTone?: keyof typeof iconTones
  /** Clases del cuerpo (p. ej. `p-0` para contenido a sangre). */
  bodyClassName?: string
}

const footerCls = 'flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-subtle/60 px-6 py-3.5'

/**
 * Pie de acciones para usar DENTRO del cuerpo del Modal (p. ej. al final de un `<form>`, para que Enter envíe).
 * Se ve igual que la prop `footer`: barra a sangre con fondo sutil, acciones a la derecha, primaria al final.
 * `start` = contenido a la izquierda (ayuda, acción secundaria destructiva).
 */
export function ModalActions({ children, start, className }: { children: ReactNode; start?: ReactNode; className?: string }) {
  return (
    <div className={cn(footerCls, '-mx-6 mt-6 -mb-5', start && 'justify-between', className)}>
      {start && <div className="mr-auto flex min-w-0 items-center gap-2 text-xs text-muted">{start}</div>}
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  )
}

const iconTones = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  danger: 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-300',
  warn: 'bg-warn-50 text-warn-600 dark:bg-warn-500/15 dark:text-warn-300',
}

/** Diálogo centrado. Esc cierra (solo el superior), foco atrapado y restaurado al cerrar. */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  icon,
  iconTone = 'brand',
  bodyClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useOverlay(open, onClose, panelRef)

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:pt-[8vh]">
      <div className="animate-fade-in fixed inset-0 bg-overlay backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn('animate-pop-in relative flex w-full flex-col rounded-2xl border border-line bg-surface shadow-pop', widths[size])}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full [&_svg:not([class*=size-])]:size-5',
                  iconTones[iconTone],
                )}
              >
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-lg leading-snug font-semibold tracking-tight text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            </div>
          </div>
          <IconButton label="Cerrar" onClick={onClose} className="-mt-1 -mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div data-overlay-body className={cn('px-6 pb-5', bodyClassName)}>
          {children}
        </div>
        {footer && <div className={footerCls}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger,
  loading,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      icon={danger ? <AlertTriangle /> : undefined}
      iconTone="danger"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
      {children}
    </Modal>
  )
}
