// Package integration contiene pruebas de integración contra una BD real (TEST_DATABASE_URL).
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/cash"
	"github.com/neofarma/backend/internal/catalog"
	"github.com/neofarma/backend/internal/config"
	"github.com/neofarma/backend/internal/inventory"
	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
	"github.com/neofarma/backend/internal/platform/money"
	"github.com/neofarma/backend/internal/purchases"
	"github.com/neofarma/backend/internal/reports"
	"github.com/neofarma/backend/internal/sales"
	"github.com/neofarma/backend/internal/server"
	"github.com/neofarma/backend/internal/suppliers"
	"github.com/neofarma/backend/internal/users"
)

var pool *pgxpool.Pool

func TestMain(m *testing.M) {
	_, _ = config.Load() // carga .env si existe
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		fmt.Println("TEST_DATABASE_URL no definido: se omiten pruebas de integración")
		os.Exit(0)
	}
	ctx := context.Background()
	var err error
	pool, err = db.Connect(ctx, url)
	if err != nil {
		fmt.Println("no se pudo conectar a la BD de pruebas:", err)
		os.Exit(1)
	}
	if err := db.Migrate(pool); err != nil {
		fmt.Println("migración falló:", err)
		os.Exit(1)
	}
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

// fixture crea un escenario limpio: usuarios, caja, proveedor y productos.
type fixture struct {
	t        *testing.T
	ctx      context.Context
	admin    auth.Principal
	quimico  auth.Principal
	cajero   auth.Principal
	bodega   auth.Principal
	branch   int64 // sucursal principal del escenario
	regID    int64
	supplier int64
	paracet  catalog.ProductDetail // venta directa, $1.000
	clonaz   catalog.ProductDetail // receta cheque, $5.000
	cash     *cash.Service
	sales    *sales.Service
	purch    *purchases.Service
	inv      *inventory.Service
	docSeq   int
}

func setup(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	_, err := pool.Exec(ctx, `TRUNCATE stock_movements, transfer_items, transfers, sale_item_lots, sale_items, sales, cash_movements, cash_sessions,
		cash_registers, purchase_items, product_lots, purchases, products, suppliers, categories, user_branches, users, branches RESTART IDENTITY CASCADE`)
	must(t, err)

	f := &fixture{t: t, ctx: ctx, cash: cash.NewService(pool), sales: sales.NewService(pool), purch: purchases.NewService(pool), inv: inventory.NewService(pool)}
	must(t, pool.QueryRow(ctx, `INSERT INTO branches (code, name) VALUES ('T1', 'Sucursal Test') RETURNING id`).Scan(&f.branch))
	us := users.NewService(pool, nil)
	mk := func(username, role string) auth.Principal {
		u, err := us.Create(ctx, users.CreateInput{Username: username, FullName: "Usuario " + username, Password: "password123", Role: role, BranchIDs: []int64{f.branch}})
		must(t, err)
		return auth.Principal{UserID: u.ID, Username: u.Username, FullName: u.FullName, Role: u.Role}
	}
	f.admin, f.quimico, f.cajero, f.bodega = mk("admin", "admin"), mk("quimico", "quimico"), mk("cajero", "cajero"), mk("bodega", "bodega")
	must(t, pool.QueryRow(ctx, `INSERT INTO cash_registers (branch_id, name) VALUES ($1, 'Caja 1') RETURNING id`, f.branch).Scan(&f.regID))

	sp, err := suppliers.NewService(pool).Create(ctx, suppliers.Input{RUT: "76.086.428-5", BusinessName: "Droguería Test", PaymentTermsDays: 30})
	must(t, err)
	f.supplier = sp.ID

	cat := catalog.NewService(pool)
	f.paracet, err = cat.CreateProduct(ctx, nil, catalog.ProductInput{SKU: "T-1", Name: "Paracetamol 500", SaleCondition: "directa", Price: 1000, MinStock: 5})
	must(t, err)
	f.clonaz, err = cat.CreateProduct(ctx, nil, catalog.ProductInput{SKU: "T-2", Name: "Clonazepam 2mg", SaleCondition: "receta_cheque", Price: 5000})
	must(t, err)
	return f
}

func (f *fixture) receive(productID int64, lot string, expiry time.Time, qty int, cost int64) {
	f.t.Helper()
	f.docSeq++
	_, err := f.purch.Create(f.ctx, f.branch, f.bodega.UserID, purchases.CreateInput{
		SupplierID: f.supplier, DocumentType: "factura", DocumentNumber: fmt.Sprint(1000 + f.docSeq),
		DocumentDate: time.Now().Format(time.DateOnly),
		Items:        []purchases.ItemInput{{ProductID: productID, LotNumber: &lot, ExpiryDate: expiry.Format(time.DateOnly), Quantity: qty, UnitCost: cost}},
	})
	must(f.t, err)
}

func (f *fixture) stock(productID int64) int {
	f.t.Helper()
	var n int
	must(f.t, pool.QueryRow(f.ctx, `SELECT coalesce(sum(qty_available) FILTER (WHERE expiry_date >= current_date), 0)::int FROM product_lots WHERE product_id = $1 AND branch_id = $2`, productID, f.branch).Scan(&n))
	return n
}

func (f *fixture) lotQty(lot string) int {
	f.t.Helper()
	var n int
	must(f.t, pool.QueryRow(f.ctx, `SELECT qty_available FROM product_lots WHERE lot_number = $1`, lot).Scan(&n))
	return n
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	e, ok := apperr.As(err)
	if !ok || e.Code != code {
		t.Fatalf("se esperaba error %q, se obtuvo %v", code, err)
	}
}

// assertLedger verifica que el stock de cada lote coincida con la suma de sus movimientos.
func assertLedger(t *testing.T) {
	t.Helper()
	var bad int
	must(t, pool.QueryRow(context.Background(), `
		SELECT count(*) FROM product_lots l
		WHERE l.qty_available <> (SELECT coalesce(sum(quantity), 0) FROM stock_movements WHERE lot_id = l.id)`).Scan(&bad))
	if bad != 0 {
		t.Fatalf("%d lotes con stock inconsistente respecto al ledger", bad)
	}
}

func TestSaleRequiresOpenSession(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "A1", time.Now().AddDate(1, 0, 0), 10, 400)
	_, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
	wantCode(t, err, "no_open_session")
}

