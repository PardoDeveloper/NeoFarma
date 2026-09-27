# Sistema de diseño NeoFarma — "Clínico cálido"

Guía de uso de las primitivas de `frontend/src/components/ui` y la shell de `components/layout`.
Principios, tokens y patrones de pantalla completos: skill `neofarma-design-system`.
**Catálogo vivo**: con `npm run dev`, abrir `http://localhost:5173/design` (solo en desarrollo).

## 1. Tokens (usar siempre estos; nada de `slate-*`/`gray-*`/`bg-white`)

| Clase | Uso |
|---|---|
| `bg-canvas` | fondo de la app |
| `bg-surface` | tarjetas, paneles, modales, inputs |
| `bg-subtle` | cabeceras de tabla, zonas secundarias, hover (`hover:bg-subtle`) |
| `border-line` / `border-line-strong` | divisores y bordes / inputs y bordes activos |
| `text-ink` / `text-ink-soft` / `text-muted` / `text-faint` | principal / cuerpo suave / secundario / metadatos y placeholders |
| `brand-50…900` | acción principal, activo, foco |
| `ok-*` `warn-*` `danger-*` `info-*` `rx-*` | estados (emerald / amber / rose / sky / violet) |
| `shadow-card` / `shadow-pop` | tarjetas / overlays (en oscuro: sin sombra, solo borde) |
| `bg-overlay` | velo detrás de modales |
| `.section-label` | etiqueta de sección (11px, mayúsculas, `text-faint`) |
| `font-mono` | SKU, lote, código de barras, N° documento (JetBrains Mono) |
| `animate-fade-in` `animate-pop-in` `animate-slide-in-right` `animate-shimmer` | animaciones sutiles (respetan `prefers-reduced-motion`) |

**Colores tintados en oscuro**: los tintes claros no sirven en oscuro. Patrón:
`bg-ok-50 text-ok-700 dark:bg-ok-500/15 dark:text-ok-300` (igual con `brand`, `warn`, `danger`, `info`, `rx`).
Texto brand en oscuro: `dark:text-brand-300`/`400`.

Montos: siempre `clp()` + `tabular-nums` (los `<Td numeric>`, `Input` y `StatCard` ya lo aplican).

**Paletas crudas prohibidas**: `slate-*`, `gray-*`, `red-*`, `amber-*`, `emerald-*`, `sky-*`, `violet-*`… y `bg-white` opaco
ya **no** se adaptan al modo oscuro (el antiguo "LEGACY BRIDGE" de `index.css` se eliminó en la fase 3). Lo vigila
`src/test/design-tokens.test.ts`: falla si reaparecen. Única excepción: `white` **translúcido** (`bg-white/[0.07]`,
`ring-white/10`, `text-white`) sobre superficies sólidas que no cambian con el tema (botón primario, `Kbd tone="inverse"`,
panel de marca del login).

## 2. Tema

- `ThemeProvider` (`src/lib/theme.tsx`) + `useTheme()` (`src/lib/theme-context.ts`): `{ theme: 'light'|'dark'|'system', resolved, setTheme, toggle }`.
- Persistido en `localStorage['neofarma.theme']`; `index.html` aplica `.dark` en `<html>` antes del primer render.
- Variante Tailwind: `dark:` (por clase).

## 3. Primitivas

Importar desde `@/components/ui/<archivo>`. `display.tsx` re-exporta Card, StatCard, MiniStat, IconTile, Skeleton y Kbd.

### Button / IconButton — `ui/button.tsx`
```tsx
<Button variant="primary|secondary|soft|ghost|success|danger" size="xs|sm|md|lg"
        icon={<Plus />} iconRight={<ChevronRight />} kbd="F4" loading>Cobrar</Button>
<IconButton label="Editar" size="sm|md|lg" variant="ghost|secondary|danger"><Pencil /></IconButton>
```
- `kbd` solo muestra el atajo; registrarlo con `useHotkeys`.
- Iconos sin clase `size-*` se dimensionan solos según el tamaño del botón.
- Un solo `primary` por zona. `danger` para acciones destructivas, separado de las frecuentes.
- `focusRing` exportado para controles propios.

