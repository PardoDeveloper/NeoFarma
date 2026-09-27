package integration

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/neofarma/backend/internal/cash"
	"github.com/neofarma/backend/internal/catalog"
	"github.com/neofarma/backend/internal/inventory"
	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
	"github.com/neofarma/backend/internal/purchases"
	"github.com/neofarma/backend/internal/reports"
	"github.com/neofarma/backend/internal/sales"
	"github.com/neofarma/backend/internal/server"
	"github.com/neofarma/backend/internal/transfers"
	"github.com/neofarma/backend/internal/users"
)

// branchFixture agrega al escenario base una segunda sucursal (B) con su caja y un cajero propio.
type branchFixture struct {
	*fixture
	branchB int64
	regB    int64
	cajeroB auth.Principal
	multi   auth.Principal // químico que trabaja en A y B
}

func setupBranches(t *testing.T) *branchFixture {
	t.Helper()
	f := setup(t)
	bf := &branchFixture{fixture: f}
	must(t, pool.QueryRow(f.ctx, `INSERT INTO branches (code, name) VALUES ('T2', 'Sucursal B') RETURNING id`).Scan(&bf.branchB))
	must(t, pool.QueryRow(f.ctx, `INSERT INTO cash_registers (branch_id, name) VALUES ($1, 'Caja B1') RETURNING id`, bf.branchB).Scan(&bf.regB))
	us := users.NewService(pool, nil)
	u, err := us.Create(f.ctx, users.CreateInput{Username: "cajerob", FullName: "Cajero B", Password: "password123", Role: "cajero", BranchIDs: []int64{bf.branchB}})
	must(t, err)
	bf.cajeroB = auth.Principal{UserID: u.ID, Username: u.Username, Role: u.Role}
	m, err := us.Create(f.ctx, users.CreateInput{Username: "multi", FullName: "QF Multi", Password: "password123", Role: "quimico", BranchIDs: []int64{f.branch, bf.branchB}})
	must(t, err)
	bf.multi = auth.Principal{UserID: m.ID, Username: m.Username, Role: m.Role}
	return bf
}

// receiveAt ingresa stock en una sucursal concreta y retorna el id del lote creado.
func (bf *branchFixture) receiveAt(branchID, productID int64, lot string, qty int) int64 {
	bf.t.Helper()
	bf.docSeq++
	p, err := bf.purch.Create(bf.ctx, branchID, bf.bodega.UserID, purchases.CreateInput{
		SupplierID: bf.supplier, DocumentType: "factura", DocumentNumber: fmt.Sprint(5000 + bf.docSeq),
		DocumentDate: time.Now().Format(time.DateOnly),
		Items:        []purchases.ItemInput{{ProductID: productID, LotNumber: &lot, ExpiryDate: time.Now().AddDate(1, 0, 0).Format(time.DateOnly), Quantity: qty, UnitCost: 400}},
	})
	must(bf.t, err)
	return p.Items[0].LotID
}

func (bf *branchFixture) stockAt(branchID, productID int64) int {
	bf.t.Helper()
	var n int
	must(bf.t, pool.QueryRow(bf.ctx, `SELECT coalesce(sum(qty_available), 0)::int FROM product_lots WHERE product_id = $1 AND branch_id = $2`, productID, branchID).Scan(&n))
	return n
}