func TestFullSaleFlowFEFOVoidAndClose(t *testing.T) {
	f := setup(t)
	// Dos lotes: el que vence antes debe consumirse primero aunque se haya recibido después.
	f.receive(f.paracet.ID, "LATE", time.Now().AddDate(2, 0, 0), 10, 400)
	f.receive(f.paracet.ID, "EARLY", time.Now().AddDate(0, 3, 0), 3, 420)
	if got := f.stock(f.paracet.ID); got != 13 {
		t.Fatalf("stock inicial = %d, want 13", got)
	}

	sess, err := f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID, OpeningAmount: 20000})
	must(t, err)

	// Venta en efectivo de 5 unidades con descuento: 3 del lote EARLY + 2 del lote LATE.
	sale, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{
		PaymentMethod: "efectivo", AmountPaid: 10000, Discount: 500,
		Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 2}, {ProductID: f.paracet.ID, Quantity: 3}},
	})
	must(t, err)
	if sale.Subtotal != 5000 || sale.Total != 4500 || sale.ChangeAmount != 5500 {
		t.Fatalf("totales inesperados: subtotal=%d total=%d vuelto=%d", sale.Subtotal, sale.Total, sale.ChangeAmount)
	}
	if sale.NetAmount+sale.TaxAmount != sale.Total || sale.NetAmount != 3782 {
		t.Fatalf("neto/IVA inesperados: %d + %d", sale.NetAmount, sale.TaxAmount)
	}
	if len(sale.Items) != 1 || sale.Items[0].Quantity != 5 {
		t.Fatalf("las líneas del mismo producto deben agruparse: %+v", sale.Items)
	}
	if f.lotQty("EARLY") != 0 || f.lotQty("LATE") != 8 {
		t.Fatalf("FEFO incorrecto: EARLY=%d LATE=%d", f.lotQty("EARLY"), f.lotQty("LATE"))
	}

	// Stock insuficiente.
	_, err = f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 9}}})
	wantCode(t, err, "insufficient_stock")

	// Pago insuficiente en efectivo.
	_, err = f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "efectivo", AmountPaid: 500, Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
	wantCode(t, err, "insufficient_payment")

	// Venta con débito (no afecta el efectivo esperado).
	_, err = f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
	must(t, err)

	// Egreso de caja y validación de exceso.
	_, err = f.cash.AddMovement(f.ctx, f.cajero, f.branch, sess.ID, cash.MovementInput{Type: "egreso", Amount: 2000, Reason: "Compra de insumos"})
	must(t, err)
	_, err = f.cash.AddMovement(f.ctx, f.cajero, f.branch, sess.ID, cash.MovementInput{Type: "egreso", Amount: 999999, Reason: "Demasiado"})
	wantCode(t, err, "insufficient_cash")

	// Anulación: el stock vuelve a los lotes originales.
	voided, err := f.sales.Void(f.ctx, f.quimico, f.branch, sale.ID, sales.VoidInput{Reason: "Error de digitación"})
	must(t, err)
	if voided.Status != "anulada" || f.lotQty("EARLY") != 3 || f.lotQty("LATE") != 9 {
		t.Fatalf("anulación no restauró stock: status=%s EARLY=%d LATE=%d", voided.Status, f.lotQty("EARLY"), f.lotQty("LATE"))
	}
	_, err = f.sales.Void(f.ctx, f.quimico, f.branch, sale.ID, sales.VoidInput{Reason: "Otra vez"})
	wantCode(t, err, "already_voided")

	// Cierre: esperado = 20.000 apertura + 0 efectivo (venta anulada) - 2.000 egreso = 18.000.
	closed, err := f.cash.Close(f.ctx, f.cajero, f.branch, sess.ID, cash.CloseInput{CountedCash: 17000})
	must(t, err)
	if *closed.ExpectedCash != 18000 || *closed.Difference != -1000 {
		t.Fatalf("cierre: esperado=%d diferencia=%d", *closed.ExpectedCash, *closed.Difference)
	}
	if closed.Summary.SalesCount != 1 || closed.Summary.VoidedCount != 1 || closed.Summary.ByMethod["debito"] != 1000 {
		t.Fatalf("resumen inesperado: %+v", closed.Summary)
	}

	// Con la caja cerrada: no se puede vender, ni anular, ni volver a cerrar.
	_, err = f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
	wantCode(t, err, "no_open_session")
	_, err = f.cash.Close(f.ctx, f.cajero, f.branch, sess.ID, cash.CloseInput{CountedCash: 0})
	wantCode(t, err, "session_closed")
	assertLedger(t)
}

func TestPrescriptionRequired(t *testing.T) {
	f := setup(t)
	f.receive(f.clonaz.ID, "RX1", time.Now().AddDate(1, 0, 0), 5, 2000)
	_, err := f.cash.Open(f.ctx, f.branch, f.quimico.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)
	in := sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.clonaz.ID, Quantity: 1}}}
	_, err = f.sales.Create(f.ctx, f.quimico, f.branch, in)
	wantCode(t, err, "prescription_required")

	rx, dr := "RC-123", "Dra. Pérez"
	in.PrescriptionNumber, in.PrescriberName = &rx, &dr
	sale, err := f.sales.Create(f.ctx, f.quimico, f.branch, in)
	must(t, err)
	if sale.PrescriptionNumber == nil || *sale.PrescriptionNumber != rx {
		t.Fatal("no se guardó el número de receta")
	}
}

func TestExpiredLotsAreNotSold(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "OLD", time.Now().AddDate(0, 1, 0), 5, 400)
	_, err := pool.Exec(f.ctx, `UPDATE product_lots SET expiry_date = current_date - 1 WHERE lot_number = 'OLD'`)
	must(t, err)
	if f.stock(f.paracet.ID) != 0 {
		t.Fatal("los lotes vencidos no deben contar como stock vendible")
	}
	_, err = f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)
	_, err = f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
	wantCode(t, err, "insufficient_stock")
}

func TestPurchaseValidations(t *testing.T) {
	f := setup(t)
	in := purchases.CreateInput{
		SupplierID: f.supplier, DocumentType: "factura", DocumentNumber: "F-1", DocumentDate: time.Now().Format(time.DateOnly),
		Items: []purchases.ItemInput{{ProductID: f.paracet.ID, LotNumber: strp("x"), ExpiryDate: time.Now().AddDate(1, 0, 0).Format(time.DateOnly), Quantity: 10, UnitCost: 1000}},
	}
	p, err := f.purch.Create(f.ctx, f.branch, f.bodega.UserID, in)
	must(t, err)
	if p.NetAmount != 10000 || p.TaxAmount != 1900 || p.TotalAmount != 11900 {
		t.Fatalf("totales de compra: %d %d %d", p.NetAmount, p.TaxAmount, p.TotalAmount)
	}
	_, err = f.purch.Create(f.ctx, f.branch, f.bodega.UserID, in)
	wantCode(t, err, "conflict")

	in.DocumentNumber = "F-2"
	in.Items[0].ExpiryDate = time.Now().AddDate(0, 0, -1).Format(time.DateOnly)
	_, err = f.purch.Create(f.ctx, f.branch, f.bodega.UserID, in)
	wantCode(t, err, "expired_lot")
}

