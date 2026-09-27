// Command seed carga datos de demostración: usuarios, catálogo, proveedores, ingresos y ventas históricas.
//
// Uso: go run ./cmd/seed [-reset] [-migrate-only]
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/branches"
	"github.com/neofarma/backend/internal/cash"
	"github.com/neofarma/backend/internal/catalog"
	"github.com/neofarma/backend/internal/config"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/rut"
	"github.com/neofarma/backend/internal/purchases"
	"github.com/neofarma/backend/internal/sales"
	"github.com/neofarma/backend/internal/suppliers"
	"github.com/neofarma/backend/internal/transfers"
	"github.com/neofarma/backend/internal/users"
)

func main() {
	reset := flag.Bool("reset", false, "borra todos los datos antes de sembrar")
	migrateOnly := flag.Bool("migrate-only", false, "solo aplica migraciones")
	flag.Parse()
	if err := run(*reset, *migrateOnly); err != nil {
		slog.Error("seed falló", "err", err)
		os.Exit(1)
	}
}

func run(reset, migrateOnly bool) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(pool); err != nil {
		return err
	}
	if migrateOnly {
		slog.Info("migraciones aplicadas")
		return nil
	}
	if reset {
		if _, err := pool.Exec(ctx, `TRUNCATE stock_movements, transfer_items, transfers, sale_item_lots, sale_items, sales,
			cash_movements, cash_sessions, cash_registers, purchase_items, product_lots, purchases, products, suppliers,
			categories, user_branches, users, branches
			RESTART IDENTITY CASCADE`); err != nil {
			return err
		}
		slog.Info("datos borrados")
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		slog.Info("la base ya tiene datos; use -reset para recrearlos")
		return nil
	}
	s := seeder{ctx: ctx, pool: pool, rnd: rand.New(rand.NewPCG(42, 7))}
	return s.run()
}

type seeder struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	rnd      *rand.Rand
	admin    auth.Principal
	branches []int64 // Casa Matriz, Sucursal Centro, Sucursal Norte
	regs     map[int64][]int64
	cashiers []cashierAt
	products []catalog.ProductDetail
}

// cashierAt es un cajero con la sucursal y caja donde trabaja en la demo.
type cashierAt struct {
	p        auth.Principal
	branch   int64
	register int64
}

func (s *seeder) run() error {
	steps := []struct {
		name string
		fn   func() error
	}{
		{"sucursales", s.branchesStep},
		{"cajas", s.registers},
		{"usuarios", s.users},
		{"catálogo", s.catalog},
		{"proveedores e ingresos", s.purchases},
		{"traspaso de ejemplo", s.transfer},
		{"ventas históricas", s.history},
	}
	for _, st := range steps {
		if err := st.fn(); err != nil {
			return fmt.Errorf("%s: %w", st.name, err)
		}
		slog.Info("seed ok", "paso", st.name)
	}
	fmt.Println("\nSucursales: Casa Matriz, Sucursal Centro, Sucursal Norte")
	fmt.Println("Usuarios de demostración (contraseña: neofarma123)")
	fmt.Println("  admin    → Administrador (todas las sucursales)")
	fmt.Println("  quimico  → Químico farmacéutico (todas las sucursales)")
	fmt.Println("  bodega   → Bodega (todas las sucursales)")
	fmt.Println("  cajero   → Cajero · Casa Matriz")
	fmt.Println("  cajero2  → Cajero · Sucursal Centro")
	fmt.Println("  cajero3  → Cajero · Sucursal Norte")
	return nil
}

func (s *seeder) branchesStep() error {
	svc := branches.NewService(s.pool)
	for _, b := range []branches.Input{
		{Code: "MATRIZ", Name: "Casa Matriz", Address: ptr("Av. Libertador Bernardo O'Higgins 1234, Santiago"), Phone: ptr("+56 2 2345 1000")},
		{Code: "CENTRO", Name: "Sucursal Centro", Address: ptr("Paseo Ahumada 350, Santiago"), Phone: ptr("+56 2 2345 2000")},
		{Code: "NORTE", Name: "Sucursal Norte", Address: ptr("Av. Recoleta 2100, Recoleta"), Phone: ptr("+56 2 2345 3000")},
	} {
		// La migración 00005 ya crea Casa Matriz en una base nueva: se reutiliza si existe.
		var id int64
		err := s.pool.QueryRow(s.ctx, `SELECT id FROM branches WHERE code = $1`, b.Code).Scan(&id)
		if db.IsNoRows(err) {
			br, cerr := svc.Create(s.ctx, b)
			if cerr != nil {
				return cerr
			}
			id = br.ID
		} else if err != nil {
			return err
		}
		s.branches = append(s.branches, id)
	}
	return nil
}

