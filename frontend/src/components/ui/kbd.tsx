import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Tecla o atajo visible: `<Kbd>F4</Kbd>`, `<Kbd>Ctrl K</Kbd>`.
 * `tone="inverse"` para usar sobre fondos sólidos (botón primario).
 */
export function Kbd({ children, className, tone = 'default' }: { children: ReactNode; className?: string; tone?: 'default' | 'inverse' }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-md px-1.5 font-mono text-[10.5px] leading-none font-medium tracking-tight whitespace-nowrap',
        tone === 'default'
          ? 'border border-b-2 border-line-strong bg-surface text-muted'
          : 'bg-white/20 text-current ring-1 ring-white/25 ring-inset',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