func TestAdjustments(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "ADJ", time.Now().AddDate(1, 0, 0), 5, 400)
	var lotID int64
	must(t, pool.QueryRow(f.ctx, `SELECT id FROM product_lots WHERE lot_number = 'ADJ'`).Scan(&lotID))

	err := f.inv.Adjust(f.ctx, f.branch, f.bodega.UserID, inventory.AdjustmentInput{LotID: lotID, Type: "merma", Quantity: 6, Notes: "rotura"})
	wantCode(t, err, "insufficient_stock")
	must(t, f.inv.Adjust(f.ctx, f.branch, f.bodega.UserID, inventory.AdjustmentInput{LotID: lotID, Type: "merma", Quantity: 2, Notes: "rotura"}))
	must(t, f.inv.Adjust(f.ctx, f.branch, f.bodega.UserID, inventory.AdjustmentInput{LotID: lotID, Type: "ajuste_positivo", Quantity: 4, Notes: "conteo"}))
	if got := f.lotQty("ADJ"); got != 7 {
		t.Fatalf("lote tras ajustes = %d, want 7", got)
	}
	assertLedger(t)
}

// TestConcurrentSalesNoOversell lanza ventas simultáneas sobre un stock limitado: nunca debe venderse más de lo disponible.
func TestConcurrentSalesNoOversell(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "C1", time.Now().AddDate(0, 6, 0), 3, 400)
	f.receive(f.paracet.ID, "C2", time.Now().AddDate(1, 0, 0), 4, 400)

	const n = 12
	us := users.NewService(pool, nil)
	var sellers []auth.Principal
	for i := range n {
		u, err := us.Create(f.ctx, users.CreateInput{Username: fmt.Sprintf("caj%d", i), FullName: "Cajero concurrente", Password: "password123", Role: "cajero", BranchIDs: []int64{f.branch}})
		must(t, err)
		var reg int64
		must(t, pool.QueryRow(f.ctx, `INSERT INTO cash_registers (branch_id, name) VALUES ($1, $2) RETURNING id`, f.branch, fmt.Sprintf("C%d", i)).Scan(&reg))
		_, err = f.cash.Open(f.ctx, f.branch, u.ID, cash.OpenInput{RegisterID: reg})
		must(t, err)
		sellers = append(sellers, auth.Principal{UserID: u.ID, Role: "cajero"})
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, rejected := 0, 0
	for _, s := range sellers {
		wg.Add(1)
		go func(p auth.Principal) {
			defer wg.Done()
			_, err := f.sales.Create(f.ctx, p, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				ok++
			} else if e, isApp := apperr.As(err); isApp && e.Code == "insufficient_stock" {
				rejected++
			} else {
				t.Errorf("error inesperado: %v", err)
			}
		}(s)
	}
	wg.Wait()
	if ok != 7 || rejected != n-7 {
		t.Fatalf("ventas exitosas=%d rechazadas=%d; se esperaban 7 y %d", ok, rejected, n-7)
	}
	if f.stock(f.paracet.ID) != 0 {
		t.Fatalf("stock final = %d, want 0", f.stock(f.paracet.ID))
	}
	assertLedger(t)
}

// ---- Pruebas HTTP: autenticación, permisos por rol y formato de errores ----

func TestHTTPAuthAndRoles(t *testing.T) {
	f := setup(t)
	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})

	call := func(method, path, token string, body any) (int, map[string]any) {
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		req := httptest.NewRequest(method, path, &buf)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	login := func(user string) string {
		code, out := call("POST", "/api/auth/login", "", map[string]string{"username": user, "password": "password123"})
		if code != http.StatusOK {
			t.Fatalf("login %s: %d %v", user, code, out)
		}
		return out["token"].(string)
	}

	if code, _ := call("POST", "/api/auth/login", "", map[string]string{"username": "admin", "password": "mala"}); code != http.StatusUnauthorized {
		t.Fatalf("login inválido = %d, want 401", code)
	}
	if code, _ := call("GET", "/api/products", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("sin token = %d, want 401", code)
	}

	cajero, bodega, quimico := login("cajero"), login("bodega"), login("quimico")
	newProduct := map[string]any{"sku": "H-1", "name": "Producto HTTP", "sale_condition": "directa", "price": 990, "cost": 400, "min_stock": 1, "is_bioequivalent": false}

	tests := []struct {
		name   string
		method string
		path   string
		token  string
		body   any
		want   int
	}{
		{"cajero lista productos", "GET", "/api/products", cajero, nil, 200},
		{"cajero no crea productos", "POST", "/api/products", cajero, newProduct, 403},
		{"bodega crea productos", "POST", "/api/products", bodega, newProduct, 201},
		{"SKU duplicado", "POST", "/api/products", bodega, newProduct, 409},
		{"bodega no vende", "GET", "/api/sales", bodega, nil, 403},
		{"cajero no ve usuarios", "GET", "/api/users", cajero, nil, 403},
		{"cajero no anula ventas", "POST", "/api/sales/1/void", cajero, map[string]string{"reason": "prueba"}, 403},
		{"quimico ve compras", "GET", "/api/purchases", quimico, nil, 200},
		{"proveedor con RUT inválido", "POST", "/api/suppliers", bodega, map[string]any{"rut": "12.345.678-0", "business_name": "X SpA"}, 422},
		{"producto inexistente", "GET", "/api/products/999999", bodega, nil, 404},
		{"id inválido", "GET", "/api/products/abc", bodega, nil, 400},
		{"cajero no ve la ficha de producto", "GET", "/api/products/1", cajero, nil, 403},
		{"cajero no ve lotes", "GET", "/api/inventory/lots", cajero, nil, 403},
		{"cajero no ve movimientos", "GET", "/api/inventory/movements", cajero, nil, 403},
		{"cajero busca por código en el POS", "GET", "/api/products/lookup?code=NO-EXISTE", cajero, nil, 404},
		{"bodega ve lotes", "GET", "/api/inventory/lots", bodega, nil, 200},
		{"reporte sin fechas", "GET", "/api/reports/sales", quimico, nil, 400},
		{"dashboard", "GET", "/api/reports/dashboard", cajero, nil, 200},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			code, out := call(tc.method, tc.path, tc.token, tc.body)
			if code != tc.want {
				t.Fatalf("%s %s = %d, want %d (%v)", tc.method, tc.path, code, tc.want, out)
			}
			if code >= 400 {
				if e, ok := out["error"].(map[string]any); !ok || e["code"] == "" || e["message"] == "" {
					t.Fatalf("formato de error inválido: %v", out)
				}
			}
		})
	}

	// Campo desconocido en el JSON debe rechazarse.
	if code, _ := call("POST", "/api/cash/sessions", cajero, map[string]any{"register_id": f.regID, "hack": 1}); code != http.StatusBadRequest {
		t.Fatalf("campo desconocido = %d, want 400", code)
	}
}