func (s *seeder) registers() error {
	s.regs = map[int64][]int64{}
	names := map[int64][]string{s.branches[0]: {"Caja 1", "Caja 2"}, s.branches[1]: {"Caja 1"}, s.branches[2]: {"Caja 1"}}
	svc := cash.NewService(s.pool)
	for _, b := range s.branches {
		for _, n := range names[b] {
			reg, err := svc.CreateRegister(s.ctx, b, cash.RegisterInput{Name: n})
			if err != nil {
				return err
			}
			s.regs[b] = append(s.regs[b], reg.ID)
		}
	}
	return nil
}

func (s *seeder) users() error {
	svc := users.NewService(s.pool, nil)
	matriz, centro, norte := s.branches[0], s.branches[1], s.branches[2]
	type u struct {
		in     users.CreateInput
		branch int64 // sucursal de trabajo del cajero
	}
	list := []u{
		{users.CreateInput{Username: "admin", FullName: "Administrador General", Role: auth.RoleAdmin}, 0},
		{users.CreateInput{Username: "quimico", FullName: "Q.F. Valentina Rojas", Role: auth.RoleQuimico, BranchIDs: s.branches}, 0},
		{users.CreateInput{Username: "cajero", FullName: "Matías González", Role: auth.RoleCajero, BranchIDs: []int64{matriz}}, matriz},
		{users.CreateInput{Username: "cajero2", FullName: "Camila Muñoz", Role: auth.RoleCajero, BranchIDs: []int64{centro}}, centro},
		{users.CreateInput{Username: "cajero3", FullName: "Ignacio Pérez", Role: auth.RoleCajero, BranchIDs: []int64{norte}}, norte},
		{users.CreateInput{Username: "bodega", FullName: "Jorge Soto", Role: auth.RoleBodega, BranchIDs: s.branches}, 0},
	}
	for _, x := range list {
		x.in.Password = "neofarma123"
		created, err := svc.Create(s.ctx, x.in)
		if err != nil {
			return err
		}
		p := auth.Principal{UserID: created.ID, Username: created.Username, FullName: created.FullName, Role: created.Role}
		switch created.Role {
		case auth.RoleAdmin:
			s.admin = p
		case auth.RoleCajero:
			s.cashiers = append(s.cashiers, cashierAt{p: p, branch: x.branch, register: s.regs[x.branch][0]})
		}
	}
	return nil
}

type prod struct {
	name, ingredient, conc, pres, lab, cat, cond string
	bio                                          bool
	price                                        int64
	min                                          int
}

func ptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (s *seeder) catalog() error {
	svc := catalog.NewService(s.pool)
	cats := []string{"Analgésicos y antiinflamatorios", "Antibióticos", "Cardiovascular", "Diabetes y metabolismo",
		"Gastrointestinal", "Respiratorio", "Sistema nervioso", "Antialérgicos", "Vitaminas y suplementos",
		"Dermocosmética", "Cuidado personal", "Insumos médicos"}
	catID := map[string]int64{}
	for _, c := range cats {
		cat, err := svc.CreateCategory(s.ctx, c)
		if err != nil {
			return err
		}
		catID[c] = cat.ID
	}
	products := []prod{
		{"Paracetamol 500 mg", "Paracetamol", "500 mg", "Comprimidos x 16", "Laboratorio Chile", cats[0], "directa", true, 990, 40},
		{"Ibuprofeno 400 mg", "Ibuprofeno", "400 mg", "Comprimidos x 20", "Mintlab", cats[0], "directa", true, 1490, 30},
		{"Naproxeno 550 mg", "Naproxeno sódico", "550 mg", "Comprimidos x 10", "Andrómaco", cats[0], "directa", true, 2290, 15},
		{"Ketoprofeno 100 mg", "Ketoprofeno", "100 mg", "Cápsulas x 20", "Saval", cats[0], "directa", false, 3990, 10},
		{"Diclofenaco Gel 1%", "Diclofenaco dietilamina", "1%", "Gel 50 g", "Recalcine", cats[0], "directa", false, 4590, 8},
		{"Tramadol 50 mg", "Tramadol clorhidrato", "50 mg", "Cápsulas x 10", "Laboratorio Chile", cats[0], "receta_retenida", true, 3290, 5},
		{"Amoxicilina 500 mg", "Amoxicilina", "500 mg", "Cápsulas x 21", "Laboratorio Chile", cats[1], "receta_simple", true, 2990, 15},
		{"Azitromicina 500 mg", "Azitromicina", "500 mg", "Comprimidos x 3", "Mintlab", cats[1], "receta_simple", true, 3490, 10},
		{"Ciprofloxacino 500 mg", "Ciprofloxacino", "500 mg", "Comprimidos x 10", "Andrómaco", cats[1], "receta_simple", true, 2790, 10},
		{"Cefadroxilo 500 mg", "Cefadroxilo", "500 mg", "Cápsulas x 12", "Saval", cats[1], "receta_simple", false, 5990, 6},
		{"Losartán 50 mg", "Losartán potásico", "50 mg", "Comprimidos x 30", "Laboratorio Chile", cats[2], "receta_simple", true, 1990, 30},
		{"Enalapril 10 mg", "Enalapril maleato", "10 mg", "Comprimidos x 20", "Mintlab", cats[2], "receta_simple", true, 1290, 25},
		{"Atorvastatina 20 mg", "Atorvastatina", "20 mg", "Comprimidos x 30", "Recalcine", cats[2], "receta_simple", true, 3990, 20},
		{"Ácido Acetilsalicílico 100 mg", "Ácido acetilsalicílico", "100 mg", "Comprimidos x 30", "Bayer", cats[2], "directa", false, 2490, 20},
		{"Amlodipino 10 mg", "Amlodipino", "10 mg", "Comprimidos x 30", "Andrómaco", cats[2], "receta_simple", true, 1790, 20},
		{"Metformina 850 mg", "Metformina clorhidrato", "850 mg", "Comprimidos x 30", "Laboratorio Chile", cats[3], "receta_simple", true, 1590, 30},
		{"Levotiroxina 100 mcg", "Levotiroxina sódica", "100 mcg", "Comprimidos x 30", "Merck", cats[3], "receta_simple", false, 4290, 15},
		{"Glibenclamida 5 mg", "Glibenclamida", "5 mg", "Comprimidos x 30", "Mintlab", cats[3], "receta_simple", true, 1190, 10},
		{"Omeprazol 20 mg", "Omeprazol", "20 mg", "Cápsulas x 28", "Laboratorio Chile", cats[4], "directa", true, 1690, 30},
		{"Domperidona 10 mg", "Domperidona", "10 mg", "Comprimidos x 30", "Saval", cats[4], "directa", true, 2590, 10},
		{"Loperamida 2 mg", "Loperamida", "2 mg", "Comprimidos x 6", "Andrómaco", cats[4], "directa", false, 1890, 10},
		{"Sales de Rehidratación Oral", "Electrolitos", "", "Sobres x 4", "Pharma Investi", cats[4], "directa", false, 2190, 8},
		{"Salbutamol Inhalador 100 mcg", "Salbutamol", "100 mcg/dosis", "Aerosol 200 dosis", "GSK", cats[5], "receta_simple", false, 5490, 10},
		{"Ambroxol Jarabe 30 mg/5 ml", "Ambroxol", "30 mg/5 ml", "Frasco 120 ml", "Recalcine", cats[5], "directa", false, 3290, 10},
		{"Clorfenamina 4 mg", "Clorfenamina maleato", "4 mg", "Comprimidos x 20", "Laboratorio Chile", cats[7], "directa", true, 990, 15},
		{"Loratadina 10 mg", "Loratadina", "10 mg", "Comprimidos x 30", "Mintlab", cats[7], "directa", true, 1490, 20},
		{"Cetirizina 10 mg", "Cetirizina", "10 mg", "Comprimidos x 30", "Andrómaco", cats[7], "directa", true, 1990, 15},
		{"Clonazepam 2 mg", "Clonazepam", "2 mg", "Comprimidos x 30", "Roche", cats[6], "receta_cheque", false, 6990, 5},
		{"Alprazolam 0,5 mg", "Alprazolam", "0,5 mg", "Comprimidos x 30", "Saval", cats[6], "receta_retenida", true, 4990, 5},
		{"Sertralina 50 mg", "Sertralina", "50 mg", "Comprimidos x 30", "Recalcine", cats[6], "receta_retenida", true, 5990, 8},
		{"Fluoxetina 20 mg", "Fluoxetina", "20 mg", "Cápsulas x 30", "Laboratorio Chile", cats[6], "receta_retenida", true, 2990, 8},
		{"Vitamina C 1 g Efervescente", "Ácido ascórbico", "1 g", "Tabletas x 10", "Bayer", cats[8], "directa", false, 3490, 15},
		{"Complejo B", "Vitaminas B1, B6, B12", "", "Comprimidos x 30", "Saval", cats[8], "directa", false, 4990, 10},
		{"Magnesio + Zinc", "Magnesio, zinc", "", "Cápsulas x 60", "Pharma Investi", cats[8], "directa", false, 7990, 6},
		{"Protector Solar FPS 50+", "", "", "Crema 120 ml", "Eucerin", cats[9], "directa", false, 18990, 6},
		{"Crema Hidratante Corporal", "", "", "Frasco 400 ml", "Cetaphil", cats[9], "directa", false, 15990, 4},
		{"Alcohol Gel 70%", "Etanol", "70%", "Frasco 500 ml", "Difem", cats[10], "directa", false, 2990, 20},
		{"Mascarillas Desechables", "", "", "Caja x 50", "Medline", cats[10], "directa", false, 4990, 10},
		{"Preservativos Clásicos", "", "", "Caja x 3", "Durex", cats[10], "directa", false, 3490, 10},
		{"Termómetro Digital", "", "", "Unidad", "Omron", cats[11], "directa", false, 6990, 4},
		{"Test de Embarazo", "", "", "Unidad", "Clearblue", cats[11], "directa", false, 5990, 6},
		{"Jeringa 5 ml", "", "", "Unidad", "BD", cats[11], "directa", false, 290, 50},
		{"Paracetamol + Cafeína", "Paracetamol 500 mg + Cafeína 65 mg", "", "Comprimidos x 20", "Laboratorio Chile", cats[0], "directa", true, 1990, 15},
	}
	for i, p := range products {
		cid := catID[p.cat]
		barcode := fmt.Sprintf("780%010d", 1000000+i*7919)
		// Medicamentos (con principio activo) llevan registro ISP; los de laboratorios nacionales se marcan genéricos.
		var isp *string
		generic := false
		if p.ingredient != "" && p.cat != cats[9] && p.cat != cats[10] {
			isp = ptr(fmt.Sprintf("F-%d/%d", 10000+i*137, 15+i%10))
			generic = p.lab == "Laboratorio Chile" || p.lab == "Mintlab" || p.lab == "Andrómaco"
		}
		d, err := svc.CreateProduct(s.ctx, nil, catalog.ProductInput{
			SKU: fmt.Sprintf("NF-%04d", i+1), Barcode: &barcode, Name: p.name, Ingredients: seedIngredients(p.ingredient, p.conc),
			Presentation: ptr(p.pres), Laboratory: ptr(p.lab), CategoryID: &cid,
			SaleCondition: p.cond, IsBioequivalent: p.bio, IsGeneric: generic, DosageForm: ptr(dosageFormFor(p.pres)), ISPRegistry: isp,
			Price: p.price, Cost: p.price * 55 / 100 / 119 * 100, MinStock: p.min,
		})
		if err != nil {
			return err
		}
		s.products = append(s.products, d)
	}
	return nil
}

