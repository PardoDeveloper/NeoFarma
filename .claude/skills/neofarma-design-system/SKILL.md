---
name: neofarma-design-system
description: Sistema de diseño visual de NeoFarma (dirección "clínico cálido"): tokens de color claro/oscuro, tipografía, espaciado, radios, sombras, specs de componentes y patrones de pantalla. Cargar SIEMPRE antes de crear o modificar cualquier interfaz en frontend/ (pantallas, componentes, estilos, gráficos, layout).
---

# NeoFarma Design System — "Clínico cálido"

NeoFarma es una herramienta de trabajo que se usa **8+ horas al día** en mesón de farmacia. El diseño debe sentirse **preciso como un instrumento clínico y cálido como una buena farmacia de barrio**: calmo, legible, rápido, con personalidad sobria. Nada de "dashboard de plantilla" (azul-gris genérico, tarjetas idénticas, sombras duras, todo del mismo peso).

## 1. Principios
1. **Jerarquía por peso, no por decoración.** Un dato protagonista por bloque (el total, el stock, la diferencia de caja). Lo secundario en `text-muted` y tamaño menor.
2. **El color significa algo.** Verde marca = acción principal/estado OK. Ámbar = atención. Rosa/rojo = peligro/vencido. Violeta = receta (Rx). Azul = información. Nunca color decorativo aleatorio.
3. **Comodidad visual prolongada.** Canvas cálido (no blanco puro), contraste AA, modo oscuro real, sin animaciones gratuitas.
4. **Velocidad > adorno.** Cada pantalla debe resolver su tarea principal con teclado y en el mínimo de clics.
5. **Consistencia absoluta.** Usar primitivas de `src/components/ui`; si falta una, créala ahí, no estilos ad-hoc repetidos.

## 2. Tokens (definidos en `src/index.css`, Tailwind v4 `@theme`)
Los colores semánticos son variables CSS que cambian con `.dark` en `<html>`. **Usar siempre los semánticos**, no `slate-*`/`gray-*` directos.

| Token (clase) | Claro | Oscuro | Uso |
|---|---|---|---|
| `bg-canvas` | `#F5F6F3` | `#0C1210` | Fondo de la app |
| `bg-surface` | `#FFFFFF` | `#131A18` | Tarjetas, paneles, modales |
| `bg-subtle` | `#EEF1EC` | `#19221F` | Cabeceras de tabla, zonas secundarias, hover |
| `border-line` | `#E1E6E0` | `#25302C` | Bordes y divisores |
| `border-line-strong` | `#C9D1C9` | `#34413C` | Inputs, bordes activos |
| `text-ink` | `#14201B` | `#E7EEEA` | Texto principal |
| `text-muted` | `#5A6B63` | `#94A59D` | Texto secundario |
| `text-faint` | `#8A9A92` | `#62726B` | Placeholders, metadatos |
| `brand-50…900` | verde farmacia | igual (usar 400/300 en oscuro para texto) | Acciones, activo, foco |
| `ok-*` / `warn-*` / `danger-*` / `info-*` / `rx-*` | emerald / amber / rose / sky / violet | | Estados semánticos |

Escala `brand`: 50 `#EAFBF3` · 100 `#CDF4E2` · 200 `#9DE8C8` · 300 `#63D5A8` · 400 `#2FBC88` · 500 `#14A070` · 600 `#0B8259` · 700 `#0A6849` · 800 `#0B533C` · 900 `#0A4432`.

## 3. Tipografía
- UI: **Plus Jakarta Sans Variable** (`@fontsource-variable/plus-jakarta-sans`, local, sin CDN — app interna).
- Códigos (SKU, lote, código de barras, N° documento): **JetBrains Mono Variable** → clase `font-mono`.
- **Todo número/monto con `tabular-nums`** (alineación en columnas y totales).
- Escala: `text-xs` 12 metadatos · `text-sm` 14 cuerpo por defecto · `text-base` 16 · `text-lg` 18 títulos de tarjeta · `text-2xl` 24 título de página (`font-bold tracking-tight`) · KPIs `text-3xl` · total POS `text-5xl`.
- Etiquetas de sección: `text-[11px] font-semibold uppercase tracking-wider text-faint`.