func TestProductRegulatoryFields(t *testing.T) {
	f := setup(t)
	cat := catalog.NewService(pool)
	form, isp := "comprimido_recubierto", " f-12345/20 "
	p, err := cat.CreateProduct(f.ctx, nil, catalog.ProductInput{
		SKU: "R-1", Name: "Losartán 50 mg", SaleCondition: "receta_simple", Price: 1990,
		IsGeneric: true, IsBioequivalent: true, DosageForm: &form, ISPRegistry: &isp,
	})
	must(t, err)
	if !p.IsGeneric || p.DosageForm == nil || *p.DosageForm != form || p.ISPRegistry == nil || *p.ISPRegistry != "F-12345/20" {
		t.Fatalf("campos regulatorios no guardados/normalizados: generic=%v form=%v isp=%v", p.IsGeneric, p.DosageForm, p.ISPRegistry)
	}

	// Búsqueda por registro ISP (sin importar mayúsculas).
	list, _, err := cat.ListProducts(f.ctx, nil, catalog.ProductFilter{Query: "f-12345/20"}, httpx.Page{Page: 1, PageSize: 10})
	must(t, err)
	if len(list) != 1 || list[0].ID != p.ID {
		t.Fatalf("búsqueda por registro ISP devolvió %d resultados", len(list))
	}

	// Valores inválidos se rechazan con detalle por campo.
	badForm, badISP := "tableta_magica", "12345"
	_, err = cat.CreateProduct(f.ctx, nil, catalog.ProductInput{SKU: "R-2", Name: "Inválido", SaleCondition: "directa", DosageForm: &badForm, ISPRegistry: &badISP})
	e, ok := apperr.As(err)
	if !ok || e.Code != "validation_error" {
		t.Fatalf("se esperaba validation_error, se obtuvo %v", err)
	}
	fields := e.Details["fields"].(map[string]any)
	if fields["dosage_form"] == nil || fields["isp_registry"] == nil {
		t.Fatalf("faltan campos en el detalle del error: %v", fields)
	}

	// Vaciar los campos opcionales al editar.
	empty := ""
	p2, err := cat.UpdateProduct(f.ctx, nil, p.ID, catalog.ProductInput{SKU: "R-1", Name: "Losartán 50 mg", SaleCondition: "receta_simple", Price: 1990, DosageForm: &empty, ISPRegistry: &empty})
	must(t, err)
	if p2.IsGeneric || p2.DosageForm != nil || p2.ISPRegistry != nil {
		t.Fatal("al editar, los campos vacíos deben quedar en NULL y genérico en false")
	}
}

func TestProductIngredients(t *testing.T) {
	f := setup(t)
	cat := catalog.NewService(pool)
	dose := func(v float64) *float64 { return &v }
	unit := func(u string) *string { return &u }

	p, err := cat.CreateProduct(f.ctx, nil, catalog.ProductInput{
		SKU: "C-1", Name: "Paracetamol + Cafeína", SaleCondition: "directa", Price: 1990,
		Ingredients: []catalog.IngredientInput{
			{Name: "  Paracetamol ", Dose: dose(325), Unit: unit("mg")},
			{Name: "Cafeína", Dose: dose(32.5), Unit: unit("mg")},
			{Name: "Excipiente sin dosis", Unit: unit("mg")}, // unidad sin dosis se descarta
		},
	})
	must(t, err)
	if len(p.Ingredients) != 3 || p.Ingredients[0].Name != "Paracetamol" || *p.Ingredients[1].Dose != 32.5 || p.Ingredients[2].Unit != nil {
		t.Fatalf("composición inesperada: %+v", p.Ingredients)
	}
	if *p.ActiveIngredient != "Paracetamol + Cafeína + Excipiente sin dosis" || *p.Concentration != "325 mg + 32,5 mg" {
		t.Fatalf("resumen inesperado: %q / %q", *p.ActiveIngredient, *p.Concentration)
	}

	// La búsqueda por cualquier principio activo encuentra el producto (vía resumen).
	list, _, err := cat.ListProducts(f.ctx, nil, catalog.ProductFilter{Query: "cafeína"}, httpx.Page{Page: 1, PageSize: 10})
	must(t, err)
	if len(list) != 1 || len(list[0].Ingredients) != 3 {
		t.Fatalf("búsqueda por principio activo: %d resultados", len(list))
	}

	// Errores por fila: nombre repetido y unidad inválida.
	_, err = cat.CreateProduct(f.ctx, nil, catalog.ProductInput{SKU: "C-2", Name: "Inválido", SaleCondition: "directa",
		Ingredients: []catalog.IngredientInput{{Name: "Ibuprofeno", Dose: dose(400), Unit: unit("kg")}, {Name: "ibuprofeno"}}})
	e, ok := apperr.As(err)
	if !ok || e.Code != "validation_error" {
		t.Fatalf("se esperaba validation_error, se obtuvo %v", err)
	}
	fields := e.Details["fields"].(map[string]any)
	if fields["ingredients[0].unit"] != "oneof" || fields["ingredients[1].name"] != "unique" {
		t.Fatalf("detalle de errores inesperado: %v", fields)
	}

	// Editar reemplaza la composición; sin principios activos el resumen queda vacío.
	p2, err := cat.UpdateProduct(f.ctx, nil, p.ID, catalog.ProductInput{SKU: "C-1", Name: "Paracetamol", SaleCondition: "directa", Price: 990,
		Ingredients: []catalog.IngredientInput{{Name: "Paracetamol", Dose: dose(500), Unit: unit("mg")}}})
	must(t, err)
	if len(p2.Ingredients) != 1 || *p2.Concentration != "500 mg" {
		t.Fatalf("edición no reemplazó la composición: %+v", p2.Ingredients)
	}
	p3, err := cat.UpdateProduct(f.ctx, nil, p.ID, catalog.ProductInput{SKU: "C-1", Name: "Paracetamol", SaleCondition: "directa", Price: 990})
	must(t, err)
	if len(p3.Ingredients) != 0 || p3.ActiveIngredient != nil || p3.Concentration != nil {
		t.Fatal("sin principios activos el resumen debe quedar en NULL")
	}
}