### Formularios — `ui/form.tsx`
```tsx
<Field label="Precio" required error={errors.price?.message} hint="IVA incluido" labelAction={<a>Generar</a>}>
  {(id) => <Input id={id} leftIcon={<DollarSign />} rightSlot="CLP" invalid={!!errors.price} {...register('price')} />}
</Field>
<Input inputSize="lg" leftIcon={<Barcode />} rightSlot={<Kbd>F2</Kbd>} wrapperClassName="flex-1" />
<Select inputSize="sm|md|lg" invalid>…</Select>
<Textarea rows={3} />
<Checkbox label="Bioequivalente" description="Texto de ayuda" checked onChange={…} />
```
- Con `leftIcon`/`rightSlot` el input se envuelve: el ancho va en `wrapperClassName`.
- `FormSection title="Clasificación" description? columns={2|3|4}`: agrupa campos de formularios largos con etiqueta de
  sección; `columns` arma la grilla responsiva (1 columna en móvil).
- `controlCls` exportado para controles propios.

### Card / CardHeader — `ui/card.tsx`
```tsx
<Card className="p-5">…</Card>
<Card><CardHeader title="Stock bajo" subtitle="Bajo el mínimo" icon={<Boxes />} action={<Button size="sm" variant="ghost">Ver todos</Button>} bordered={false} />…</Card>
```

### PageHeader — `ui/display.tsx`
```tsx
<PageHeader eyebrow="Inventario" title="Productos" subtitle="342 productos activos" actions={<Button icon={<Plus />}>Nuevo</Button>} />
```

### Badge
```tsx
<Badge tone="gray|ok|warn|danger|info|rx|brand" dot size="sm|md" icon={…}>Vigente</Badge>
```
Alias antiguos siguen válidos (`green`, `amber`, `red`, `blue`, `violet`). Estados siempre con texto (y `dot`), nunca solo color.
**El color es para estados**; los *datos* categóricos (medio de pago, rol) van en badge neutro + icono.
Dominio (`components/badges.tsx`): `SaleConditionBadge`, `ExpiryBadge`, `StockBadge`, `PaymentBadge` (neutro + icono,
mismos iconos que el cobro), `MovementQty` (+entrada verde / −salida rosa, para movimientos de inventario).

### Kbd — `ui/kbd.tsx`
`<Kbd>F2</Kbd>` · `<Kbd tone="inverse">` sobre fondos sólidos.

### Table / Th / Td / Tr / RowActions
```tsx
<Table containerClassName="max-h-[65vh]" dense>
  <thead><tr><Th>Producto</Th><Th numeric>Precio</Th><Th className="w-20" /></tr></thead>
  <tbody>
    {loading ? <SkeletonRows rows={8} cols={3} numeric={[1]} /> : rows.map((p) => (
      <Tr key={p.id} onClick={() => open(p.id)} selected={p.id === selectedId}>
        <Td><p className="font-medium">{p.name}</p><p className="font-mono text-xs text-muted">{p.sku}</p></Td>
        <Td numeric className="font-semibold">{clp(p.price)}</Td>
        <Td><RowActions><IconButton label="Editar"><Pencil /></IconButton></RowActions></Td>
      </Tr>
    ))}
  </tbody>
</Table>
```
- Cabecera sticky (necesita alto limitado en `containerClassName` para quedar fija dentro de la tabla).
- Todas las filas tienen hover. `Tr` con `onClick` es enfocable y abre con Enter.
- `numeric` alinea a la derecha con `tabular-nums`.

### Pagination
`<Pagination page={page} pageSize={20} total={data.total} onChange={setPage} />` — "Mostrando 1–20 de 342", números de página.

### Tabs / Segmented
```tsx
<Tabs value={tab} onChange={setTab} items={[{ value: 'lotes', label: 'Lotes', count: 4, icon: <Boxes /> }]} size="sm|md" />
<Segmented aria-label="Rango" value={range} onChange={setRange} items={[{ value: '7d', label: '7 días' }]} />
```
`Tabs` cambia el contenido (role tab); `Segmented` es un filtro de opción única (role radio). Flechas ←/→.

### StatCard (KPI) / Delta / Sparkline — `ui/stat-card.tsx`
```tsx
<StatCard label="Ventas de hoy" value={clp(total)} icon={<DollarSign />} tone="brand|gray|blue|amber|red|violet"
          delta={12.4} deltaLabel="vs. ayer" invertDelta={false} sparkline={last7} hint="6 transacciones" loading={isLoading} />
```
`delta` es porcentaje (▲ verde / ▼ rosa + texto accesible); `invertDelta` cuando bajar es bueno.

### Estados
```tsx
<Skeleton className="h-4 w-32" />   <SkeletonText lines={3} />   <SkeletonRows rows={6} cols={4} />
<EmptyState icon={<Package />} title="Sin productos" message="…" action={<Button>…</Button>} tone="brand|gray|amber" compact />
<ErrorState error={q.error} onRetry={() => q.refetch()} title="No se pudo cargar" />
<Spinner label="Cargando…" inline />
```
Carga de listas y tarjetas = Skeleton (Spinner solo para acciones o carga global).

