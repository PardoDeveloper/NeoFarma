---
name: neofarma-ux-review
description: Método de revisión UX/UI de NeoFarma - heurísticas de usabilidad aplicadas a farmacia/POS, cómo tomar y revisar capturas reales de la app (claro, oscuro, móvil) con npm run shots, y checklist de accesibilidad y ergonomía. Usar al diseñar, rediseñar o validar cualquier pantalla del frontend.
---

# Revisión UX/UI de NeoFarma

## 1. Ver antes de opinar: capturas reales
Con la API (:8080) y Vite (:5173) corriendo (`./scripts/dev.sh` desde la raíz si no están arriba):

```bash
cd frontend
node scripts/shots.mjs --user cajero /pos /caja /ventas          # claro, 1440x900
node scripts/shots.mjs --user quimico --dark / /productos        # modo oscuro
node scripts/shots.mjs --user quimico --mobile /                 # 390x844
node scripts/shots.mjs --user admin --full /reportes             # página completa
```
Las imágenes quedan en `.shots/` (raíz del repo). **Ábrelas con la herramienta Read** y evalúalas. Usuarios: `admin`, `quimico`, `cajero`, `cajero2`, `bodega` (clave `neofarma123`). El script reporta errores de consola del navegador: deben ser cero.

Para flujos interactivos (abrir un modal, llenar el carrito) escribe un script Playwright temporal en el scratchpad basado en `frontend/scripts/shots.mjs` (misma función `findChromium`).

## 2. Heurísticas aplicadas a farmacia
| Heurística | Pregunta concreta en NeoFarma |
|---|---|
| Estado del sistema visible | ¿Se ve siempre si hay caja abierta, cuánto se lleva vendido, si algo está cargando o guardándose? |
| Lenguaje del usuario | ¿Se usan términos de farmacia chilena (receta retenida, lote, vencimiento, arqueo, boleta, RUT)? |
| Control y libertad | ¿Se puede cancelar/volver con Esc? ¿Acciones destructivas piden confirmación y dicen la consecuencia? |
| Prevención de errores | ¿Se bloquea vender sin stock, lotes vencidos, RUT inválido, montos negativos *antes* de enviar? |
| Reconocer > recordar | ¿Los atajos están visibles? ¿El stock y el precio se ven al buscar? |
| Eficiencia experta | ¿El cajero puede vender sin mouse? ¿Hay Ctrl+K para saltar a cualquier módulo/producto? |
| Minimalismo | ¿Cada pantalla tiene un protagonista claro? ¿Hay ruido (bordes/colores/badges) innecesario? |
| Recuperación de errores | ¿Los mensajes dicen qué pasó y qué hacer, en español, junto al campo afectado? |

## 3. Ergonomía de mesón (puesto de trabajo real)
- Objetivos clicables ≥ 40px en POS y caja (uso con prisa, a veces pantalla táctil).
- Total a pagar legible a 1 metro (≥ 40px). Vuelto destacado en verde.
- Zonas de peligro (anular, cerrar caja, vaciar carrito) separadas de las acciones frecuentes.
- Nada crítico se comunica solo con color: acompañar con icono o texto.
- Uso prolongado: modo oscuro disponible, sin blancos puros enormes, sin animaciones que distraigan.

## 4. Accesibilidad mínima (WCAG AA)
- Contraste texto ≥ 4.5:1 (≥ 3:1 en texto grande e iconos informativos) en claro y oscuro.
- Todo input con `<label>` asociado; botones de icono con `aria-label`.
- Foco visible en todo elemento interactivo; orden de tabulación lógico; modales atrapan el foco y cierran con Esc.
- `prefers-reduced-motion` respetado.

## 5. Formato del informe de revisión
Por pantalla: **Qué funciona** · **Problemas** (severidad: alta/media/baja + captura/archivo:línea) · **Propuesta concreta** (qué componente/clase cambiar). Luego implementa las de severidad alta y media, vuelve a capturar y compara antes/después.