func strp(s string) *string { return &s }

// TestLotOptional: un ingreso sin número de lote se guarda con lote NULL y se puede vender por FEFO.
func TestLotOptional(t *testing.T) {
	f := setup(t)
	p, err := f.purch.Create(f.ctx, f.branch, f.bodega.UserID, purchases.CreateInput{
		SupplierID: f.supplier, DocumentType: "factura", DocumentNumber: "SL-1", DocumentDate: time.Now().Format(time.DateOnly),
		Items: []purchases.ItemInput{
			{ProductID: f.paracet.ID, ExpiryDate: time.Now().AddDate(0, 6, 0).Format(time.DateOnly), Quantity: 5, UnitCost: 400},
			{ProductID: f.paracet.ID, LotNumber: strp("   "), ExpiryDate: time.Now().AddDate(1, 0, 0).Format(time.DateOnly), Quantity: 5, UnitCost: 400},
			{ProductID: f.paracet.ID, LotNumber: strp(" ab-12 "), ExpiryDate: time.Now().AddDate(2, 0, 0).Format(time.DateOnly), Quantity: 5, UnitCost: 400},
		},
	})
	must(t, err)
	if p.Items[0].LotNumber != nil || p.Items[1].LotNumber != nil || p.Items[2].LotNumber == nil || *p.Items[2].LotNumber != "AB-12" {
		t.Fatalf("lotes inesperados: %v %v %v", p.Items[0].LotNumber, p.Items[1].LotNumber, p.Items[2].LotNumber)
	}

	_, err = f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)
	sale, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 7}}})
	must(t, err)
	if sale.Items[0].Lots != "S/L (5), S/L (2)" {
		t.Fatalf("detalle de lotes consumidos: %q", sale.Items[0].Lots)
	}
	detail, err := catalog.NewService(pool).GetProduct(f.ctx, &f.branch, f.paracet.ID)
	must(t, err)
	if len(detail.Lots) != 2 || detail.Lots[0].LotNumber != nil {
		t.Fatalf("lotes restantes inesperados: %+v", detail.Lots)
	}
	assertLedger(t)
}

// TestCashHistoryAdminOnly: el historial de cierres es exclusivo del administrador; cada usuario ve solo su sesión.
func TestCashHistoryAdminOnly(t *testing.T) {
	f := setup(t)
	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	token := func(p auth.Principal) string {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		return tok
	}
	get := func(path string, p auth.Principal) int {
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+token(p))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	sess, err := f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID, OpeningAmount: 1000})
	must(t, err)
	path := fmt.Sprintf("/api/cash/sessions/%d", sess.ID)

	cases := []struct {
		name string
		path string
		user auth.Principal
		want int
	}{
		{"admin ve el historial", "/api/cash/sessions", f.admin, 200},
		{"cajero no ve el historial", "/api/cash/sessions", f.cajero, 403},
		{"químico no ve el historial", "/api/cash/sessions", f.quimico, 403},
		{"cajero ve su propia sesión", path, f.cajero, 200},
		{"químico no ve la sesión de otro", path, f.quimico, 403},
		{"admin ve cualquier sesión", path, f.admin, 200},
		{"cajero ve su caja actual", "/api/cash/sessions/current", f.cajero, 200},
	}
	for _, c := range cases {
		if got := get(c.path, c.user); got != c.want {
			t.Errorf("%s: %s = %d, want %d", c.name, c.path, got, c.want)
		}
	}
}

// TestSalesScopedToCashier: cada cajero ve solo sus ventas (lista y detalle); químico y admin ven todas.
func TestSalesScopedToCashier(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "V1", time.Now().AddDate(1, 0, 0), 20, 400)
	u2, err := users.NewService(pool, nil).Create(f.ctx, users.CreateInput{Username: "cajero2", FullName: "Cajero Dos", Password: "password123", Role: "cajero", BranchIDs: []int64{f.branch}})
	must(t, err)
	cajero2 := auth.Principal{UserID: u2.ID, Username: u2.Username, Role: u2.Role}
	var reg2 int64
	must(t, pool.QueryRow(f.ctx, `INSERT INTO cash_registers (branch_id, name) VALUES ($1, 'Caja 2') RETURNING id`, f.branch).Scan(&reg2))
	_, err = f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)
	_, err = f.cash.Open(f.ctx, f.branch, cajero2.UserID, cash.OpenInput{RegisterID: reg2})
	must(t, err)
	sell := func(p auth.Principal) int64 {
		s, err := f.sales.Create(f.ctx, p, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 1}}})
		must(t, err)
		return s.ID
	}
	mine := sell(f.cajero)
	sell(f.cajero)
	other := sell(cajero2)

	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	get := func(path string, p auth.Principal) (int, map[string]any) {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	count := func(p auth.Principal, query string) int {
		code, out := get("/api/sales"+query, p)
		if code != 200 {
			t.Fatalf("GET /api/sales%s = %d", query, code)
		}
		return int(out["total"].(float64))
	}

	if n := count(f.cajero, ""); n != 2 {
		t.Errorf("cajero ve %d ventas, want 2 (solo las suyas)", n)
	}
	if n := count(cajero2, ""); n != 1 {
		t.Errorf("cajero2 ve %d ventas, want 1", n)
	}
	if n := count(cajero2, "?q="+fmt.Sprint(mine)); n != 0 {
		t.Errorf("cajero2 encontró una venta ajena buscando por número")
	}
	if n := count(f.quimico, ""); n != 3 {
		t.Errorf("químico ve %d ventas, want 3", n)
	}
	if n := count(f.admin, ""); n != 3 {
		t.Errorf("admin ve %d ventas, want 3", n)
	}
	if code, _ := get(fmt.Sprintf("/api/sales/%d", other), f.cajero); code != 404 {
		t.Errorf("cajero abrió una venta ajena: %d, want 404", code)
	}
	if code, _ := get(fmt.Sprintf("/api/sales/%d", mine), f.cajero); code != 200 {
		t.Errorf("cajero no pudo abrir su propia venta: %d", code)
	}
	if code, _ := get(fmt.Sprintf("/api/sales/%d", other), f.quimico); code != 200 {
		t.Errorf("químico no pudo abrir una venta: %d", code)
	}
}

