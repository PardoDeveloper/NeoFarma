import { describe, expect, it } from 'vitest'
import { clp, date, formatRut, isValidRut, parseAmount } from './format'

describe('formato chileno', () => {
  it('formatea pesos', () => {
    expect(clp(12990)).toBe('$12.990')
    expect(clp(0)).toBe('$0')
    expect(clp(null)).toBe('$0')
    expect(clp(-2000)).toBe('\u2212$2.000')
  })

  it('formatea fechas sin desfase de zona horaria', () => {
    expect(date('2026-09-25')).toBe('25-09-2026')
    expect(date('2026-01-01T00:00:00Z')).toBe('01-01-2026')
    expect(date(null)).toBe('—')
  })

  it('valida y formatea RUT', () => {
    expect(isValidRut('76.086.428-5')).toBe(true)
    expect(isValidRut('96519830-K')).toBe(true)
    expect(isValidRut('96519830-k')).toBe(true)
    expect(isValidRut('12.345.678-9')).toBe(false)
    expect(isValidRut('')).toBe(false)
    expect(formatRut('76086428-5')).toBe('76.086.428-5')
  })

  it('parsea montos con separador de miles', () => {
    expect(parseAmount('12.990')).toBe(12990)
    expect(parseAmount('$ 1.000')).toBe(1000)
    expect(parseAmount('')).toBe(0)
  })
})
