import { useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Package, Search } from 'lucide-react'
import { catalogApi } from '@/api/endpoints'
import type { Product } from '@/api/types'
import { useDebounce } from '@/lib/hooks'
import { clp } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Input } from './ui/form'

/** Buscador de productos con navegación por teclado, en el estilo de la paleta de comandos (Ctrl+K). */
export function ProductPicker({
  onSelect,
  placeholder = 'Buscar producto por nombre, SKU o código…',
  autoFocus,
}: {
  onSelect: (p: Product) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const q = useDebounce(text.trim(), 200)
  const res = useQuery({ queryKey: ['picker', q], queryFn: () => catalogApi.products({ q, page_size: 8 }), enabled: q.length >= 2 })
  const items = q.length >= 2 ? (res.data?.data ?? []) : []

  function pick(p: Product) {
    onSelect(p)
    setText('')
    setOpen(false)
    setHl(0)
    inputRef.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHl((h) => Math.min(h + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHl((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[hl]) pick(items[hl])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        leftIcon={<Search />}
        inputSize="lg"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setHl(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        aria-label="Buscar producto"
      />
      {open && q.length >= 2 && (
        <ul className="animate-fade-in absolute z-30 mt-1.5 max-h-96 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted">
              {res.isFetching ? 'Buscando…' : (
                <>
                  Sin resultados para <span className="font-medium text-ink">“{text.trim()}”</span>
                </>
              )}
            </li>
          ) : (
            items.map((p, i) => {
              const active = i === hl
              const noStock = p.stock <= 0
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                    onMouseEnter={() => setHl(i)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      active ? 'bg-brand-50 dark:bg-brand-500/12' : 'hover:bg-subtle',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg border',
                        active
                          ? 'border-brand-200 bg-surface text-brand-600 dark:border-brand-500/30 dark:text-brand-300'
                          : 'border-line bg-subtle text-muted',
                      )}
                    >
                      <Package className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{p.name}</span>
                      <span className="block truncate text-xs text-muted">
                        <span className="font-mono">{p.sku}</span>
                        {p.presentation && <> · {p.presentation}</>}
                        {p.laboratory && <> · {p.laboratory}</>}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className={cn('block font-semibold tabular-nums', noStock ? 'text-danger-600 dark:text-danger-400' : 'text-ink')}>
                        {noStock ? 'Sin stock' : `${p.stock} u.`}
                      </span>
                      <span className="mt-0.5 block text-muted tabular-nums">Costo {clp(p.cost)}</span>
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