func (s *seeder) purchases() error {
	supSvc := suppliers.NewService(s.pool)
	type sup struct{ rut, name, trade, contact, phone, email string }
	sups := []sup{
		{"76086428", "Droguería Nacional SpA", "DroNac", "Carolina Pérez", "+56 2 2345 6789", "ventas@dronac.cl"},
		{"96519830", "Laboratorio Chile S.A.", "Lab Chile", "Rodrigo Silva", "+56 2 2365 5000", "pedidos@labchile.cl"},
		{"77123456", "Distribuidora Farma Sur Ltda.", "Farma Sur", "Patricia Vidal", "+56 41 223 4455", "contacto@farmasur.cl"},
		{"78901234", "Insumos Médicos del Pacífico SpA", "IMP", "Felipe Araya", "+56 32 268 1122", "ventas@imp.cl"},
	}
	var supIDs []int64
	for _, x := range sups {
		sp, err := supSvc.Create(s.ctx, suppliers.Input{
			RUT: rutFor(x.rut), BusinessName: x.name, TradeName: &x.trade, ContactName: &x.contact,
			Phone: &x.phone, Email: &x.email, PaymentTermsDays: 30,
		})
		if err != nil {
			return err
		}
		supIDs = append(supIDs, sp.ID)
	}

	purSvc := purchases.NewService(s.pool)
	bodega := auth.Principal{}
	if err := s.pool.QueryRow(s.ctx, `SELECT id FROM users WHERE username = 'bodega'`).Scan(&bodega.UserID); err != nil {
		return err
	}
	today := time.Now()
	// Casa Matriz: dos ingresos por proveedor. Centro y Norte: uno por proveedor, con menos unidades.
	// Algunos lotes vencen pronto para demostrar alertas.
	type plan struct {
		branch int64
		round  int
		scale  int // % de las cantidades base
	}
	plans := []plan{{s.branches[0], 0, 100}, {s.branches[0], 1, 100}, {s.branches[1], 1, 60}, {s.branches[2], 1, 45}}
	for _, pl := range plans {
		round := pl.round
		for si, supID := range supIDs {
			var items []purchases.ItemInput
			for pi, p := range s.products {
				if pi%len(supIDs) != si {
					continue
				}
				months := 8 + s.rnd.IntN(20)
				if round == 0 && pi%9 == 0 {
					months = 1 // vence en ~1 mes
				}
				qty := (20 + s.rnd.IntN(80)) * pl.scale / 100
				if pi%11 == 3 {
					qty = 3 + s.rnd.IntN(3) // stock bajo
				}
				items = append(items, purchases.ItemInput{
					ProductID: p.ID, LotNumber: ptr(fmt.Sprintf("L%d%03d%d", 24+round, pi, s.rnd.IntN(10))),
					ExpiryDate: today.AddDate(0, months, s.rnd.IntN(25)).Format(time.DateOnly),
					Quantity:   qty, UnitCost: p.Price * (45 + int64(s.rnd.IntN(15))) / 100 * 100 / 119,
				})
			}
			docDate := today.AddDate(0, 0, -40+round*18)
			pu, err := purSvc.Create(s.ctx, pl.branch, bodega.UserID, purchases.CreateInput{
				SupplierID: supID, DocumentType: "factura", DocumentNumber: fmt.Sprintf("%d", 100000+s.rnd.IntN(900000)),
				DocumentDate: docDate.Format(time.DateOnly), Items: items,
			})
			if err != nil {
				return err
			}
			if _, err := s.pool.Exec(s.ctx, `UPDATE purchases SET created_at = $2 WHERE id = $1`, pu.ID, docDate.Add(10*time.Hour)); err != nil {
				return err
			}
			if _, err := s.pool.Exec(s.ctx, `UPDATE product_lots SET created_at = $2 WHERE purchase_id = $1`, pu.ID, docDate.Add(10*time.Hour)); err != nil {
				return err
			}
			if _, err := s.pool.Exec(s.ctx, `UPDATE stock_movements SET created_at = $2 WHERE reference_type = 'compra' AND reference_id = $1`, pu.ID, docDate.Add(10*time.Hour)); err != nil {
				return err
			}
		}
	}
	// Un par de lotes ya vencidos (para mostrar alertas de vencidos).
	_, err := s.pool.Exec(s.ctx, `
		UPDATE product_lots SET expiry_date = current_date - 5
		WHERE id IN (SELECT id FROM product_lots WHERE branch_id = $1 ORDER BY id DESC LIMIT 2)`, s.branches[0])
	return err
}

