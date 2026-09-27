import { useEffect, useRef, type RefObject } from 'react'

// Pila de overlays abiertos (Modal, Drawer, paleta): Escape y el foco atrapado solo aplican al superior.
const stack: symbol[] = []

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Comportamiento común de overlays: Esc cierra (solo el superior; no desde un `[data-escape-local]`), foco inicial en el primer campo,
 * foco atrapado con Tab, bloqueo de scroll del body y restauración del foco al cerrar.
 */
export function useOverlay(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>) {
  // onClose suele ser inline: se guarda en ref para no re-ejecutar el efecto (y robar el foco) en cada render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const id = Symbol('overlay')
    stack.push(id)
    const isTop = () => stack[stack.length - 1] === id

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return
      if (e.key === 'Escape') {
        // Edición en línea dentro del overlay (renombrar): su Escape cancela la edición, no cierra el panel.
        if ((e.target as HTMLElement | null)?.closest?.('[data-escape-local]')) return
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab' && panelRef.current) {
        const els = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
        if (!els.length) return
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Enfoca el primer campo para operar con teclado (los campos antes que el botón de cerrar).
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel || panel.contains(document.activeElement)) return
      const el =
        panel.querySelector<HTMLElement>('[autofocus], [data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea') ??
        panel.querySelector<HTMLElement>('[data-overlay-body] button:not([disabled])') ??
        panel.querySelector<HTMLElement>('button')
      el?.focus()
    })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      stack.splice(stack.indexOf(id), 1)
      if (!stack.length) document.body.style.overflow = prevOverflow
      prev?.focus?.()
    }
  }, [open, panelRef])
}

/**
 * Menús desplegables no modales (menú de usuario, selector de sucursal): cierra al hacer clic fuera de `ref`
 * o con Escape (devolviendo el foco al disparador si se indica).
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: RefObject<HTMLElement | null>,
  returnFocus?: RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      closeRef.current()
      returnFocus?.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, ref, returnFocus])
}