// TestCashierDashboardOwnOnly: el dashboard del cajero solo refleja sus ventas y no expone datos de la farmacia.
func TestCashierDashboardOwnOnly(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "D1", time.Now().AddDate(1, 0, 0), 20, 400)
	_, err := f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)
	var reg2 int64
	must(t, pool.QueryRow(f.ctx, `INSERT INTO cash_registers (branch_id, name) VALUES ($1, 'Caja 2') RETURNING id`, f.branch).Scan(&reg2))
	_, err = f.cash.Open(f.ctx, f.branch, f.quimico.UserID, cash.OpenInput{RegisterID: reg2})
	must(t, err)
	sell := func(p auth.Principal, qty int, method string) {
		_, err := f.sales.Create(f.ctx, p, f.branch, sales.CreateInput{PaymentMethod: method, AmountPaid: 100000, Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: qty}}})
		must(t, err)
	}
	sell(f.cajero, 1, "efectivo") // $1.000
	sell(f.cajero, 3, "debito")   // $3.000
	sell(f.quimico, 5, "credito") // $5.000 (no debe verlo el cajero)

	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	get := func(path string, p auth.Principal) (int, map[string]any) {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	code, d := get("/api/reports/dashboard", f.cajero)
	if code != 200 || d["scope"] != "own" {
		t.Fatalf("dashboard cajero: %d scope=%v", code, d["scope"])
	}
	num := func(k string) float64 { return d[k].(float64) }
	if num("today_sales_total") != 4000 || num("today_sales_count") != 2 || num("today_avg_ticket") != 2000 || num("month_sales_total") != 4000 {
		t.Fatalf("cifras del cajero incorrectas: hoy=%v n=%v ticket=%v mes=%v", d["today_sales_total"], d["today_sales_count"], d["today_avg_ticket"], d["month_sales_total"])
	}
	methods := d["today_by_method"].(map[string]any)
	if methods["credito"].(float64) != 0 || methods["efectivo"].(float64) != 1000 || methods["debito"].(float64) != 3000 {
		t.Fatalf("medios de pago del cajero incluyen ventas ajenas: %v", methods)
	}
	for _, k := range []string{"inventory_value", "today_margin", "low_stock_count", "expired_count", "open_sessions", "active_products"} {
		if num(k) != 0 {
			t.Errorf("el cajero no debe recibir %s (vino %v)", k, d[k])
		}
	}
	if len(d["top_products"].([]any)) != 0 || len(d["low_stock"].([]any)) != 0 || len(d["expiring"].([]any)) != 0 {
		t.Error("el cajero no debe recibir listas de productos, stock ni vencimientos")
	}

	code, d = get("/api/reports/dashboard", f.quimico)
	if code != 200 || d["scope"] != "all" || d["today_sales_total"].(float64) != 9000 {
		t.Fatalf("dashboard químico: %d scope=%v total=%v", code, d["scope"], d["today_sales_total"])
	}

	today := time.Now().Format(time.DateOnly)
	for _, p := range []auth.Principal{f.cajero, f.bodega} {
		if code, _ := get("/api/reports/sales?from="+today+"&to="+today, p); code != 403 {
			t.Errorf("%s pidió el reporte de ventas completo: %d, want 403", p.Role, code)
		}
	}
	if code, _ := get("/api/reports/sales?from="+today+"&to="+today, f.quimico); code != 200 {
		t.Errorf("químico no pudo ver reportes: %d", code)
	}
}

// TestCashierDoesNotSeeCost: el cajero ve el precio de venta pero nunca el costo de compra.
func TestCashierDoesNotSeeCost(t *testing.T) {
	f := setup(t)
	barcode := "7800000000017"
	_, err := catalog.NewService(pool).UpdateProduct(f.ctx, nil, f.paracet.ID, catalog.ProductInput{
		SKU: "T-1", Barcode: &barcode, Name: "Paracetamol 500", SaleCondition: "directa", Price: 1000, Cost: 420, MinStock: 5,
	})
	must(t, err)

	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	get := func(path string, p auth.Principal) map[string]any {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("GET %s como %s = %d", path, p.Role, rec.Code)
		}
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}

	for _, path := range []string{"/api/products?q=paracetamol", "/api/products/lookup?code=" + barcode} {
		cajero, bodega := get(path, f.cajero), get(path, f.bodega)
		if data, ok := cajero["data"].([]any); ok { // lista paginada
			cajero, bodega = data[0].(map[string]any), bodega["data"].([]any)[0].(map[string]any)
		}
		if _, has := cajero["cost"]; has {
			t.Errorf("%s: el cajero recibió el costo (%v)", path, cajero["cost"])
		}
		if cajero["price"].(float64) != 1000 {
			t.Errorf("%s: el cajero debe ver el precio de venta", path)
		}
		if bodega["cost"] == nil || bodega["cost"].(float64) != 420 {
			t.Errorf("%s: bodega debe ver el costo, vino %v", path, bodega["cost"])
		}
	}
}