### Barra de filtros — `ui/filters.tsx`
Toda lista con filtros usa **una** barra en la cabecera de su `Card`, todos los controles a `h-10`, sin etiquetas encima:
```tsx
<Card>
  <FilterBar>
    <SearchField placeholder="Buscar por nombre, SKU o código" value={search} onValueChange={setSearch} aria-label="Buscar producto" />
    <DateRange from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
    <Segmented aria-label="Estado" value={status} onChange={setStatus} items={…} className="p-[3px]" />  {/* p-[3px] = alto 40px */}
    <Select className="w-48" aria-label="Medio de pago">…</Select>
    <FilterChip active={lowStock} onClick={toggle} icon={<AlertTriangle />}>Stock bajo</FilterChip>
    {hasFilters && <Button variant="ghost" size="sm" icon={<X />}>Limpiar</Button>}
  </FilterBar>
  <Table>…</Table>
</Card>
```
- `SearchField`: lupa, ocupa el espacio libre (`min-w-60 flex-1`), botón × y `Esc` para limpiar.
- `FilterChip` = filtro activable independiente; `Segmented` = opción única excluyente; > 4 opciones → `Select`.
- Avisos contextuales de la lista (p. ej. vencidos) van dentro de la barra con `<Callout compact>`.

### Lista móvil — `ui/list.tsx`
Bajo `md` las tablas se reemplazan por lista apilada (misma data):
```tsx
<div className="hidden md:block"><Table>…</Table></div>
{loading ? <SkeletonList /> : (
  <MobileList>
    {rows.map((p) => (
      <MobileListItem key={p.id} onClick={() => open(p.id)} selected={p.id === sel} dimmed={!p.active}
                      aside={<p className="font-semibold tabular-nums">{clp(p.price)}</p>}>
        <p className="truncate font-medium text-ink">{p.name}</p>
        <p className="font-mono text-xs text-muted">{p.sku}</p>
      </MobileListItem>
    ))}
  </MobileList>
)}
```

### Callout, MiniStat, SummaryRow, IconTile
```tsx
<Callout tone="info|ok|warn|danger|rx" title="Venta anulada el …" icon={<Ban />} compact role="alert">Motivo: …</Callout>
<MiniStat label="Margen" value="42%" tone="ok|warn|danger|brand" hint="…" align="start|center" />   // datos en drawers/paneles
<SummaryRow label="IVA 19%" value={clp(tax)} />  <SummaryRow label="Total" value={clp(total)} strong />
<IconTile tone="brand|gray|ok|warn|danger|info|rx" size="sm|md|lg"><Package /></IconTile>
```
- `Callout`: aviso en línea no bloqueante, siempre icono + texto (errores de login, venta anulada, receta, lotes vencidos).
- `MiniStat` para datos dentro de drawers/modales; `StatCard` para KPIs de página.
- `IconTile`: el tono significa algo; en KPIs neutros usar `tone="gray"` (`StatCard tone="gray"`), `brand` solo para el dato principal.

### Modal / ConfirmDialog / ModalActions — `ui/modal.tsx`
```tsx
<Modal open={open} onClose={close} title="Registrar egreso" description="…" size="sm|md|lg|xl"
       icon={<DollarSign />} iconTone="brand|danger|warn" bodyClassName="…" footer={<><Button variant="secondary">Cancelar</Button><Button>Guardar</Button></>}>…</Modal>
<ConfirmDialog open onClose onConfirm title="¿Anular la venta?" message="Consecuencia…" confirmLabel="Anular" danger loading />
```
**Formularios en modal**: el pie va dentro del `<form>` (para que `Enter` envíe) con `ModalActions`, que se ve idéntico
a la prop `footer` (barra a sangre, fondo sutil, primaria a la derecha). Nunca filas de botones ad hoc.
```tsx
<Modal title="Nuevo proveedor" description="Droguería, laboratorio o distribuidor" icon={<Building2 />} size="lg">
  <form onSubmit={…} className="space-y-6">
    <FormSection title="Identificación" columns={3}>…</FormSection>
    <FormSection title="Contacto" columns={2}>…</FormSection>
    <ModalActions start="Opcional: ayuda a la izquierda">
      <Button variant="secondary" onClick={close}>Cancelar</Button>
      <Button type="submit">Registrar proveedor</Button>
    </ModalActions>
  </form>
</Modal>
```
Crear/editar: título "Nuevo X"/"Editar X", `description` con el nombre del registro e `icon`.

