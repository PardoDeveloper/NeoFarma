import type { Role } from '@/api/types'

/** ¿Puede el rol ver un elemento restringido a `roles`? (admin siempre; undefined = todos) */
export function canSee(role: Role | undefined, roles?: Role[]) {
  if (!role) return false
  return !roles || role === 'admin' || roles.includes(role)
}
