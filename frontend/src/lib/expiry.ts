import type { ExpiryStatus } from '@/api/types'

/** Clasifica días a vencimiento igual que el backend: vencido, crítico (≤30), próximo (≤90), vigente. */
export function expiryStatusFromDays(days: number): ExpiryStatus {
  if (days < 0) return 'vencido'
  if (days <= 30) return 'critico'
  if (days <= 90) return 'proximo'
  return 'vigente'
}
