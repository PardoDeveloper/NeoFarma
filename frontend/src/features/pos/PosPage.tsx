import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Barcode, FileText, LockOpen, Minus, Plus, Printer, ScanLine, Search, ShoppingCart, Trash2, Wallet } from 'lucide-react'
import { cashApi, catalogApi } from '@/api/endpoints'
import { ApiError, errorMessage } from '@/api/client'
import type { CashSession, Product, Sale } from '@/api/types'
import { useBranch } from '@/lib/branch-context'
import { clp, parseAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDebounce, useHotkeys } from '@/lib/hooks'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/form'
import { Badge, Card, EmptyState, Kbd, Spinner } from '@/components/ui/display'
import { Modal } from '@/components/ui/modal'
import { BranchBadge, SaleConditionBadge, StockBadge } from '@/components/badges'
import { OpenCashForm } from '@/features/cash/OpenCashForm'
import { SaleReceipt } from '@/features/sales/SaleReceipt'
import { addToCart, cartTotals, removeFromCart, requiresPrescription, setQuantity, type CartLine } from './cart'
import { CheckoutModal } from './CheckoutModal'

export function PosPage() {
  const current = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current })

  if (current.isLoading) return <Spinner label="Cargando caja…" className="h-full" />
  if (!current.data?.session) {
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 py-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-8 ring-brand-50/60 dark:bg-brand-500/12 dark:text-brand-300 dark:ring-brand-500/5">
          <LockOpen className="size-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Abra su caja para empezar a vender</h1>
          <p className="mt-1.5 text-sm text-pretty text-muted">
            Seleccione una caja disponible e indique el fondo inicial en efectivo para comenzar su turno.
          </p>
        </div>
        <Card className="w-full p-6 text-left">
          <OpenCashForm />
        </Card>
      </div>
    )
  }
  return <PosTerminal session={current.data.session} />
}