// TestProductRotation: kardex con saldo inicial, ingresos, egresos, saldo acumulado y acceso solo admin.
func TestProductRotation(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "R1", time.Now().AddDate(1, 0, 0), 10, 400) // ingreso de hace 10 días (se retrofecha abajo)
	_, err := pool.Exec(f.ctx, `UPDATE stock_movements SET created_at = now() - interval '10 days'`)
	must(t, err)
	f.receive(f.paracet.ID, "R2", time.Now().AddDate(1, 0, 0), 5, 410) // ingreso de hoy
	_, err = f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)
	sale, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 3}}})
	must(t, err)
	var lotID int64
	must(t, pool.QueryRow(f.ctx, `SELECT id FROM product_lots WHERE lot_number = 'R2'`).Scan(&lotID))
	must(t, f.inv.Adjust(f.ctx, f.branch, f.bodega.UserID, inventory.AdjustmentInput{LotID: lotID, Type: "merma", Quantity: 1, Notes: "envase roto"}))

	today := time.Now().Format(time.DateOnly)
	rot, err := f.inv.Rotation(f.ctx, &f.branch, f.paracet.ID, time.Now().AddDate(0, 0, -2).Format(time.DateOnly), today)
	must(t, err)
	if rot.OpeningBalance != 10 || rot.TotalIn != 5 || rot.TotalOut != 4 || rot.ClosingBalance != 11 {
		t.Fatalf("totales: inicial=%d ingresos=%d egresos=%d final=%d", rot.OpeningBalance, rot.TotalIn, rot.TotalOut, rot.ClosingBalance)
	}
	if len(rot.Rows) != 3 {
		t.Fatalf("se esperaban 3 movimientos en el rango, hay %d", len(rot.Rows))
	}
	// Orden descendente: primero la merma (último movimiento), al final el ingreso. El saldo es el que quedó tras cada uno.
	balances := []int{rot.Rows[0].Balance, rot.Rows[1].Balance, rot.Rows[2].Balance}
	if balances[0] != 11 || balances[1] != 12 || balances[2] != 15 {
		t.Fatalf("saldos (orden descendente) inesperados: %v", balances)
	}
	if rot.Rows[0].Type != "merma" || rot.Rows[0].QtyOut != 1 || rot.Rows[1].QtyOut != 3 || rot.Rows[2].QtyIn != 5 {
		t.Fatalf("ingreso/egreso por fila inesperado: %+v", rot.Rows)
	}
	if rot.Rows[0].CreatedAt.Before(rot.Rows[2].CreatedAt) {
		t.Fatal("las filas deben venir de la más reciente a la más antigua")
	}
	if rot.Rows[2].Document == nil || !strings.HasPrefix(*rot.Rows[2].Document, "Factura N°") ||
		rot.Rows[1].Document == nil || *rot.Rows[1].Document != fmt.Sprintf("Venta #%d", sale.ID) {
		t.Fatalf("documentos de origen inesperados: %v / %v", rot.Rows[2].Document, rot.Rows[1].Document)
	}
	if rot.ProductName != f.paracet.Name {
		t.Fatalf("producto: %q", rot.ProductName)
	}

	// Rango completo: saldo inicial 0 y los 4 movimientos.
	all, err := f.inv.Rotation(f.ctx, &f.branch, f.paracet.ID, time.Now().AddDate(0, 0, -30).Format(time.DateOnly), today)
	must(t, err)
	if all.OpeningBalance != 0 || len(all.Rows) != 4 || all.ClosingBalance != 11 {
		t.Fatalf("rango completo: inicial=%d filas=%d final=%d", all.OpeningBalance, len(all.Rows), all.ClosingBalance)
	}

	// Acceso: solo admin; validación de parámetros.
	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	get := func(path string, p auth.Principal) int {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	ok := fmt.Sprintf("/api/inventory/rotation?product_id=%d&from=%s&to=%s", f.paracet.ID, today, today)
	cases := []struct {
		path string
		user auth.Principal
		want int
	}{
		{ok, f.admin, 200},
		{ok, f.quimico, 403},
		{ok, f.bodega, 403},
		{ok, f.cajero, 403},
		{"/api/inventory/rotation?from=" + today + "&to=" + today, f.admin, 400},
		{fmt.Sprintf("/api/inventory/rotation?product_id=%d&from=%s&to=2020-01-01", f.paracet.ID, today), f.admin, 400},
		{"/api/inventory/rotation?product_id=999999&from=" + today + "&to=" + today, f.admin, 404},
	}
	for _, c := range cases {
		if got := get(c.path, c.user); got != c.want {
			t.Errorf("%s como %s = %d, want %d", c.path, c.user.Role, got, c.want)
		}
	}
}

// TestPurchaseDiscountAndDates: descuento global sobre el neto (antes de IVA), prorrateado al costo de los lotes,
// y fechas de emisión/vencimiento del documento.
func TestPurchaseDiscountAndDates(t *testing.T) {
	f := setup(t)
	issue := time.Now().AddDate(0, 0, -2).Format(time.DateOnly)
	due := time.Now().AddDate(0, 0, 28).Format(time.DateOnly)
	exp := time.Now().AddDate(1, 0, 0).Format(time.DateOnly)
	in := purchases.CreateInput{
		SupplierID: f.supplier, DocumentType: "factura", DocumentNumber: "DSC-1", DocumentDate: issue, DueDate: &due, Discount: 10000,
		Items: []purchases.ItemInput{
			{ProductID: f.paracet.ID, ExpiryDate: exp, Quantity: 30, UnitCost: 1000}, // 30.000
			{ProductID: f.clonaz.ID, ExpiryDate: exp, Quantity: 10, UnitCost: 7000},  // 70.000
		},
	}
	p, err := f.purch.Create(f.ctx, f.branch, f.bodega.UserID, in)
	must(t, err)
	if p.SubtotalAmount != 100000 || p.DiscountAmount != 10000 || p.NetAmount != 90000 || p.TaxAmount != 17100 || p.TotalAmount != 107100 {
		t.Fatalf("montos: subtotal=%d descuento=%d neto=%d iva=%d total=%d", p.SubtotalAmount, p.DiscountAmount, p.NetAmount, p.TaxAmount, p.TotalAmount)
	}
	if p.DueDate == nil || p.DueDate.Format(time.DateOnly) != due || p.DocumentDate.Format(time.DateOnly) != issue {
		t.Fatalf("fechas: emisión=%v vencimiento=%v", p.DocumentDate, p.DueDate)
	}
	// Prorrateo: 3.000 a la línea de 30.000 y 7.000 a la de 70.000; costo efectivo 900 y 6.300.
	if p.Items[0].Discount != 3000 || p.Items[1].Discount != 7000 || p.Items[0].LotUnitCost != 900 || p.Items[1].LotUnitCost != 6300 {
		t.Fatalf("prorrateo: %+v", p.Items)
	}
	if p.Items[0].UnitCost != 1000 || p.Items[0].Subtotal != 30000 {
		t.Fatal("la línea debe conservar el costo y subtotal impresos en la factura")
	}
	var productCost int64
	must(t, pool.QueryRow(f.ctx, `SELECT cost FROM products WHERE id = $1`, f.paracet.ID).Scan(&productCost))
	if productCost != 900 {
		t.Fatalf("el costo del producto debe ser el efectivo tras descuento: %d", productCost)
	}

	// Validaciones.
	bad := func(mod func(*purchases.CreateInput), code string) {
		t.Helper()
		x := in
		x.DocumentNumber = fmt.Sprintf("DSC-%s", code)
		mod(&x)
		_, err := f.purch.Create(f.ctx, f.branch, f.bodega.UserID, x)
		wantCode(t, err, code)
	}
	bad(func(x *purchases.CreateInput) { x.Discount = 100001 }, "invalid_discount")
	bad(func(x *purchases.CreateInput) {
		d := time.Now().AddDate(0, 0, -3).Format(time.DateOnly)
		x.DueDate = &d
	}, "invalid_due_date")
	bad(func(x *purchases.CreateInput) {
		x.DocumentDate = time.Now().AddDate(0, 0, 1).Format(time.DateOnly)
		x.DueDate = nil
	}, "future_issue_date")

	// Sin vencimiento ni descuento sigue siendo válido (y el descuento = subtotal deja neto 0).
	x := in
	x.DocumentNumber, x.DueDate, x.Discount = "DSC-2", nil, 100000
	p2, err := f.purch.Create(f.ctx, f.branch, f.bodega.UserID, x)
	must(t, err)
	if p2.NetAmount != 0 || p2.TotalAmount != 0 || p2.DueDate != nil {
		t.Fatalf("descuento total: neto=%d total=%d", p2.NetAmount, p2.TotalAmount)
	}
	assertLedger(t)
}

