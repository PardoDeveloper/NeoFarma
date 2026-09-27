import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Ban, Calculator, CheckCircle2, Clock, Lock, Printer, Store } from 'lucide-react'
import { cashApi } from '@/api/endpoints'
import { errorMessage } from '@/api/client'
import { useAuth } from '@/lib/auth-context'
import { useBranch } from '@/lib/branch-context'
import type { CashSession, PaymentMethod } from '@/api/types'
import { clp, dateTime, paymentLabel, parseAmount, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import {
  Callout,
  MiniStat,
  SummaryRow,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SkeletonRows,
  SkeletonText,
  Spinner,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui/display'
import { BranchBadge, PaymentBadge } from '@/components/badges'
import { Modal, ModalActions } from '@/components/ui/modal'
import { RequireBranch } from '@/components/RequireBranch'
import { OpenCashForm } from './OpenCashForm'

export function CashPage() {
  const { user } = useAuth()
  // El historial de cierres (`GET /cash/sessions`) es solo-admin en el backend; ni se monta ni
  // se consulta para los demás roles, evitando el 403. `can()` no sirve aquí: devuelve true para
  // admin con cualquier lista de roles, así que se compara el rol directamente.
  const isAdmin = user?.role === 'admin'
  const { current: activeBranch, isAll, setBranch } = useBranch()
  const current = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current })
  // Vive en la página (no en OpenSession) porque al cerrar la caja la sesión actual pasa a null
  // y OpenSession se desmonta; el reporte de cierre debe seguir visible para imprimir.
  const [closedSession, setClosedSession] = useState<CashSession | null>(null)
  const session = current.data?.session ?? null
  // El turno de un usuario no depende de la sucursal activa: si abrió caja en otra sucursal y
  // luego cambió de vista, operarla desde aquí fallaría (la API exige que coincidan).
  const mismatched = !isAll && !!activeBranch && !!session && session.branch_id !== activeBranch.id

  const turnSection = current.isLoading ? (
    <Spinner label="Cargando caja…" />
  ) : current.isError ? (
    <ErrorState error={current.error} onRetry={() => current.refetch()} />
  ) : (
    // "Todas las sucursales" es solo lectura: abrir o operar una caja exige elegir una concreta.
    <RequireBranch action="operar la caja">
      {mismatched ? (
        <BranchMismatchNotice session={session!} activeBranchName={activeBranch?.name} onSwitch={() => setBranch(session!.branch_id)} />
      ) : session ? (
        <OpenSession session={session} onClosed={setClosedSession} />
      ) : isAdmin ? (
        <Card>
          <CardHeader
            title="Sin caja abierta"
            subtitle="Los administradores no suelen operar caja; ábrala solo si necesita cubrir un turno"
          />
          <div className="p-6">
            <OpenCashForm />
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="No tiene una caja abierta" subtitle="Abra una caja para comenzar su turno" />
            <div className="p-6">
              <OpenCashForm />
            </div>
          </Card>
          <p className="mt-4 text-center text-xs text-faint">El historial de cierres lo revisa el administrador.</p>
        </>
      )}
    </RequireBranch>
  )

  return (
    <div>
      <PageHeader title="Caja" subtitle="Apertura, movimientos de efectivo, arqueo y cierre de caja" />
      {isAdmin ? (
        <>
          <SessionHistory />
          <div className="mt-6">{turnSection}</div>
        </>
      ) : (
        turnSection
      )}
      <SessionReportModal session={closedSession} onClose={() => setClosedSession(null)} />
    </div>
  )
}

/** Aviso cuando el turno abierto del usuario pertenece a una sucursal distinta de la que está viendo. */
function BranchMismatchNotice({
  session,
  activeBranchName,
  onSwitch,
}: {
  session: CashSession
  activeBranchName?: string
  onSwitch: () => void
}) {
  return (
    <Card>
      <CardHeader title="Su turno está abierto en otra sucursal" />
      <div className="p-6">
        <Callout
          tone="warn"
          icon={<Store />}
          title={`Turno abierto en ${session.branch_name}`}
          action={
            <Button variant="secondary" icon={<Store />} onClick={onSwitch}>
              Cambiar a {session.branch_name}
            </Button>
          }
        >
          {activeBranchName ? `Está viendo ${activeBranchName}. ` : ''}
          Cambie a la sucursal de su turno para registrar movimientos, arquear o cerrar la caja.
        </Callout>
      </div>
    </Card>
  )
}