// TestBranchIsolation: ventas, caja, inventario, ingresos y reportes nunca cruzan datos entre sucursales.
func TestBranchIsolation(t *testing.T) {
	bf := setupBranches(t)
	A, B := bf.branch, bf.branchB
	lotA := bf.receiveAt(A, bf.paracet.ID, "LA", 10)
	lotB := bf.receiveAt(B, bf.paracet.ID, "LB", 5)
	var purchaseB int64
	must(t, pool.QueryRow(bf.ctx, `SELECT purchase_id FROM product_lots WHERE id = $1`, lotB).Scan(&purchaseB))

	// Stock por sucursal en el catálogo.
	cat := catalog.NewService(pool)
	for _, c := range []struct {
		branch *int64
		want   int
	}{{&A, 10}, {&B, 5}, {nil, 15}} {
		p, err := cat.GetProduct(bf.ctx, c.branch, bf.paracet.ID)
		must(t, err)
		if p.Stock != c.want || len(p.Lots) != map[int]int{10: 1, 5: 1, 15: 2}[c.want] {
			t.Errorf("stock en %v = %d (lotes %d), want %d", c.branch, p.Stock, len(p.Lots), c.want)
		}
	}

	// Venta en B: solo puede usar el stock de B aunque A tenga más.
	sessB, err := bf.cash.Open(bf.ctx, B, bf.cajeroB.UserID, cash.OpenInput{RegisterID: bf.regB})
	must(t, err)
	_, err = bf.sales.Create(bf.ctx, bf.cajeroB, B, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: bf.paracet.ID, Quantity: 6}}})
	wantCode(t, err, "insufficient_stock")
	saleB, err := bf.sales.Create(bf.ctx, bf.cajeroB, B, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: bf.paracet.ID, Quantity: 5}}})
	must(t, err)
	if saleB.BranchID != B || bf.stockAt(A, bf.paracet.ID) != 10 || bf.stockAt(B, bf.paracet.ID) != 0 {
		t.Fatalf("la venta de B tocó stock de A: A=%d B=%d", bf.stockAt(A, bf.paracet.ID), bf.stockAt(B, bf.paracet.ID))
	}

	// El cajero de A no puede vender "en B" con su caja de A, ni abrir caja de A estando en B.
	_, err = bf.cash.Open(bf.ctx, A, bf.cajero.UserID, cash.OpenInput{RegisterID: bf.regID})
	must(t, err)
	_, err = bf.sales.Create(bf.ctx, bf.cajero, B, sales.CreateInput{PaymentMethod: "debito", Items: []sales.ItemInput{{ProductID: bf.paracet.ID, Quantity: 1}}})
	wantCode(t, err, "branch_mismatch")
	_, err = bf.cash.Open(bf.ctx, B, bf.multi.UserID, cash.OpenInput{RegisterID: bf.regID})
	wantCode(t, err, "invalid_register")

	// Lecturas desde A no ven registros de B (404 / ausentes en listados).
	_, err = bf.sales.Get(bf.ctx, &A, saleB.ID)
	wantCode(t, err, "not_found")
	listA, _, err := bf.sales.List(bf.ctx, sales.Filter{BranchID: &A}, httpx.Page{Page: 1, PageSize: 50})
	must(t, err)
	for _, s := range listA {
		if s.BranchID != A {
			t.Fatalf("el listado de A incluye la venta %d de la sucursal %d", s.ID, s.BranchID)
		}
	}
	_, err = bf.cash.Get(bf.ctx, &A, sessB.ID)
	wantCode(t, err, "not_found")
	_, err = bf.purch.Get(bf.ctx, &A, purchaseB)
	wantCode(t, err, "not_found")
	regsA, err := bf.cash.ListRegisters(bf.ctx, &A)
	must(t, err)
	for _, r := range regsA {
		if r.BranchID != A {
			t.Fatalf("las cajas de A incluyen una de B: %+v", r)
		}
	}

	// Escrituras desde A sobre recursos de B se tratan como inexistentes.
	err = bf.inv.Adjust(bf.ctx, A, bf.bodega.UserID, inventory.AdjustmentInput{LotID: lotB, Type: "ajuste_positivo", Quantity: 1, Notes: "cruce"})
	wantCode(t, err, "not_found")
	_, err = bf.sales.Void(bf.ctx, bf.quimico, A, saleB.ID, sales.VoidInput{Reason: "anulación cruzada"})
	wantCode(t, err, "not_found")
	_, err = bf.cash.Close(bf.ctx, bf.quimico, A, sessB.ID, cash.CloseInput{CountedCash: 0})
	wantCode(t, err, "not_found")

	// Reportes: A no incluye las ventas de B; el consolidado sí.
	rep := reports.NewService(pool)
	dA, err := rep.Dashboard(bf.ctx, &A)
	must(t, err)
	dAll, err := rep.Dashboard(bf.ctx, nil)
	must(t, err)
	if dA.TodaySalesTotal != 0 || dAll.TodaySalesTotal != saleB.Total {
		t.Fatalf("dashboard: A=%d (want 0) todas=%d (want %d)", dA.TodaySalesTotal, dAll.TodaySalesTotal, saleB.Total)
	}
	srA, err := rep.Sales(bf.ctx, &A, time.Now().Format(time.DateOnly), time.Now().Format(time.DateOnly))
	must(t, err)
	if srA.Total != 0 || len(srA.ByBranch) != 1 {
		t.Fatalf("reporte de ventas de A incluye datos de B: total=%d sucursales=%d", srA.Total, len(srA.ByBranch))
	}

	// Defensa en la base de datos: aunque el código tuviera un bug, las FK compuestas impiden cruzar sucursales.
	_, err = pool.Exec(bf.ctx, `INSERT INTO stock_movements (branch_id, product_id, lot_id, type, quantity, user_id)
		VALUES ($1, $2, $3, 'ajuste_positivo', 1, $4)`, A, bf.paracet.ID, lotB, bf.admin.UserID)
	if !db.IsFKViolation(err) {
		t.Fatalf("la BD aceptó un movimiento de A sobre un lote de B: %v", err)
	}
	var saleItemB int64
	must(t, pool.QueryRow(bf.ctx, `SELECT id FROM sale_items WHERE sale_id = $1`, saleB.ID).Scan(&saleItemB))
	_, err = pool.Exec(bf.ctx, `INSERT INTO sale_item_lots (branch_id, sale_item_id, lot_id, quantity) VALUES ($1, $2, $3, 1)`, B, saleItemB, lotA)
	if !db.IsFKViolation(err) {
		t.Fatalf("la BD aceptó que una venta de B consuma un lote de A: %v", err)
	}
	_, err = pool.Exec(bf.ctx, `UPDATE sales SET branch_id = $2 WHERE id = $1`, saleB.ID, A)
	if !db.IsFKViolation(err) {
		t.Fatalf("la BD aceptó mover una venta a una sucursal distinta de su caja: %v", err)
	}
	assertLedger(t)
}