// TestSalesCommission: la comisión se calcula sobre la venta neta con la tasa vigente, queda congelada en la
// venta, las anulaciones no comisionan y solo el admin ve el reporte (cada vendedor ve la suya en su dashboard).
func TestSalesCommission(t *testing.T) {
	f := setup(t)
	f.receive(f.paracet.ID, "COM", time.Now().AddDate(1, 0, 0), 50, 400)
	us := users.NewService(pool, nil)
	_, err := us.Update(f.ctx, f.admin, f.cajero.UserID, users.UpdateInput{FullName: "Usuario cajero", Role: "cajero", Active: true, BranchIDs: []int64{f.branch}, CommissionBps: 250})
	must(t, err)
	_, err = f.cash.Open(f.ctx, f.branch, f.cajero.UserID, cash.OpenInput{RegisterID: f.regID})
	must(t, err)

	// Venta de $10.000 con IVA → neto $8.403 → 2,5% = $210.
	s1, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 10}}})
	must(t, err)
	var bps int
	var amount int64
	must(t, pool.QueryRow(f.ctx, `SELECT commission_bps, commission_amount FROM sales WHERE id = $1`, s1.ID).Scan(&bps, &amount))
	if s1.NetAmount != 8403 || bps != 250 || amount != 210 {
		t.Fatalf("comisión: neto=%d bps=%d monto=%d (want 8403, 250, 210)", s1.NetAmount, bps, amount)
	}

	// Cambiar la tasa no altera la venta anterior; la nueva venta usa la nueva tasa (5%).
	_, err = us.Update(f.ctx, f.admin, f.cajero.UserID, users.UpdateInput{FullName: "Usuario cajero", Role: "cajero", Active: true, BranchIDs: []int64{f.branch}, CommissionBps: 500})
	must(t, err)
	s2, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 5}}})
	must(t, err)
	must(t, pool.QueryRow(f.ctx, `SELECT commission_amount FROM sales WHERE id = $1`, s1.ID).Scan(&amount))
	if amount != 210 {
		t.Fatalf("la comisión de una venta pasada cambió al modificar la tasa: %d", amount)
	}
	// Venta anulada: no comisiona.
	s3, err := f.sales.Create(f.ctx, f.cajero, f.branch, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: f.paracet.ID, Quantity: 3}}})
	must(t, err)
	_, err = f.sales.Void(f.ctx, f.quimico, f.branch, s3.ID, sales.VoidInput{Reason: "error de digitación"})
	must(t, err)

	rep := reports.NewService(pool)
	today := time.Now().Format(time.DateOnly)
	r, err := rep.Commissions(f.ctx, &f.branch, today, today)
	must(t, err)
	var mine *reports.SellerCommission
	for i := range r.Sellers {
		if r.Sellers[i].UserID == f.cajero.UserID {
			mine = &r.Sellers[i]
		}
	}
	want := int64(210) + money.Commission(s2.NetAmount, 500)
	if mine == nil || mine.SalesCount != 2 || mine.VoidedCount != 1 || mine.CommissionTotal != want || mine.CurrentBps != 500 {
		t.Fatalf("reporte de comisiones: %+v (want total %d)", mine, want)
	}
	detail, err := rep.CommissionDetail(f.ctx, &f.branch, f.cajero.UserID, today, today)
	must(t, err)
	if len(detail) != 3 {
		t.Fatalf("detalle: %d ventas, want 3", len(detail))
	}
	for _, d := range detail {
		if d.SaleID == s3.ID && d.Commission != 0 {
			t.Fatal("una venta anulada aparece con comisión en el detalle")
		}
	}

	// Permisos y dashboard propio (HTTP).
	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	get := func(path string, p auth.Principal) (int, map[string]any) {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		req := httptest.NewRequest("GET", path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	path := "/api/reports/commissions?from=" + today + "&to=" + today
	for _, p := range []auth.Principal{f.cajero, f.quimico, f.bodega} {
		if code, _ := get(path, p); code != 403 {
			t.Errorf("%s accedió al reporte de comisiones: %d", p.Role, code)
		}
	}
	if code, _ := get(path, f.admin); code != 200 {
		t.Errorf("admin no pudo ver comisiones: %d", code)
	}
	code, d := get("/api/reports/dashboard", f.cajero)
	if code != 200 || int64(d["own_commission_today"].(float64)) != want || int(d["own_commission_bps"].(float64)) != 500 {
		t.Fatalf("dashboard del cajero: comisión hoy=%v tasa=%v (want %d, 500)", d["own_commission_today"], d["own_commission_bps"], want)
	}
	if _, d := get("/api/reports/dashboard", f.quimico); d["own_commission_today"].(float64) != 0 {
		t.Fatal("el químico ve comisiones que no son suyas")
	}
	// Validación de tasa.
	_, err = us.Update(f.ctx, f.admin, f.cajero.UserID, users.UpdateInput{FullName: "Usuario cajero", Role: "cajero", Active: true, BranchIDs: []int64{f.branch}, CommissionBps: 10001})
	if err == nil {
		// El validador HTTP rechaza >10000; a nivel de BD el CHECK también lo impide.
		t.Fatal("se aceptó una tasa de comisión mayor al 100%")
	}
}