function PosTerminal({ session }: { session: CashSession }) {
  const qc = useQueryClient()
  const { current: activeBranch, setBranch } = useBranch()
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [discountInput, setDiscountInput] = useState('')
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [lastSale, setLastSale] = useState<Sale | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const debounced = useDebounce(search.trim(), 200)
  const results = useQuery({
    queryKey: ['pos-search', debounced],
    queryFn: () => catalogApi.products({ q: debounced, page_size: 8 }),
    enabled: debounced.length >= 2,
  })
  const found = debounced.length >= 2 ? (results.data?.data ?? []) : []

  const discount = parseAmount(discountInput)
  const totals = useMemo(() => cartTotals(cart, discount), [cart, discount])

  const add = useCallback((p: Product, qty = 1) => {
    setCart((c) => {
      const r = addToCart(c, p, qty)
      if (!r.ok) toast.warning(r.reason)
      return r.cart
    })
    setSearch('')
    setHighlight(0)
    searchRef.current?.focus()
  }, [])

  async function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(found.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const code = search.trim()
      if (!code) return
      // Lector de código de barras / SKU: búsqueda exacta inmediata, sin esperar el debounce.
      if (/^[\w-]*\d[\w-]*$/.test(code)) {
        try {
          add(await catalogApi.lookup(code))
          return
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) return void toast.error(errorMessage(err))
        }
      }
      if (found[highlight]) add(found[highlight])
      else toast.error(`No se encontró "${code}"`)
    } else if (e.key === 'Escape') {
      setSearch('')
    }
  }

  const hotkeys = useMemo(
    () => ({
      F2: () => searchRef.current?.focus(),
      F4: () => cart.length > 0 && setCheckoutOpen(true),
      F8: () => cart.length > 0 && setCart([]),
    }),
    [cart.length],
  )
  useHotkeys(hotkeys, !checkoutOpen && !lastSale)

  function onSaleDone(sale: Sale) {
    setCheckoutOpen(false)
    setCart([])
    setDiscountInput('')
    setLastSale(sale)
    qc.invalidateQueries({ queryKey: ['cash'] })
    qc.invalidateQueries({ queryKey: ['pos-search'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  return (
    <div className="grid gap-4 lg:h-full lg:grid-cols-[1fr_380px] lg:gap-5">
      <div className="flex flex-col gap-4 lg:min-h-0">
        {/* Buscador */}
        <div className="relative shrink-0">
          <Input
            ref={searchRef}
            autoFocus
            inputSize="lg"
            leftIcon={<Search />}
            rightSlot={<Kbd>F2</Kbd>}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={onSearchKey}
            placeholder="Escanee el código de barras o busque por nombre, principio activo o SKU…"
            className="h-14 text-base shadow-card"
            aria-label="Buscar producto"
          />
          {found.length > 0 && (
            <ul
              role="listbox"
              className="animate-fade-in absolute z-20 mt-2 max-h-[70vh] w-full overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-pop"
            >
              {found.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => add(p)}
                    className={cn(
                      'flex w-full items-center gap-4 px-4 py-3 text-left transition-colors',
                      i === highlight ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-subtle',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium text-ink">{p.name}</span>
                        <SaleConditionBadge value={p.sale_condition} short />
                        {p.is_bioequivalent && (
                          <Badge tone="info" size="sm" title="Bioequivalente">
                            BE
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {[p.active_ingredient, p.presentation, p.laboratory].filter(Boolean).join(' · ')}
                        {' · '}
                        <span className="font-mono">{p.sku}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-ink tabular-nums">{clp(p.price)}</p>
                      <StockBadge stock={p.stock_sellable} min={p.min_stock} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Carrito */}
        <Card className="flex flex-col lg:min-h-0 lg:flex-1">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <ShoppingCart className="size-4 text-brand-600 dark:text-brand-400" /> Detalle de la venta
              {cart.length > 0 && <span className="text-sm font-normal text-muted">· {totals.items} u.</span>}
            </h2>
            {cart.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setCart([])} icon={<Trash2 />} kbd="F8">
                Vaciar
              </Button>
            )}
          </div>
          <div className="max-h-[46vh] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
            {cart.length === 0 ? (
              <EmptyState
                icon={<ScanLine />}
                title="Carrito vacío"
                message="Escanee un producto con el lector o búsquelo por nombre. Presione Enter para agregar el resultado resaltado."
              />
            ) : (
              <ul className="divide-y divide-line">
                {cart.map((l) => (
                  <li
                    key={l.product.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-5"
                  >
                    <div className="min-w-0 flex-1 basis-full sm:basis-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-medium text-ink">{l.product.name}</p>
                        <SaleConditionBadge value={l.product.sale_condition} short />
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {clp(l.product.price)} c/u · {l.product.presentation ?? '—'} · disp. {l.product.stock_sellable}
                      </p>
                    </div>
                    <div className="flex w-full shrink-0 items-center justify-between gap-3 sm:w-auto sm:justify-end">
                      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-line-strong bg-canvas/60 p-1 dark:bg-black/15">
                        <IconButton
                          label={`Restar ${l.product.name}`}
                          size="lg"
                          onClick={() =>
                            setCart((c) =>
                              l.quantity <= 1 ? removeFromCart(c, l.product.id) : setQuantity(c, l.product.id, l.quantity - 1),
                            )
                          }
                        >
                          <Minus />
                        </IconButton>
                        <input
                          aria-label={`Cantidad de ${l.product.name}`}
                          className="w-10 bg-transparent text-center text-sm font-semibold text-ink tabular-nums focus:outline-none"
                          value={l.quantity}
                          inputMode="numeric"
                          onChange={(e) => setCart((c) => setQuantity(c, l.product.id, Number(e.target.value)))}
                        />
                        <IconButton
                          label={`Sumar ${l.product.name}`}
                          size="lg"
                          onClick={() => add(l.product)}
                          disabled={l.quantity >= l.product.stock_sellable}
                        >
                          <Plus />
                        </IconButton>
                      </div>
                      <p className="w-20 shrink-0 text-right font-semibold text-ink tabular-nums sm:w-24">
                        {clp(l.product.price * l.quantity)}
                      </p>
                      <IconButton
                        label={`Quitar ${l.product.name}`}
                        variant="danger"
                        onClick={() => setCart((c) => removeFromCart(c, l.product.id))}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Totales */}
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-muted">
              <Wallet className="size-4 shrink-0" /> <span className="truncate">{session.register_name}</span>
              {activeBranch && <BranchBadge name={activeBranch.name} className="shrink-0" />}
            </span>
            <Link to="/caja" className="shrink-0 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Ver caja
            </Link>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Productos</dt>
              <dd className="text-ink-soft tabular-nums">{totals.items} u.</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="text-ink-soft tabular-nums">{clp(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted">Descuento $</dt>
              <dd>
                <Input
                  aria-label="Descuento"
                  inputMode="numeric"
                  placeholder="0"
                  inputSize="sm"
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  className="w-28 text-right tabular-nums"
                />
              </dd>
            </div>
            <div className="flex justify-between text-xs text-faint">
              <dt>Neto / IVA 19%</dt>
              <dd className="tabular-nums">
                {clp(totals.net)} / {clp(totals.tax)}
              </dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-line pt-4">
            <p className="section-label">Total a pagar</p>
            <p className="mt-1 text-5xl font-bold tracking-tight text-ink tabular-nums">{clp(totals.total)}</p>
            {discount > totals.subtotal && (
              <p className="mt-1.5 text-xs text-warn-700 dark:text-warn-400">El descuento se limitó al subtotal</p>
            )}
          </div>
          {requiresPrescription(cart) && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-rx-50 px-3 py-2.5 text-xs text-rx-800 ring-1 ring-rx-200 dark:bg-rx-500/12 dark:text-rx-300 dark:ring-rx-500/25">
              <FileText className="mt-0.5 size-3.5 shrink-0" />
              Contiene productos con receta retenida: se solicitará N° de receta al cobrar.
            </p>
          )}
          <Button
            size="lg"
            variant="success"
            className="mt-5 h-14 w-full text-lg"
            disabled={cart.length === 0}
            onClick={() => setCheckoutOpen(true)}
            kbd="F4"
          >
            Cobrar
          </Button>
        </Card>
        <Card className="p-4">
          <p className="section-label mb-2.5 flex items-center gap-1.5">
            <Barcode className="size-3.5" /> Atajos de teclado
          </p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted">
            <li className="flex items-center gap-1.5">
              <Kbd>F2</Kbd> Buscar
            </li>
            <li className="flex items-center gap-1.5">
              <Kbd>F4</Kbd> Cobrar
            </li>
            <li className="flex items-center gap-1.5">
              <Kbd>F8</Kbd> Vaciar
            </li>
            <li className="flex items-center gap-1.5">
              <Kbd>↑ ↓</Kbd> Navegar
            </li>
            <li className="flex items-center gap-1.5">
              <Kbd>Enter</Kbd> Agregar
            </li>
            <li className="flex items-center gap-1.5">
              <Kbd>1-4</Kbd> Medio pago
            </li>
          </ul>
        </Card>
      </div>

      <CheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        cart={cart}
        discount={discount}
        onDone={onSaleDone}
        session={session}
        onSwitchBranch={() => setBranch(session.branch_id)}
      />

      <Modal
        open={!!lastSale}
        onClose={() => {
          setLastSale(null)
          requestAnimationFrame(() => searchRef.current?.focus())
        }}
        title="Venta registrada"
        size="sm"
        footer={
          <>
            <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
              Imprimir
            </Button>
            <Button autoFocus onClick={() => setLastSale(null)}>
              Nueva venta
            </Button>
          </>
        }
      >
        {lastSale && (
          <>
            {lastSale.change_amount > 0 && (
              <div className="mb-4 rounded-xl bg-ok-50 p-5 text-center ring-1 ring-ok-200 dark:bg-ok-500/10 dark:ring-ok-500/25">
                <p className="text-sm font-medium text-ok-700 dark:text-ok-300">Vuelto a entregar</p>
                <p className="mt-1 text-4xl font-bold text-ok-700 tabular-nums dark:text-ok-300">{clp(lastSale.change_amount)}</p>
              </div>
            )}
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line">
              <SaleReceipt sale={lastSale} />
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