### Drawer — `ui/drawer.tsx`
Para **consultar** detalle (producto, venta, compra) sin perder la lista. Modal es para crear/editar/confirmar.
```tsx
<Drawer open={!!id} onClose={() => setId(null)} title={p.name} description={p.laboratory}
        meta={<><span className="font-mono text-xs text-muted">{p.sku}</span><SaleConditionBadge value={p.sale_condition} /></>}
        actions={<IconButton label="Editar" size="md"><Pencil /></IconButton>}
        toolbar={<Tabs … size="sm" />} width="sm|md|lg|xl" footer={…}>…</Drawer>
```
Modal, Drawer y paleta comparten `useOverlay` (`ui/overlay.ts`): Esc cierra solo el superior, foco atrapado y restaurado, scroll bloqueado.
- **Edición en línea dentro de un overlay** (renombrar una caja en el Drawer): marcar el contenedor con `data-escape-local`;
  Esc dentro de él lo maneja el propio campo (cancelar edición) y no cierra el panel.
- **Menús desplegables no modales** (menú de usuario, selector de sucursal): `useDismiss(open, close, rootRef, triggerRef)`
  cierra al hacer clic fuera o con Esc y devuelve el foco al disparador. Panel: `animate-pop-in rounded-xl border border-line bg-surface shadow-pop`;
  en móvil (< sm) el panel es `fixed inset-x-3 top-[68px]` (ancho completo bajo la Topbar).

## 4. Convenciones transversales (fase 3)
- **Ancho**: las páginas usan el ancho del `main` (sin `mx-auto max-w-*` propio), así todas las cabeceras quedan alineadas.
- **Identificadores** (`#367` venta, `#5` ingreso): `font-mono text-[13px] font-medium text-brand-700 dark:text-brand-300`.
- **Montos**: `clp()` formatea negativos como `−$2.000` (signo antes del símbolo). Diferencias con signo: `+$500` / `−$2.000`.
- **Acciones de fila**: `RowActions` (visibles al pasar el mouse); si la acción ES la tarea de la vista (merma en "Vencidos"),
  forzar visible. Filas que abren detalle/edición son clicables (`Tr onClick`), el `IconButton` hace `stopPropagation`.
- **Drawer vs Modal**: consultar = Drawer (producto, venta, ingreso); crear/editar/confirmar = Modal.
- **Dashboard por rol**: cajero y químico ven "Tu caja"; admin ve el resumen de inventario; bodega ve "Foco de hoy"
  sin franjas de alerta duplicadas y con las listas operativas antes que los gráficos.

