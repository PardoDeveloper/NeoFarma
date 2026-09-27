import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './button'
import { useOverlay } from './overlay'

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' }

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /** Acciones fijas al pie. */
  footer?: ReactNode
  /** Ancho en desktop (en móvil ocupa toda la pantalla). Por defecto `lg` (~576px). */
  width?: keyof typeof widths
  /** Contenido bajo el título (badges, códigos en mono). */
  meta?: ReactNode
  /** Acciones en la cabecera, antes del botón cerrar. */
  actions?: ReactNode
  /** Contenido fijo bajo la cabecera (p. ej. `<Tabs>`), no hace scroll. */
  toolbar?: ReactNode
  bodyClassName?: string
}

/** Panel lateral derecho para consultar detalles (productos, ventas) sin perder el contexto de la lista. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'lg',
  meta,
  actions,
  toolbar,
  bodyClassName,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  useOverlay(open, onClose, panelRef)

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-fade-in absolute inset-0 bg-overlay" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'animate-slide-in-right relative flex h-full w-full flex-col border-l border-line bg-surface shadow-pop',
          widths[width],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-lg leading-snug font-semibold tracking-tight text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
            {meta && <div className="mt-2.5 flex flex-wrap items-center gap-1.5">{meta}</div>}
          </div>
          <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
            {actions}
            <IconButton label="Cerrar" onClick={onClose} size="md">
              <X className="size-5" />
            </IconButton>
          </div>
        </header>
        {toolbar && <div className="border-b border-line px-6 py-3">{toolbar}</div>}
        <div data-overlay-body className={cn('flex-1 overflow-y-auto px-6 py-5', bodyClassName)}>
          {children}
        </div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-subtle/60 px-6 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
