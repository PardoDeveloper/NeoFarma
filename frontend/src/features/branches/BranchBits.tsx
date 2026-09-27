import { Badge } from '@/components/ui/display'

export function BranchStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="ok" dot>
      Activa
    </Badge>
  ) : (
    <Badge dot>Inactiva</Badge>
  )
}

/** Código de sucursal: dato técnico en mono, compacto. */
export function BranchCode({ code }: { code: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-subtle px-2 font-mono text-xs font-semibold tracking-wide text-ink-soft ring-1 ring-line ring-inset">
      {code}
    </span>
  )
}
