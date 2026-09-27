#!/usr/bin/env bash
# Prueba E2E de la API: flujo completo de operación de la farmacia.
# Requiere la API corriendo (make backend) con datos seed. Uso: scripts/e2e.sh [base_url]
# Multi-sucursal: BRANCH=<id> scripts/e2e.sh http://localhost:8081/api  (envía X-Branch-ID en cada request).
set -euo pipefail

BASE="${1:-http://localhost:8080/api}"
PASS=0
FAIL=0
green() { printf '\033[32m✔ %s\033[0m\n' "$1"; PASS=$((PASS + 1)); }
red() { printf '\033[31m✘ %s\033[0m\n' "$1"; FAIL=$((FAIL + 1)); }

# req METHOD PATH TOKEN [BODY] -> imprime body; guarda status en $CODE
req() {
  local out
  out=$(curl -s -w '\n%{http_code}' -X "$1" "$BASE$2" -H "Authorization: Bearer ${3:-}" -H 'Content-Type: application/json' \
    ${BRANCH:+-H "X-Branch-ID: $BRANCH"} ${4:+-d "$4"})
  CODE=$(tail -n1 <<<"$out")
  BODY=$(sed '$d' <<<"$out")
}
expect() { # expect DESCRIPCION CODIGO_ESPERADO
  if [[ "$CODE" == "$2" ]]; then green "$1 ($CODE)"; else red "$1: esperado $2, obtenido $CODE → $BODY"; fi
}

login() { curl -s -X POST "$BASE/auth/login" -d "{\"username\":\"$1\",\"password\":\"neofarma123\"}" | jq -r .token; }
ADMIN=$(login admin); QF=$(login quimico); BOD=$(login bodega); CAJ2=$(login cajero2)
[[ "$ADMIN" != "null" && -n "$ADMIN" ]] && green "login de usuarios demo" || { red "login"; exit 1; }

SUFFIX=$(date +%s)
EXP=$(date -d '+1 year' +%F)
TODAY=$(date +%F)

# 1. Proveedor
req POST /suppliers "$BOD" "{\"rut\":\"11.111.111-1\",\"business_name\":\"Proveedor E2E $SUFFIX\",\"payment_terms_days\":30}"
if [[ "$CODE" == 409 ]]; then
  req GET "/suppliers?q=11111111-1" "$BOD"; SUP=$(jq -r '.data[0].id' <<<"$BODY"); green "proveedor ya existía (reutilizado)"
else
  expect "crear proveedor" 201; SUP=$(jq -r .id <<<"$BODY")
fi

# 2. Producto
req POST /products "$BOD" "{\"sku\":\"E2E-$SUFFIX\",\"barcode\":\"999$SUFFIX\",\"name\":\"Producto E2E $SUFFIX\",\"sale_condition\":\"directa\",\"price\":2500,\"cost\":1000,\"min_stock\":2,\"is_bioequivalent\":false}"
expect "crear producto" 201; PROD=$(jq -r .id <<<"$BODY")

# 3. Ingreso de mercadería
req POST /purchases "$BOD" "{\"supplier_id\":$SUP,\"document_type\":\"factura\",\"document_number\":\"E2E-$SUFFIX\",\"document_date\":\"$TODAY\",\"items\":[{\"product_id\":$PROD,\"lot_number\":\"LE2E\",\"expiry_date\":\"$EXP\",\"quantity\":10,\"unit_cost\":1000}]}"
expect "ingreso de mercadería" 201
[[ $(jq .total_amount <<<"$BODY") == 11900 ]] && green "total compra con IVA = 11.900" || red "total compra: $(jq .total_amount <<<"$BODY")"
req GET "/products/lookup?code=999$SUFFIX" "$BOD"
[[ $(jq .stock_sellable <<<"$BODY") == 10 ]] && green "stock tras ingreso = 10" || red "stock tras ingreso: $BODY"

# 4. Caja (cajero2 usa Caja 2)
req GET /cash/sessions/current "$CAJ2"
SESSION=$(jq -r '.session.id // empty' <<<"$BODY")
if [[ -z "$SESSION" ]]; then
  req GET /cash/registers "$CAJ2"; REG=$(jq -r '[.data[] | select(.open_session_id == null)][0].id' <<<"$BODY")
  req POST /cash/sessions "$CAJ2" "{\"register_id\":$REG,\"opening_amount\":30000}"
  expect "abrir caja" 201; SESSION=$(jq -r .id <<<"$BODY")
else
  green "cajero2 ya tenía caja abierta (#$SESSION)"
fi
req GET /cash/registers "$CAJ2"; ANY_REG=$(jq -r '.data[0].id' <<<"$BODY")
req POST /cash/sessions "$CAJ2" "{\"register_id\":$ANY_REG,\"opening_amount\":0}"
expect "no se puede abrir una segunda caja" 409

# 5. Ventas
req POST /sales "$CAJ2" "{\"payment_method\":\"efectivo\",\"amount_paid\":10000,\"discount\":0,\"items\":[{\"product_id\":$PROD,\"quantity\":3}]}"
expect "venta en efectivo" 201; SALE=$(jq -r .id <<<"$BODY")
[[ $(jq .change_amount <<<"$BODY") == 2500 ]] && green "vuelto correcto = 2.500" || red "vuelto: $(jq .change_amount <<<"$BODY")"
req POST /sales "$CAJ2" "{\"payment_method\":\"debito\",\"amount_paid\":0,\"discount\":0,\"items\":[{\"product_id\":$PROD,\"quantity\":50}]}"
expect "venta sin stock suficiente" 422
req POST /sales "$CAJ2" "{\"payment_method\":\"efectivo\",\"amount_paid\":100,\"discount\":0,\"items\":[{\"product_id\":$PROD,\"quantity\":1}]}"
expect "pago insuficiente" 422

# 6. Anulación (solo químico)
req POST "/sales/$SALE/void" "$CAJ2" '{"reason":"prueba e2e"}'
expect "cajero no puede anular" 403
req POST "/sales/$SALE/void" "$QF" '{"reason":"prueba e2e"}'
expect "químico anula venta" 200
req GET "/products/$PROD" "$QF"
[[ $(jq .stock_sellable <<<"$BODY") == 10 ]] && green "stock restaurado tras anulación = 10" || red "stock tras anulación: $(jq .stock_sellable <<<"$BODY")"

# 7. Ajuste por merma
LOT=$(jq -r '.lots[0].id' <<<"$BODY")
req POST /inventory/adjustments "$BOD" "{\"lot_id\":$LOT,\"type\":\"merma\",\"quantity\":1,\"notes\":\"envase dañado\"}"
expect "merma de inventario" 204

# 8. Movimiento y cierre de caja
req POST "/cash/sessions/$SESSION/movements" "$CAJ2" '{"type":"ingreso","amount":5000,"reason":"sencillo"}'
expect "ingreso de efectivo" 201
EXPECTED=$(jq .summary.expected_cash <<<"$BODY")
req POST "/cash/sessions/$SESSION/close" "$CAJ2" "{\"counted_cash\":$EXPECTED,\"notes\":\"e2e\"}"
expect "cierre de caja" 200
[[ $(jq .difference <<<"$BODY") == 0 ]] && green "caja cuadrada (diferencia 0)" || red "diferencia: $(jq .difference <<<"$BODY")"

# 9. Reportes
req GET "/reports/sales?from=$TODAY&to=$TODAY" "$QF"; expect "reporte de ventas" 200
req GET /reports/dashboard "$ADMIN"; expect "dashboard" 200

echo
echo "Resultado: $PASS OK, $FAIL fallidas"
[[ $FAIL -eq 0 ]]