func rutFor(body string) string {
	var n int
	fmt.Sscan(body, &n)
	return rut.FromNumber(n)
}

// history genera ventas de los últimos 20 días usando los servicios reales (FEFO, caja, etc.) y luego las retrofecha.
func (s *seeder) history() error {
	cashSvc := cash.NewService(s.pool)
	saleSvc := sales.NewService(s.pool)
	methods := []string{"efectivo", "efectivo", "efectivo", "debito", "debito", "credito", "transferencia"}
	var directa []catalog.ProductDetail
	for _, p := range s.products {
		if p.SaleCondition == "directa" || p.SaleCondition == "receta_simple" {
			directa = append(directa, p)
		}
	}
	for day := 20; day >= 0; day-- {
		date := time.Now().AddDate(0, 0, -day)
		for ci, c := range s.cashiers {
			cashier := c.p
			if day == 0 && ci == 1 {
				continue // hoy: la caja de Sucursal Centro queda sin abrir
			}
			sess, err := cashSvc.Open(s.ctx, c.branch, cashier.UserID, cash.OpenInput{RegisterID: c.register, OpeningAmount: 50000})
			if err != nil {
				return err
			}
			nSales := 6 + s.rnd.IntN(10)
			for k := 0; k < nSales; k++ {
				var items []sales.ItemInput
				for j := 0; j < 1+s.rnd.IntN(3); j++ {
					p := directa[s.rnd.IntN(len(directa))]
					items = append(items, sales.ItemInput{ProductID: p.ID, Quantity: 1 + s.rnd.IntN(2)})
				}
				m := methods[s.rnd.IntN(len(methods))]
				sale, err := saleSvc.Create(s.ctx, cashier, c.branch, sales.CreateInput{PaymentMethod: m, AmountPaid: 100000, Items: items})
				if err != nil {
					continue // stock agotado en algún producto: se omite esa venta
				}
				at := time.Date(date.Year(), date.Month(), date.Day(), 9+k*10/nSales, s.rnd.IntN(60), 0, 0, time.Local)
				if day == 0 && at.After(time.Now()) {
					at = time.Now().Add(-time.Duration(nSales-k) * time.Minute)
				}
				if err := s.backdate(`UPDATE sales SET created_at = $2 WHERE id = $1`, sale.ID, at); err != nil {
					return err
				}
				if err := s.backdate(`UPDATE stock_movements SET created_at = $2 WHERE reference_type = 'venta' AND reference_id = $1`, sale.ID, at); err != nil {
					return err
				}
			}
			opened := time.Date(date.Year(), date.Month(), date.Day(), 8, 55, 0, 0, time.Local)
			if day == 0 {
				if err := s.backdate(`UPDATE cash_sessions SET opened_at = $2 WHERE id = $1`, sess.ID, earliest(opened, time.Now())); err != nil {
					return err
				}
				continue // la sesión de hoy queda abierta
			}
			full, err := cashSvc.Get(s.ctx, &c.branch, sess.ID)
			if err != nil {
				return err
			}
			counted := full.Summary.ExpectedCash
			if s.rnd.IntN(5) == 0 {
				counted -= int64(s.rnd.IntN(5)+1) * 1000 // algunos cierres con faltante
			}
			if _, err := cashSvc.Close(s.ctx, cashier, c.branch, sess.ID, cash.CloseInput{CountedCash: counted}); err != nil {
				return err
			}
			closed := time.Date(date.Year(), date.Month(), date.Day(), 19, 5, 0, 0, time.Local)
			if _, err := s.pool.Exec(s.ctx, `UPDATE cash_sessions SET opened_at = $2, closed_at = $3 WHERE id = $1`, sess.ID, opened, closed); err != nil {
				return err
			}
		}
	}
	return nil
}

