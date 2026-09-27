import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { LockOpen, Monitor } from 'lucide-react'
import { cashApi } from '@/api/endpoints'
import { errorMessage } from '@/api/client'
import { clp, parseAmount } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { SkeletonText } from '@/components/ui/display'

export function OpenCashForm() {
  const qc = useQueryClient()
  const registers = useQuery({ queryKey: ['cash', 'registers'], queryFn: cashApi.registers })
  const [registerId, setRegisterId] = useState<number | null>(null)
  const [amount, setAmount] = useState('50.000')

  const open = useMutation({
    mutationFn: () => cashApi.open(registerId!, parseAmount(amount)),
    onSuccess: (s) => {
      toast.success(`${s.register_name} abierta con ${clp(s.opening_amount)}`)
      qc.invalidateQueries({ queryKey: ['cash'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!registerId) return toast.error('Seleccione una caja')
    open.mutate()
  }

  if (registers.isLoading) return <SkeletonText lines={4} />
  const list = registers.data?.data ?? []

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium text-ink-soft">Seleccione la caja</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {list.map((r) => {
            const busy = !!r.open_session_id
            const active = registerId === r.id
            return (
              <button
                key={r.id}
                type="button"
                disabled={busy || !r.active}
                onClick={() => setRegisterId(r.id)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-xl border-2 p-4 text-left transition-all',
                  active
                    ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-500/10 dark:bg-brand-500/10'
                    : 'border-line bg-surface hover:border-line-strong hover:bg-subtle',
                  (busy || !r.active) && 'cursor-not-allowed opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-lg',
                    active ? 'bg-brand-600 text-white' : 'bg-subtle text-muted',
                  )}
                >
                  <Monitor className="size-4.5" />
                </span>
                <span className="font-semibold text-ink">{r.name}</span>
                <span className="text-xs text-muted">{busy ? `En uso por ${r.open_session_user}` : 'Disponible'}</span>
              </button>
            )
          })}
        </div>
      </div>
      <Field label="Monto de apertura (fondo de caja)" hint="Efectivo con el que inicia la caja">
        {(id) => (
          <Input
            id={id}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => setAmount(parseAmount(amount).toLocaleString('es-CL'))}
            className="max-w-xs text-lg font-semibold tabular-nums"
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={open.isPending} icon={<LockOpen />}>
        Abrir caja
      </Button>
    </form>
  )
}