## 4. Forma, espacio y elevación
- Radios: controles `rounded-lg` (10px) · tarjetas `rounded-2xl` · pills/badges `rounded-full` o `rounded-md`.
- Espaciado base 4px; padding de tarjeta `p-5`/`p-6`; gap entre tarjetas `gap-4`/`gap-6`. Siempre `gap-*` entre hermanos, no márgenes.
- Sombras suaves y en capas: `shadow-[0_1px_2px_rgb(16_24_20/0.04),0_1px_1px_rgb(16_24_20/0.03)]` para tarjetas (token `shadow-card`); modales `shadow-2xl`. En oscuro, sin sombras: bordes.
- Alturas: inputs/botones `h-10` (md), `h-9` (sm), `h-12` (lg). Filas de tabla ~44px.
- Foco visible siempre: `ring-2 ring-brand-500/40` + `ring-offset` con color del canvas.

## 5. Componentes (en `src/components/ui`)
- **Button**: variantes `primary` (brand sólido), `secondary` (surface + borde), `ghost`, `danger`, `success`; con `icon`, `loading`, atajo opcional (`kbd`).
- **Input/Select/Textarea**: `bg-surface border-line-strong`, prefijo/sufijo de icono, estado `invalid`.
- **Card** (`rounded-2xl bg-surface border border-line shadow-card`) + `CardHeader` con título, subtítulo y acción.
- **Badge** con punto de color opcional (`dot`) para estados.
- **Table**: cabecera `bg-subtle` sticky, filas con hover `bg-subtle/60`, columna numérica alineada a la derecha, acciones visibles al hover.
- **Skeleton** en lugar de spinners para listas y tarjetas.
- **EmptyState** con icono en círculo tintado, título, texto y acción.
- **Kbd** para atajos (`<Kbd>F4</Kbd>`).
- **Segmented/Tabs**, **Modal** (header, body, footer), **Drawer** lateral para detalles (productos, ventas) en vez de modal cuando se consulta información.
- **StatCard** (KPI): etiqueta, valor grande, delta vs período anterior (▲ verde / ▼ rosa) y sparkline opcional.

## 6. Patrones de pantalla
- **Shell**: sidebar clara (`bg-surface`, borde derecho) colapsable a riel de iconos; ítem activo = pill `bg-brand-50 text-brand-700` con barra lateral de 3px; topbar con buscador/paleta de comandos (Ctrl+K), estado de caja, toggle de tema y menú de usuario.
- **Página**: `PageHeader` (título, descripción, acciones a la derecha) → barra de filtros (una fila, sticky si la lista es larga) → contenido.
- **Listas**: búsqueda con icono y debounce, filtros como chips/segmented, conteo de resultados, paginación abajo.
- **Detalle**: drawer derecho con encabezado rico (nombre, códigos en mono, badges) y pestañas.
- **Formularios**: agrupar en secciones con título; 2 columnas en desktop; validación inline; botón primario abajo a la derecha; `Enter` envía.
- **POS**: tres zonas — búsqueda protagonista arriba, carrito como "ticket" central con filas grandes, panel de total/cobro fijo a la derecha con el total en `text-5xl`. Todo operable por teclado; atajos visibles con `Kbd`.
- **Estados**: loading = skeleton; vacío = EmptyState con acción; error = mensaje + reintentar; éxito = toast breve.

## 7. Gráficos
Cargar también la skill `dataviz`. Paleta de series: brand-500, sky-500, violet-500, amber-500. Ejes y grillas en `text-faint`/`border-line`, sin bordes de gráfico, tooltips con `bg-surface border-line`. Respetar modo oscuro (leer colores de CSS vars).

## 8. Checklist antes de terminar
- [ ] Sin colores `slate-*`/`gray-*` directos en código nuevo (solo tokens semánticos).
- [ ] Se ve bien en claro **y oscuro**, en 1440px y 390px.
- [ ] Montos con `clp()` y `tabular-nums`; códigos en `font-mono`.
- [ ] Todos los estados (carga, vacío, error) cubiertos.
- [ ] Capturas revisadas con `npm run shots` (ver skill `neofarma-ux-review`).
- [ ] `npm run typecheck && npm run lint && npm test` en verde.