// TestTransfers: los traspasos mueven stock entre sucursales de forma atómica y trazable.
func TestTransfers(t *testing.T) {
	bf := setupBranches(t)
	A, B := bf.branch, bf.branchB
	var C int64
	must(t, pool.QueryRow(bf.ctx, `INSERT INTO branches (code, name) VALUES ('T3', 'Sucursal C') RETURNING id`).Scan(&C))
	lotA := bf.receiveAt(A, bf.paracet.ID, "TR-1", 10)
	lotB := bf.receiveAt(B, bf.paracet.ID, "TR-B", 3)
	svc := transfers.NewService(pool)

	tr, err := svc.Create(bf.ctx, A, bf.bodega.UserID, transfers.CreateInput{ToBranchID: B, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 4}}})
	must(t, err)
	if bf.stockAt(A, bf.paracet.ID) != 6 || bf.stockAt(B, bf.paracet.ID) != 7 {
		t.Fatalf("tras traspaso: A=%d (want 6) B=%d (want 7)", bf.stockAt(A, bf.paracet.ID), bf.stockAt(B, bf.paracet.ID))
	}
	it := tr.Items[0]
	var lotNo string
	var exp time.Time
	var cost int64
	var dstBranch int64
	must(t, pool.QueryRow(bf.ctx, `SELECT lot_number, expiry_date, unit_cost, branch_id FROM product_lots WHERE id = $1`, it.ToLotID).Scan(&lotNo, &exp, &cost, &dstBranch))
	if lotNo != "TR-1" || cost != 400 || dstBranch != B || !exp.Equal(it.ExpiryDate) {
		t.Fatalf("lote destino no conserva datos del origen: lote=%s costo=%d sucursal=%d", lotNo, cost, dstBranch)
	}
	var out, in int
	must(t, pool.QueryRow(bf.ctx, `
		SELECT coalesce(sum(quantity) FILTER (WHERE type = 'traspaso_salida' AND branch_id = $2), 0)::int,
		       coalesce(sum(quantity) FILTER (WHERE type = 'traspaso_entrada' AND branch_id = $3), 0)::int
		FROM stock_movements WHERE reference_type = 'traspaso' AND reference_id = $1`, tr.ID, A, B).Scan(&out, &in))
	if out != -4 || in != 4 {
		t.Fatalf("ledger del traspaso: salida=%d entrada=%d", out, in)
	}

	// Visible para origen y destino; invisible para una tercera sucursal.
	for _, b := range []*int64{&A, &B, nil} {
		if _, err := svc.Get(bf.ctx, b, tr.ID); err != nil {
			t.Errorf("el traspaso debe ser visible para %v: %v", b, err)
		}
	}
	_, err = svc.Get(bf.ctx, &C, tr.ID)
	wantCode(t, err, "not_found")

	// Validaciones.
	cases := []struct {
		name string
		in   transfers.CreateInput
		code string
	}{
		{"misma sucursal", transfers.CreateInput{ToBranchID: A, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 1}}}, "same_branch"},
		{"más de lo disponible", transfers.CreateInput{ToBranchID: B, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 7}}}, "insufficient_stock"},
		{"lote de otra sucursal", transfers.CreateInput{ToBranchID: C, Items: []transfers.ItemInput{{LotID: lotB, Quantity: 1}}}, "not_found"},
		{"lote repetido", transfers.CreateInput{ToBranchID: B, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 1}, {LotID: lotA, Quantity: 1}}}, "duplicate_lot"},
		{"destino inexistente", transfers.CreateInput{ToBranchID: 999999, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 1}}}, "invalid_branch"},
	}
	for _, c := range cases {
		_, err := svc.Create(bf.ctx, A, bf.bodega.UserID, c.in)
		if e, ok := apperr.As(err); !ok || e.Code != c.code {
			t.Errorf("%s: se esperaba %q, se obtuvo %v", c.name, c.code, err)
		}
	}
	// Un error a mitad de traspaso no deja cambios parciales (transacción).
	_, err = svc.Create(bf.ctx, A, bf.bodega.UserID, transfers.CreateInput{ToBranchID: B, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 2}, {LotID: lotB, Quantity: 1}}})
	wantCode(t, err, "not_found")
	if bf.stockAt(A, bf.paracet.ID) != 6 {
		t.Fatalf("un traspaso fallido dejó cambios parciales: A=%d", bf.stockAt(A, bf.paracet.ID))
	}

	// Concurrencia: dos traspasos simultáneos de 5 sobre un lote con 6 → solo uno puede completarse.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Create(bf.ctx, A, bf.bodega.UserID, transfers.CreateInput{ToBranchID: C, Items: []transfers.ItemInput{{LotID: lotA, Quantity: 5}}})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	okCount := 0
	for err := range results {
		if err == nil {
			okCount++
		}
	}
	if okCount != 1 || bf.stockAt(A, bf.paracet.ID) != 1 {
		t.Fatalf("traspasos concurrentes: exitosos=%d stock A=%d (want 1 y 1)", okCount, bf.stockAt(A, bf.paracet.ID))
	}
	// El stock total de la organización no cambia con los traspasos.
	var total int
	must(t, pool.QueryRow(bf.ctx, `SELECT sum(qty_available)::int FROM product_lots WHERE product_id = $1`, bf.paracet.ID).Scan(&total))
	if total != 13 {
		t.Fatalf("stock total de la organización = %d, want 13", total)
	}
	assertLedger(t)
}