## 5. Shell y navegación (`components/layout`)
- `nav.ts`: secciones y rutas con roles (usado por Sidebar y paleta). Agregar módulos aquí.
- Sidebar colapsable a riel (persistido en `localStorage['neofarma.sidebar']`); en < 1024px es drawer.
- Topbar: **selector de sucursal** → buscador/**paleta de comandos** (`Ctrl/⌘+K`) → estado de caja → tema → menú de usuario → `Cerrar sesión`.
  En móvil el buscador es solo icono y "Cerrar sesión" pasa al menú de usuario, para dejar espacio a la sucursal.

### Selector de sucursal — `layout/BranchSwitcher.tsx`
Multi-sucursal (ADR 0004): la sucursal activa es contexto de TODO lo que se ve, por eso vive a la izquierda de la Topbar,
siempre visible. Usa `useBranch()` (`src/lib/branch-context.ts`); cambiar llama `setBranch`, que vacía la caché y remonta la app.
- **Una sola sucursal** (la mayoría de los usuarios, la instalación de un local): etiqueta fija sin menú (icono tienda + "Sucursal / nombre").
- **Varias**: botón con menú `role="menu"` de `menuitemradio`: icono, nombre, `código` en mono · dirección, check en la activa.
  Admin con >1: primera opción **"Todas las sucursales (consolidado · solo lectura)"** con icono `Layers` en tono info (azul),
  y pie "Administrar sucursales y cajas" → `/sucursales`. El admin ve también las inactivas (glifo gris + badge "Inactiva").
- Disparador: glifo (tienda en `brand`, capas en `info` para consolidado) + etiqueta `text-[10px] uppercase` ("Sucursal" / "Consolidado")
  + nombre `font-semibold`. `sm:w-60` fijo para que la barra no salte al cambiar. **En móvil muestra el código** (`MATRIZ`, `CENTRO`)
  en mono: más corto y reconocible que un nombre truncado; el nombre queda en `sr-only`.
- Teclado: `↓`/`↑` en el botón abre el menú con foco en la opción activa; `↑ ↓ Home End` navegan; `Enter` elige; `Esc` cierra y devuelve el foco.
- Paleta de comandos: grupo **"Sucursal"** con "Cambiar a <nombre>" por cada sucursal accesible (menos la activa; hint = código)
  y "Ver todas las sucursales" para el admin.
- En "Todas" el **indicador de caja se oculta** (no se opera en consolidado); las páginas de escritura muestran `RequireBranch`.
- Datos por sucursal en listas: badge neutro con icono `Store` y el nombre; "Todas" (badge `brand` con `Layers`) para el admin.
  Máx. 2 badges + "+N" con la lista completa en `title`.
- Paleta: módulos según rol, acciones rápidas y productos en vivo. Elegir un producto navega a **`/productos?id=<id>`**,
  que abre el Drawer de detalle del producto.
- `main` tiene `max-w-[1600px]` centrado y padding; `/pos` usa todo el alto (`h-full`) y padding reducido.
  Las páginas no necesitan su propio `mx-auto max-w-*` salvo que quieran algo más angosto.

### Página Sucursales (`features/branches`) — patrón "lista + panel de hijos"
- Tabla de sucursales (código como chip mono `BranchCode`, nombre con badge "Sucursal actual", dirección truncada, teléfono,
  usuarios y cajas numéricos, estado). Clic en fila → **Drawer de cajas** (consultar/operar hijos sin perder la lista);
  lápiz → Modal de edición (crear/editar = Modal).
- Drawer de cajas: alta rápida en la `toolbar` (input + "Agregar", Enter envía), lista de cajas con estado
  **Libre** (ok) / **En uso** (info, "Turno abierto por X") / **Inactiva** (neutro); renombrar en línea (Enter guarda, Esc cancela)
  y (des)activar. Con turno abierto el botón Desactivar queda deshabilitado (tooltip) — prevención antes que error;
  si igual llega `register_open`, toast con el mensaje del servidor.
- Formulario de sucursal: código se normaliza al escribir (mayúsculas, sin tildes, espacios → `_`, solo `A-Z0-9_-`).
  Al desmarcar "Sucursal activa" aparece un aviso ámbar y el botón pasa a `danger` "Desactivar y guardar";
  `open_sessions` se muestra como Callout danger arriba del formulario.

### Asignación de sucursales en Usuarios
Fieldset "Sucursales *" con lista de checkboxes (nombre + código mono) dentro de un contenedor con borde `border-line-strong`
(rojo si hay error) y acción "Marcar todas". Obligatorio (≥1) para roles no admin; para admin se reemplaza por un Callout info
"accede a todas las sucursales". Nuevo usuario: se propone la sucursal activa. Errores `branches_required`/`invalid_branch`
se muestran bajo el fieldset (no toast).

## 6. Gráficos (`src/lib/chart-theme.ts`)
```tsx
const ct = useChartTheme()
<CartesianGrid {...ct.grid} />
<XAxis dataKey="label" {...ct.axis} />  <YAxis {...ct.axis} width={56} />
<Tooltip {...ct.tooltip} formatter={(v) => clp(Number(v))} />       // barras: cursor={ct.barCursor}
<Legend {...ct.legend} />                                              // solo con ≥ 2 series
<Area dataKey="total" stroke={ct.series[0]} fill={ct.series[0]} fillOpacity={0.1} strokeWidth={2} />
<Bar dataKey="x" fill={ct.series[1]} radius={[4, 4, 0, 0]} maxBarSize={24} />
```
- Series en orden fijo: `series[0]` verde marca, `[1]` azul, `[2]` violeta, `[3]` ámbar (validadas para daltonismo y contraste en claro y oscuro). Más de 4 → agrupar en "Otros".
- Un solo eje Y; grilla horizontal; sin bordes; texto en ink/muted, nunca en color de serie.
- `ct.status.{ok,warn,danger}` solo para estados. `Sparkline` para mini tendencias.

## 7. Checklist por pantalla
1. Solo tokens semánticos (el test `design-tokens` lo exige). Filtros con `FilterBar`, lista móvil con `MobileList`.
2. Carga con Skeleton/SkeletonRows; vacío con EmptyState + acción; error con ErrorState.
3. Atajos visibles (`kbd` en Button, `<Kbd>`), foco visible, `aria-label` en IconButton.
4. Revisar con `node scripts/shots.mjs` en claro, `--dark` y `--mobile`.
