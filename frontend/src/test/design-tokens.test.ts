// Guardia del sistema de diseño: el "LEGACY BRIDGE" de index.css se eliminó, así que las paletas crudas de
// Tailwind ya no se adaptan al modo oscuro. Usar tokens semánticos (ver docs/design-system.md).
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Paletas crudas prohibidas (los tonos semánticos son brand/ok/warn/danger/info/rx).
const raw =
  /\b(?:bg|text|border|ring|from|to|via|divide|fill|stroke|outline|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|amber|emerald|green|sky|blue|violet|purple|yellow|rose|orange)-\d{2,3}\b/
// `white` solo translúcido sobre superficies sólidas de marca (Kbd inverso, panel del login); nunca `bg-white` opaco.
const opaqueWhite = /\bbg-white(?![/\w-])/

describe('tokens de diseño', () => {
  it('encuentra el código fuente', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30)
  })

  it('no usa paletas crudas de Tailwind ni bg-white opaco', () => {
    const offenders = Object.entries(sources).flatMap(([file, src]) =>
      src
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => raw.test(line) || opaqueWhite.test(line))
        .map(({ line, i }) => `${file}:${i + 1}: ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})