// transfer envía algunos lotes de Casa Matriz a Sucursal Norte (demuestra traspasos y su trazabilidad).
func (s *seeder) transfer() error {
	var bodega int64
	if err := s.pool.QueryRow(s.ctx, `SELECT id FROM users WHERE username = 'bodega'`).Scan(&bodega); err != nil {
		return err
	}
	rows, err := s.pool.Query(s.ctx, `
		SELECT id, least(qty_available / 4, 15) FROM product_lots
		WHERE branch_id = $1 AND qty_available >= 20 AND expiry_date > current_date + 60
		ORDER BY id LIMIT 4`, s.branches[0])
	if err != nil {
		return err
	}
	items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (transfers.ItemInput, error) {
		var it transfers.ItemInput
		return it, r.Scan(&it.LotID, &it.Quantity)
	})
	if err != nil || len(items) == 0 {
		return err
	}
	t, err := transfers.NewService(s.pool).Create(s.ctx, s.branches[0], bodega, transfers.CreateInput{
		ToBranchID: s.branches[2], Notes: ptr("Reposición semanal Sucursal Norte"), Items: items,
	})
	if err != nil {
		return err
	}
	at := time.Now().AddDate(0, 0, -12).Add(-3 * time.Hour)
	if err := s.backdate(`UPDATE transfers SET created_at = $2 WHERE id = $1`, t.ID, at); err != nil {
		return err
	}
	return s.backdate(`UPDATE stock_movements SET created_at = $2 WHERE reference_type = 'traspaso' AND reference_id = $1`, t.ID, at)
}