// TestBranchHTTPScope: el header X-Branch-ID se valida contra las sucursales del usuario.
func TestBranchHTTPScope(t *testing.T) {
	bf := setupBranches(t)
	A, B := bf.branch, bf.branchB
	tokens := auth.NewTokens("test-secret-test-secret-test-secret-123", time.Hour)
	h := server.NewRouter(server.Deps{Pool: pool, Tokens: tokens, AllowedOrigins: []string{"*"}})
	call := func(method, path string, p auth.Principal, branchHeader string, body string) int {
		tok, _, err := tokens.Issue(p)
		must(t, err)
		var req *http.Request
		if body != "" {
			req = httptest.NewRequest(method, path, stringsReader(body))
		} else {
			req = httptest.NewRequest(method, path, nil)
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		if branchHeader != "" {
			req.Header.Set("X-Branch-ID", branchHeader)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	a, b := fmt.Sprint(A), fmt.Sprint(B)
	cases := []struct {
		name   string
		method string
		path   string
		user   auth.Principal
		header string
		body   string
		want   int
	}{
		{"cajero B sin header usa su única sucursal", "GET", "/api/sales", bf.cajeroB, "", "", 200},
		{"cajero B en su sucursal", "GET", "/api/sales", bf.cajeroB, b, "", 200},
		{"cajero B no accede a A", "GET", "/api/sales", bf.cajeroB, a, "", 403},
		{"cajero B no usa 'todas'", "GET", "/api/sales", bf.cajeroB, "all", "", 403},
		{"multi-sucursal sin header debe elegir", "GET", "/api/sales", bf.multi, "", "", 422},
		{"multi-sucursal en A", "GET", "/api/sales", bf.multi, a, "", 200},
		{"multi-sucursal en B", "GET", "/api/sales", bf.multi, b, "", 200},
		{"header inválido", "GET", "/api/sales", bf.multi, "abc", "", 400},
		{"sucursal inexistente", "GET", "/api/sales", bf.multi, "999999", "", 403},
		{"admin consolidado lee", "GET", "/api/reports/dashboard", bf.admin, "all", "", 200},
		{"admin consolidado no escribe", "POST", "/api/cash/sessions", bf.admin, "all", `{"register_id":1,"opening_amount":0}`, 422},
		{"admin en cualquier sucursal", "GET", "/api/cash/registers", bf.admin, b, "", 200},
		{"listar sucursales no requiere header", "GET", "/api/branches", bf.cajeroB, "", "", 200},
		{"solo admin crea sucursales", "POST", "/api/branches", bf.multi, "", `{"code":"X1","name":"Sucursal X"}`, 403},
		{"admin crea sucursales", "POST", "/api/branches", bf.admin, "", `{"code":"X1","name":"Sucursal X"}`, 201},
	}
	for _, c := range cases {
		if got := call(c.method, c.path, c.user, c.header, c.body); got != c.want {
			t.Errorf("%s: %s %s [%s] = %d, want %d", c.name, c.method, c.path, c.header, got, c.want)
		}
	}

	// Una sucursal desactivada deja de ser accesible para los usuarios (no para el admin).
	_, err := pool.Exec(bf.ctx, `UPDATE branches SET active = false WHERE id = $1`, B)
	must(t, err)
	if got := call("GET", "/api/sales", bf.cajeroB, b, ""); got != 403 {
		t.Errorf("sucursal inactiva accesible para cajero: %d", got)
	}
	if got := call("GET", "/api/sales", bf.admin, b, ""); got != 200 {
		t.Errorf("admin debe poder consultar una sucursal inactiva: %d", got)
	}
}

// TestUserBranches: usuarios no-admin requieren al menos una sucursal; el admin no guarda asignaciones.
func TestUserBranches(t *testing.T) {
	bf := setupBranches(t)
	us := users.NewService(pool, nil)
	_, err := us.Create(bf.ctx, users.CreateInput{Username: "sinsuc", FullName: "Sin Sucursal", Password: "password123", Role: "cajero"})
	wantCode(t, err, "branches_required")
	_, err = us.Create(bf.ctx, users.CreateInput{Username: "malsuc", FullName: "Mala Sucursal", Password: "password123", Role: "cajero", BranchIDs: []int64{999999}})
	wantCode(t, err, "invalid_branch")
	var n int
	must(t, pool.QueryRow(bf.ctx, `SELECT count(*) FROM users WHERE username IN ('sinsuc', 'malsuc')`).Scan(&n))
	if n != 0 {
		t.Fatal("un usuario inválido quedó creado a medias")
	}
	u, err := us.Update(bf.ctx, bf.admin, bf.cajeroB.UserID, users.UpdateInput{FullName: "Cajero B", Role: "cajero", Active: true, BranchIDs: []int64{bf.branch, bf.branchB}})
	must(t, err)
	if len(u.BranchIDs) != 2 {
		t.Fatalf("sucursales tras actualizar: %v", u.BranchIDs)
	}
	adm, err := us.Get(bf.ctx, bf.admin.UserID)
	must(t, err)
	if len(adm.BranchIDs) != 0 {
		t.Fatalf("el admin no debe tener asignaciones (accede a todas): %v", adm.BranchIDs)
	}
}

func stringsReader(s string) *strings.Reader { return strings.NewReader(s) }
