#!/usr/bin/env node
// Capturas de pantalla para revisión visual de UI (usado por los agentes de diseño y QA).
//
// Uso:  node scripts/shots.mjs [--user cajero] [--out ../.shots] [--dark] [--mobile] ruta1 ruta2 ...
//   node scripts/shots.mjs --user quimico / /productos /inventario?tab=proximos
//   node scripts/shots.mjs --user cajero --dark /pos
//   node scripts/shots.mjs --base http://localhost:5174 --user admin --branch all /   (entorno demo multi-sucursal)
// Requiere la API (:8080) y Vite (:5173) corriendo. Imprime errores de consola del navegador.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return def
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return false
  args.splice(i, 1)
  return true
}
const user = opt('user', 'admin')
const out = opt('out', '../.shots')
const base = opt('base', 'http://localhost:5173')
const wait = Number(opt('wait', '1500')) // espera para animaciones de gráficos
const branch = opt('branch', null) // id de sucursal o "all" (se guarda como sucursal activa)
const dark = flag('dark')
const mobile = flag('mobile')
const full = flag('full')
const routes = args.length ? args : ['/']

function findChromium() {
  const root = join(process.env.HOME, '.cache/ms-playwright')
  if (!existsSync(root)) return undefined
  for (const d of readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()) {
    const sub = readdirSync(join(root, d)).find((s) => s.startsWith('chrome-'))
    if (sub) return join(root, d, sub, 'chrome-headless-shell')
  }
}

mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: findChromium() })
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: dark ? 'dark' : 'light',
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()))

await page.goto(base)
if (dark) await page.evaluate(() => localStorage.setItem('neofarma.theme', 'dark'))
if (branch) await page.evaluate((b) => localStorage.setItem('neofarma.branch', b), branch)
await page.fill('input[autocomplete=username]', user)
await page.fill('input[type=password]', 'neofarma123')
await page.click('button[type=submit]')
await page.waitForLoadState('networkidle')

for (const r of routes) {
  await page.goto(base + r)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(wait)
  const name = `${user}${r.replace(/[^a-z0-9]+/gi, '_')}${dark ? '-dark' : ''}${mobile ? '-mobile' : ''}.png`
  await page.screenshot({ path: join(out, name), fullPage: full })
  console.log('📸', join(out, name))
}
console.log(errors.length ? `⚠ Errores de consola:\n${errors.join('\n')}` : '✔ Sin errores de consola')
await browser.close()