func (s *seeder) backdate(sql string, id int64, at time.Time) error {
	_, err := s.pool.Exec(s.ctx, sql, id, at)
	return err
}

func earliest(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

// dosageFormFor deduce la forma farmacéutica a partir de la presentación del producto demo.
func dosageFormFor(pres string) string {
	p := strings.ToLower(pres)
	switch {
	case strings.Contains(p, "tabletas") && strings.Contains(p, "x 10"):
		return "comprimido_efervescente"
	case strings.Contains(p, "comprimidos"):
		return "comprimido"
	case strings.Contains(p, "cápsulas"):
		return "capsula"
	case strings.Contains(p, "frasco 120"):
		return "jarabe"
	case strings.Contains(p, "gel"), strings.Contains(p, "frasco 500"):
		return "gel"
	case strings.Contains(p, "crema"), strings.Contains(p, "frasco 400"):
		return "crema"
	case strings.Contains(p, "aerosol"):
		return "aerosol_inhalacion"
	case strings.Contains(p, "sobres"):
		return "polvo_suspension_oral"
	}
	return ""
}

var doseRe = regexp.MustCompile(`^(.*?)\s*(\d+(?:[.,]\d+)?)\s*(mg/5 ml|mg/ml|mcg/dosis|mcg|mg|g|UI|ml|%|mEq)$`)

// seedIngredients arma la composición demo: "Paracetamol 500 mg + Cafeína 65 mg" (varios con dosis),
// ingrediente + concentración "500 mg", o una lista "Magnesio, zinc" sin dosis.
func seedIngredients(ingredient, conc string) []catalog.IngredientInput {
	if ingredient == "" {
		return nil
	}
	var out []catalog.IngredientInput
	if strings.Contains(ingredient, " + ") {
		for _, part := range strings.Split(ingredient, " + ") {
			out = append(out, parseIngredient(part))
		}
		return out
	}
	if conc != "" {
		return []catalog.IngredientInput{parseIngredient(ingredient + " " + conc)}
	}
	for _, name := range strings.Split(ingredient, ", ") {
		out = append(out, catalog.IngredientInput{Name: strings.ToUpper(name[:1]) + name[1:]})
	}
	return out
}

func parseIngredient(s string) catalog.IngredientInput {
	m := doseRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return catalog.IngredientInput{Name: s}
	}
	dose, _ := strconv.ParseFloat(strings.Replace(m[2], ",", ".", 1), 64)
	unit := m[3]
	return catalog.IngredientInput{Name: m[1], Dose: &dose, Unit: &unit}
}