/* ───────────────────────── Fórmula de cuadratura ───────────────────────── */

function FormulaTerm({ label, value, tone, emphasis }: { label: string; value: string; tone?: 'ok' | 'danger'; emphasis?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-[104px] flex-1 flex-col items-center gap-0.5 rounded-lg px-3 py-2.5 text-center',
        emphasis ? 'col-span-2 bg-brand-50 sm:col-span-1 dark:bg-brand-500/12' : 'bg-surface',
      )}
    >
      <span
        className={cn(
          'text-base font-bold tabular-nums',
          emphasis
            ? 'text-brand-800 dark:text-brand-200'
            : tone === 'ok'
              ? 'text-ok-700 dark:text-ok-300'
              : tone === 'danger'
                ? 'text-danger-700 dark:text-danger-300'
                : 'text-ink',
        )}
      >
        {value}
      </span>
      <span className="text-[11px] font-medium text-muted">{label}</span>
    </div>
  )
}

/** Oculto en móvil (la grilla de 2 columnas ya transmite la agrupación); visible desde `sm` como tira horizontal. */
function FormulaOp({ children }: { children: ReactNode }) {
  return (
    <span className="hidden shrink-0 items-center px-0.5 text-lg font-bold text-faint sm:flex" aria-hidden>
      {children}
    </span>
  )
}

