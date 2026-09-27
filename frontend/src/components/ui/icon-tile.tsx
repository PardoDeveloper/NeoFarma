import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const tones = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
  gray: 'bg-subtle text-muted',
  info: 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-300',
  warn: 'bg-warn-50 text-warn-600 dark:bg-warn-500/15 dark:text-warn-300',
  danger: 'bg-danger-50 text-danger-600 dark:bg-danger-500/15 dark:text-danger-300',
  ok: 'bg-ok-50 text-ok-600 dark:bg-ok-500/15 dark:text-ok-300',
  rx: 'bg-rx-50 text-rx-600 dark:bg-rx-500/15 dark:text-rx-300',
}
export type IconTone = keyof typeof tones

const sizes = {
  sm: 'size-8 rounded-lg [&_svg:not([class*=size-])]:size-4',
  md: 'size-9 rounded-lg [&_svg:not([class*=size-])]:size-4',
  lg: 'size-11 rounded-xl [&_svg:not([class*=size-])]:size-5',
}

/** Icono en cuadro tintado (cabeceras de KPI, filas de listas, tarjetas de contexto). El tono debe significar algo. */
export function IconTile({
  children,
  tone = 'gray',
  size = 'md',
  className,
}: {
  children: ReactNode
  tone?: IconTone
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center', sizes[size], tones[tone], className)}>
      {children}
    </span>
  )
}
