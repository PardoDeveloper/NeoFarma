import { useState, type FormEvent } from 'react'
import { AlertCircle, Boxes, CalendarClock, Lock, User, Wallet } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { errorMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Logo } from '@/components/layout/Sidebar'
import { Callout } from '@/components/ui/display'

const features = [
  { icon: Boxes, label: 'Stock FEFO por lote' },
  { icon: CalendarClock, label: 'Alertas de vencimiento' },
  { icon: Wallet, label: 'Cuadratura de caja' },
  { icon: Lock, label: 'Control de recetas' },
]

export function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(username, password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-2">
      {/* Panel de marca */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-12 text-brand-50 lg:flex">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(currentColor 1.5px, transparent 1.5px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div aria-hidden className="absolute -top-28 -right-24 size-96 rounded-full bg-brand-400/20 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-96 rounded-full bg-brand-300/10 blur-3xl" />

        <div className="relative">
          <Logo inverse />
        </div>

        <div className="relative max-w-md">
          <p className="section-label mb-3 text-brand-300">Sistema interno</p>
          <h2 className="text-4xl leading-tight font-bold tracking-tight text-white">Tu farmacia, ordenada y bajo control.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-brand-100/80">
            Punto de venta ágil, control de lotes y vencimientos, ingreso de mercadería y cierres de caja en un solo lugar.
          </p>
          <ul className="mt-8 grid grid-cols-2 gap-3 text-sm text-brand-50">
            {features.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 rounded-xl bg-white/[0.07] px-3.5 py-3 ring-1 ring-white/10">
                <Icon className="size-4 shrink-0 text-brand-300" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-200/60">© {new Date().getFullYear()} NeoFarma · Sistema interno</p>
      </div>

      {/* Panel de acceso */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo />
          </div>

          <div className="rounded-2xl border border-line bg-surface p-7 shadow-card sm:p-8">
            <p className="section-label mb-1.5 hidden lg:block">Sistema interno</p>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Iniciar sesión</h1>
            <p className="mt-1 text-sm text-muted">Ingresa con tu usuario de NeoFarma.</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              {error && (
                <Callout tone="danger" role="alert" icon={<AlertCircle />}>
                  {error}
                </Callout>
              )}
              <Field label="Usuario">
                {(id) => (
                  <Input
                    id={id}
                    leftIcon={<User />}
                    autoFocus
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                )}
              </Field>
              <Field label="Contraseña">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    leftIcon={<Lock />}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                )}
              </Field>
              <Button type="submit" className="w-full" size="lg" loading={loading}>
                Ingresar
              </Button>
            </form>
          </div>

          {import.meta.env.DEV && (
            <p className="mt-4 rounded-lg border border-line bg-subtle px-3.5 py-2.5 text-center text-xs text-muted">
              Demo: <code className="font-mono text-ink-soft">admin</code>, <code className="font-mono text-ink-soft">quimico</code>,{' '}
              <code className="font-mono text-ink-soft">cajero</code>, <code className="font-mono text-ink-soft">bodega</code> · clave{' '}
              <code className="font-mono text-ink-soft">neofarma123</code>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