function SummaryGrid({ s }: { s: CashSession }) {
  const sum = s.summary!
  return (
    <div className="space-y-5">
      <div>
        <p className="section-label mb-2">Cuadratura de efectivo</p>
        <div className="grid grid-cols-2 items-stretch gap-1.5 rounded-xl border border-line bg-subtle/50 p-2 sm:flex sm:flex-wrap">
          <FormulaTerm label="Fondo inicial" value={clp(s.opening_amount)} />
          <FormulaOp>+</FormulaOp>
          <FormulaTerm label="Efectivo vendido" value={clp(sum.by_method.efectivo)} />
          <FormulaOp>+</FormulaOp>
          <FormulaTerm label="Ingresos" value={clp(sum.cash_in)} tone={sum.cash_in > 0 ? 'ok' : undefined} />
          <FormulaOp>−</FormulaOp>
          <FormulaTerm label="Egresos" value={clp(sum.cash_out)} tone={sum.cash_out > 0 ? 'danger' : undefined} />
          <FormulaOp>=</FormulaOp>
          <FormulaTerm label="Efectivo esperado" value={clp(sum.expected_cash)} emphasis />
        </div>
        {s.status === 'cerrada' && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <MiniStat align="center" label="Efectivo contado" value={clp(s.counted_cash)} />
            <MiniStat align="center" label="Diferencia" value={<DiffValue v={s.difference ?? 0} />} />
          </div>
        )}
      </div>
      <div className="rounded-xl border border-line bg-subtle/40 p-4">
        <p className="section-label mb-3">Ventas del turno</p>
        <div className="space-y-2 text-sm">
          {(Object.keys(paymentLabel) as PaymentMethod[]).map((m) => (
            <div key={m} className="flex items-center justify-between">
              <PaymentBadge method={m} />
              <span className="text-ink-soft tabular-nums">{clp(sum.by_method[m])}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-2.5 text-base font-semibold text-ink">
            <span>Total ({sum.sales_count} ventas)</span>
            <span className="tabular-nums">{clp(sum.sales_total)}</span>
          </div>
          {sum.voided_count > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-danger-600 dark:text-danger-400">
              <Ban className="size-3.5" /> {sum.voided_count} venta(s) anulada(s), no incluida(s) en el total
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffValue({ v }: { v: number }) {
  return (
    <span
      className={cn(
        'tabular-nums',
        v === 0 ? 'text-ok-600 dark:text-ok-400' : v < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-warn-700 dark:text-warn-400',
      )}
    >
      {v === 0 ? 'Cuadrada' : `${v > 0 ? '+' : ''}${clp(v)}`}
    </span>
  )
}

/* ───────────────────────── Sesión abierta (turno) ───────────────────────── */

function OpenSession({ session, onClosed }: { session: CashSession; onClosed: (s: CashSession) => void }) {
  const [movement, setMovement] = useState<'ingreso' | 'egreso' | null>(null)
  const [closing, setClosing] = useState(false)

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-gradient-to-r from-brand-50 to-surface px-6 py-5 dark:from-brand-500/10">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">{session.register_name}</h2>
              <Badge tone="ok" dot>
                Turno abierto
              </Badge>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
              <Clock className="size-3.5" />
              {session.user_name} · desde {dateTime(session.opened_at)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<ArrowDownCircle className="text-ok-600 dark:text-ok-400" />}
              onClick={() => setMovement('ingreso')}
            >
              Ingreso
            </Button>
            <Button
              variant="secondary"
              icon={<ArrowUpCircle className="text-danger-600 dark:text-danger-400" />}
              onClick={() => setMovement('egreso')}
            >
              Egreso
            </Button>
            <Button variant="danger" icon={<Lock />} onClick={() => setClosing(true)}>
              Cerrar caja
            </Button>
          </div>
        </div>
        <div className="p-6">
          <SummaryGrid s={session} />
          <h3 className="mt-6 mb-2.5">
            <span className="section-label">Movimientos de efectivo</span>
          </h3>
          {session.movements?.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {session.movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2 text-ink-soft">
                    {m.type === 'ingreso' ? (
                      <ArrowDownCircle className="size-4 text-ok-600 dark:text-ok-400" />
                    ) : (
                      <ArrowUpCircle className="size-4 text-danger-600 dark:text-danger-400" />
                    )}
                    {m.reason}
                    <span className="text-xs text-faint">
                      · {time(m.created_at)} · {m.user_name}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'font-semibold tabular-nums',
                      m.type === 'ingreso' ? 'text-ok-700 dark:text-ok-300' : 'text-danger-700 dark:text-danger-300',
                    )}
                  >
                    {m.type === 'ingreso' ? '+' : '−'}
                    {clp(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title="Sin ingresos ni egresos registrados" />
          )}
        </div>
      </Card>
      <MovementModal session={session} type={movement} onClose={() => setMovement(null)} />
      <CloseModal
        open={closing}
        session={session}
        onClose={() => setClosing(false)}
        onClosed={(s) => {
          setClosing(false)
          onClosed(s)
        }}
      />
    </>
  )
}

function MovementModal({ session, type, onClose }: { session: CashSession; type: 'ingreso' | 'egreso' | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const m = useMutation({
    mutationFn: () => cashApi.movement(session.id, { type: type!, amount: parseAmount(amount), reason }),
    onSuccess: () => {
      toast.success(type === 'ingreso' ? 'Ingreso registrado' : 'Egreso registrado')
      qc.invalidateQueries({ queryKey: ['cash'] })
      setAmount('')
      setReason('')
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (parseAmount(amount) <= 0 || reason.trim().length < 3) return toast.error('Indique monto y motivo')
    m.mutate()
  }
  return (
    <Modal
      open={!!type}
      onClose={onClose}
      title={type === 'ingreso' ? 'Registrar ingreso de efectivo' : 'Registrar egreso de efectivo'}
      description={type === 'egreso' ? 'Ej: pago a proveedor menor, retiro parcial de caja' : 'Ej: sencillo adicional, reposición de fondo'}
      size="sm"
      icon={type === 'ingreso' ? <ArrowDownCircle /> : <ArrowUpCircle />}
      iconTone={type === 'ingreso' ? 'brand' : 'warn'}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Monto" required>
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg font-semibold"
            />
          )}
        </Field>
        <Field label="Motivo" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={250} />}
        </Field>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={m.isPending}>
            Registrar
          </Button>
        </ModalActions>
      </form>
    </Modal>
  )
}

/* ───────────────────────── Cierre / arqueo ───────────────────────── */

const denominations = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 10]

function CloseModal({
  open,
  session,
  onClose,
  onClosed,
}: {
  open: boolean
  session: CashSession
  onClose: () => void
  onClosed: (s: CashSession) => void
}) {
  const qc = useQueryClient()
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [notes, setNotes] = useState('')
  const counted = useMemo(() => denominations.reduce((s, d) => s + d * (Number(counts[d]) || 0), 0), [counts])
  const expected = session.summary?.expected_cash ?? 0
  const diff = counted - expected

  const close = useMutation({
    mutationFn: () => cashApi.close(session.id, counted, notes.trim() || null),
    onSuccess: (s) => {
      toast.success('Caja cerrada correctamente')
      qc.invalidateQueries({ queryKey: ['cash'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setCounts({})
      setNotes('')
      onClosed(s)
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const pending = counted === 0 && expected > 0
  const diffTone = pending ? 'idle' : diff === 0 ? 'ok' : diff < 0 ? 'danger' : 'warn'
  const diffStyles = {
    idle: 'border-line bg-subtle/50',
    ok: 'border-ok-200 bg-ok-50 dark:border-ok-500/25 dark:bg-ok-500/10',
    danger: 'border-danger-200 bg-danger-50 dark:border-danger-500/25 dark:bg-danger-500/10',
    warn: 'border-warn-200 bg-warn-50 dark:border-warn-500/25 dark:bg-warn-500/10',
  }[diffTone]
  const diffIconStyles = {
    idle: 'bg-subtle text-muted',
    ok: 'bg-ok-100 text-ok-700 dark:bg-ok-500/20 dark:text-ok-300',
    danger: 'bg-danger-100 text-danger-700 dark:bg-danger-500/20 dark:text-danger-300',
    warn: 'bg-warn-100 text-warn-700 dark:bg-warn-500/20 dark:text-warn-300',
  }[diffTone]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cierre de ${session.register_name}`}
      description="Cuente el efectivo por denominación. El sistema calculará la diferencia con lo esperado."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" loading={close.isPending} onClick={() => close.mutate()} icon={<Lock />}>
            Confirmar cierre
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium text-ink-soft">Arqueo de efectivo</p>
          <div className="divide-y divide-line rounded-xl border border-line">
            {denominations.map((d) => (
              <div key={d} className="flex items-center gap-3 px-3 py-2">
                <span className="w-16 shrink-0 text-right text-sm font-semibold text-ink-soft tabular-nums">{clp(d)}</span>
                <span className="text-faint">×</span>
                <Input
                  aria-label={`Cantidad de billetes/monedas de ${clp(d)}`}
                  inputMode="numeric"
                  inputSize="md"
                  className="w-20 text-center text-base font-semibold"
                  value={counts[d] ?? ''}
                  onChange={(e) => setCounts((c) => ({ ...c, [d]: e.target.value.replace(/\D/g, '') }))}
                />
                <span className="flex-1 text-right text-sm text-muted tabular-nums">{clp(d * (Number(counts[d]) || 0))}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-line bg-subtle/50 px-4 py-3">
            <SummaryRow label="Efectivo esperado" value={clp(expected)} className="text-base font-semibold text-ink [&>span]:text-ink" />
          </div>
          <div className="rounded-xl border border-line-strong bg-surface p-4 text-center">
            <p className="section-label">Efectivo contado</p>
            <p className="mt-1 text-4xl font-bold text-ink tabular-nums">{clp(counted)}</p>
          </div>
          <div className={cn('flex items-center gap-3 rounded-xl border p-4', diffStyles)}>
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', diffIconStyles)}>
              {pending ? (
                <Calculator className="size-5" />
              ) : diff === 0 ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <AlertTriangle className="size-5" />
              )}
            </span>
            <div aria-live="polite">
              <p className="section-label">Diferencia</p>
              {pending ? (
                <p className="text-sm font-medium text-muted">Ingrese el conteo por denominación</p>
              ) : (
                <p className="text-xl font-bold tabular-nums">
                  {diff === 0 ? 'Caja cuadrada' : `${diff > 0 ? '+' : ''}${clp(diff)} · ${diff < 0 ? 'faltante' : 'sobrante'}`}
                </p>
              )}
            </div>
          </div>
          <Field label="Observaciones" hint={diff !== 0 && counted > 0 ? 'Explique el motivo de la diferencia' : undefined}>
            {(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <div className="text-xs text-muted">
            Ventas del turno: <strong className="text-ink-soft">{session.summary?.sales_count}</strong> por{' '}
            <strong className="text-ink-soft">{clp(session.summary?.sales_total)}</strong>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SessionReportModal({ session, onClose }: { session: CashSession | null; onClose: () => void }) {
  const { isAll } = useBranch()
  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title={session ? `Cierre ${session.register_name} · Sesión #${session.id}` : ''}
      description={
        session
          ? `${session.user_name} · ${dateTime(session.opened_at)} → ${dateTime(session.closed_at)}${isAll ? ` · ${session.branch_name}` : ''}`
          : undefined
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
            Imprimir
          </Button>
          <Button onClick={onClose}>Cerrar</Button>
        </>
      }
    >
      {session?.summary && (
        <div className="print-area">
          <SummaryGrid s={session} />
          {session.closing_notes && <p className="mt-4 text-sm text-muted">Observaciones: {session.closing_notes}</p>}
        </div>
      )}
    </Modal>
  )
}

/* ───────────────────────── Historial de cierres ───────────────────────── */

function SessionHistory() {
  const { isAll } = useBranch()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['cash', 'sessions', page, status], queryFn: () => cashApi.sessions({ page, page_size: 10, status }) })
  const detail = useQuery({ queryKey: ['cash', 'session', selected], queryFn: () => cashApi.session(selected!), enabled: !!selected })
  const cols = 9 + (isAll ? 1 : 0)
  const numericCols = isAll ? [6, 7, 8] : [5, 6, 7]

  return (
    <Card>
      <CardHeader
        title="Historial de cierres"
        action={
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
            className="h-8 w-36"
            aria-label="Filtrar estado"
          >
            <option value="">Todas</option>
            <option value="abierta">Abiertas</option>
            <option value="cerrada">Cerradas</option>
          </Select>
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.isLoading && !q.data?.data.length ? (
        <EmptyState title="Sin sesiones registradas" />
      ) : (
        <>
          <Table containerClassName="max-h-[65vh]">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Caja</Th>
                {isAll && <Th>Sucursal</Th>}
                <Th>Cajero</Th>
                <Th>Apertura</Th>
                <Th>Cierre</Th>
                <Th numeric>Ventas</Th>
                <Th numeric>Efectivo esperado</Th>
                <Th numeric>Diferencia</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading ? (
                <SkeletonRows rows={8} cols={cols} numeric={numericCols} />
              ) : (
                q.data!.data.map((s) => (
                  <Tr key={s.id} onClick={() => setSelected(s.id)} selected={selected === s.id}>
                    <Td className="text-muted">{s.id}</Td>
                    <Td className="font-medium text-ink">{s.register_name}</Td>
                    {isAll && (
                      <Td>
                        <BranchBadge name={s.branch_name} />
                      </Td>
                    )}
                    <Td>{s.user_name}</Td>
                    <Td className="whitespace-nowrap">{dateTime(s.opened_at)}</Td>
                    <Td className="whitespace-nowrap">{dateTime(s.closed_at)}</Td>
                    <Td numeric>{clp(s.summary?.sales_total)}</Td>
                    <Td numeric>{clp(s.expected_cash ?? s.summary?.expected_cash)}</Td>
                    <Td numeric className="font-medium">
                      {s.status === 'cerrada' ? <DiffValue v={s.difference ?? 0} /> : '—'}
                    </Td>
                    <Td>
                      {s.status === 'abierta' ? (
                        <Badge tone="ok" dot>
                          Abierta
                        </Badge>
                      ) : (
                        <Badge dot>Cerrada</Badge>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          {q.data && <Pagination page={page} pageSize={10} total={q.data.total} onChange={setPage} />}
        </>
      )}
      <SessionReportModal
        session={detail.data && detail.data.status === 'cerrada' ? detail.data : null}
        onClose={() => setSelected(null)}
      />
      <Modal
        open={!!detail.data && detail.data.status === 'abierta'}
        onClose={() => setSelected(null)}
        title={`${detail.data?.register_name} · en curso`}
        description={isAll && detail.data ? detail.data.branch_name : undefined}
        size="lg"
      >
        {detail.isLoading ? <SkeletonText lines={5} /> : detail.data?.summary && <SummaryGrid s={detail.data} />}
      </Modal>
    </Card>
  )
}
