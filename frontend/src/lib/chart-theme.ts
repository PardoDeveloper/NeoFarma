import { createElement, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'

/**
 * Tema de gráficos (Recharts) leído de las CSS variables de src/index.css, para claro y oscuro.
 *
 * Reglas (skill dataviz):
 * - Series en orden fijo, nunca cicladas: 1 verde marca · 2 azul · 3 violeta · 4 ámbar. Validadas
 *   (CVD ΔE ≥ 11.6, contraste ≥ 3:1 sobre surface en ambos modos). Un 5º grupo va a "Otros".
 * - Un solo eje Y. Grilla solo horizontal y recesiva; sin bordes de gráfico.
 * - ≥ 2 series → leyenda siempre; el texto usa ink/muted, nunca el color de la serie.
 * - Colores de estado (ok/warn/danger) reservados para estados, no para series.
 *
 * Uso:
 *   const ct = useChartTheme()
 *   <CartesianGrid {...ct.grid} />
 *   <XAxis dataKey="day" {...ct.axis} />
 *   <YAxis {...ct.axis} width={48} />
 *   <Tooltip {...ct.tooltip} />
 *   <Area dataKey="total" stroke={ct.series[0]} fill={ct.series[0]} fillOpacity={0.12} strokeWidth={2} />
 */
export interface ChartTheme {
  dark: boolean
  /** Colores de series en orden fijo. */
  series: [string, string, string, string]
  /** Tokens de superficie y texto (para leyendas y etiquetas propias). */
  surface: string
  ink: string
  muted: string
  faint: string
  line: string
  gridColor: string
  /** Estados (solo para marcar estados, no series). */
  status: { ok: string; warn: string; danger: string }
  /** Props para <CartesianGrid>. */
  grid: { stroke: string; strokeDasharray: string; vertical: false }
  /** Props para <XAxis>/<YAxis>. */
  axis: {
    stroke: string
    tick: { fill: string; fontSize: number }
    tickLine: false
    axisLine: false
    tickMargin: number
  }
  /** Props para <Tooltip>. */
  tooltip: {
    contentStyle: CSSProperties
    labelStyle: CSSProperties
    itemStyle: CSSProperties
    cursor: { stroke: string; strokeWidth: number } | { fill: string }
    wrapperStyle: CSSProperties
  }
  /** Cursor para gráficos de barras (banda en vez de línea). */
  barCursor: { fill: string }
  /** Props para <Legend>. */
  legend: { iconType: 'circle'; iconSize: number; wrapperStyle: CSSProperties; formatter: (value: string) => ReactNode }
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback
}

export function readChartTheme(): ChartTheme {
  const root = document.documentElement
  const s = getComputedStyle(root)
  const dark = root.classList.contains('dark')
  const surface = cssVar(s, '--surface', dark ? '#131a18' : '#ffffff')
  const ink = cssVar(s, '--ink', dark ? '#e7eeea' : '#14201b')
  const muted = cssVar(s, '--muted', dark ? '#94a59d' : '#5a6b63')
  const faint = cssVar(s, '--faint', dark ? '#62726b' : '#8a9a92')
  const line = cssVar(s, '--line', dark ? '#25302c' : '#e1e6e0')
  const gridColor = cssVar(s, '--chart-grid', line)
  const series: ChartTheme['series'] = [
    cssVar(s, '--chart-1', '#14a070'),
    cssVar(s, '--chart-2', '#0891d0'),
    cssVar(s, '--chart-3', '#7c3aed'),
    cssVar(s, '--chart-4', '#d97706'),
  ]
  return {
    dark,
    series,
    surface,
    ink,
    muted,
    faint,
    line,
    gridColor,
    status: dark ? { ok: '#34d399', warn: '#fbbf24', danger: '#fb7185' } : { ok: '#059669', warn: '#d97706', danger: '#e11d48' },
    grid: { stroke: gridColor, strokeDasharray: '3 3', vertical: false },
    axis: { stroke: faint, tick: { fill: faint, fontSize: 12 }, tickLine: false, axisLine: false, tickMargin: 8 },
    tooltip: {
      contentStyle: {
        background: surface,
        border: `1px solid ${line}`,
        borderRadius: 12,
        boxShadow: dark ? '0 12px 32px -8px rgb(0 0 0 / 0.6)' : '0 12px 32px -8px rgb(16 24 20 / 0.18)',
        padding: '8px 12px',
        fontSize: 13,
        color: ink,
      },
      labelStyle: { color: muted, fontSize: 12, fontWeight: 500, marginBottom: 4 },
      itemStyle: { color: ink, fontVariantNumeric: 'tabular-nums', padding: 0 },
      cursor: { stroke: cssVar(s, '--line-strong', faint), strokeWidth: 1 },
      wrapperStyle: { outline: 'none', zIndex: 20 },
    },
    barCursor: { fill: dark ? 'rgb(255 255 255 / 0.04)' : 'rgb(16 24 20 / 0.04)' },
    // El texto de la leyenda va en muted (no en el color de la serie); el punto lleva la identidad.
    legend: {
      iconType: 'circle',
      iconSize: 8,
      wrapperStyle: { fontSize: 12, paddingTop: 8 },
      formatter: (value: string) => createElement('span', { style: { color: muted, marginRight: 8 } }, value),
    },
  }
}

// Observa la clase `.dark` en <html> para recalcular cuando cambia el tema (se aplica en un efecto).
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => obs.disconnect()
}
const isDark = () => document.documentElement.classList.contains('dark')

/** Tema de gráficos reactivo al modo claro/oscuro. */
export function useChartTheme(): ChartTheme {
  const dark = useSyncExternalStore(subscribe, isDark, () => false)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `dark` invalida la lectura de CSS vars
  return useMemo(() => readChartTheme(), [dark])
}
