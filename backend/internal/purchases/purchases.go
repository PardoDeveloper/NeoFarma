// Package purchases gestiona el ingreso de mercadería (recepción de compras a proveedores).
package purchases

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/inventory"
	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
	"github.com/neofarma/backend/internal/platform/money"
)

type Purchase struct {
	ID             int64      `json:"id"`
	BranchID       int64      `json:"branch_id"`
	BranchName     string     `json:"branch_name"`
	SupplierID     int64      `json:"supplier_id"`
	SupplierName   string     `json:"supplier_name"`
	SupplierRUT    string     `json:"supplier_rut"`
	DocumentType   string     `json:"document_type"`
	DocumentNumber string     `json:"document_number"`
	DocumentDate   time.Time  `json:"document_date"` // fecha de emisión del documento
	DueDate        *time.Time `json:"due_date"`      // fecha de vencimiento (pago) del documento
	UserName       string     `json:"user_name"`
	SubtotalAmount int64      `json:"subtotal_amount"` // Σ líneas (neto, antes del descuento)
	DiscountAmount int64      `json:"discount_amount"` // descuento global, aplicado sobre el neto
	NetAmount      int64      `json:"net_amount"`
	TaxAmount      int64      `json:"tax_amount"`
	TotalAmount    int64      `json:"total_amount"`
	ItemsCount     int        `json:"items_count"`
	UnitsCount     int        `json:"units_count"`
	Notes          *string    `json:"notes"`
	CreatedAt      time.Time  `json:"created_at"`
	Items          []Item     `json:"items,omitempty"`
}

type Item struct {
	ID          int64     `json:"id"`
	ProductID   int64     `json:"product_id"`
	ProductName string    `json:"product_name"`
	ProductSKU  string    `json:"product_sku"`
	LotID       int64     `json:"lot_id"`
	LotNumber   *string   `json:"lot_number"`
	ExpiryDate  time.Time `json:"expiry_date"`
	Quantity    int       `json:"quantity"`
	UnitCost    int64     `json:"unit_cost"`
	Subtotal    int64     `json:"subtotal"`
	Discount    int64     `json:"discount"`      // parte del descuento global asignada a la línea
	LotUnitCost int64     `json:"lot_unit_cost"` // costo unitario efectivo del lote (tras descuento)
}

type ItemInput struct {
	ProductID  int64   `json:"product_id" validate:"required,gt=0"`
	LotNumber  *string `json:"lot_number" validate:"omitempty,max=60"` // opcional
	ExpiryDate string  `json:"expiry_date" validate:"required,datetime=2006-01-02"`
	Quantity   int     `json:"quantity" validate:"required,gt=0,lte=100000"`
	UnitCost   int64   `json:"unit_cost" validate:"gte=0,lte=100000000"` // costo unitario neto
}

type CreateInput struct {
	SupplierID     int64       `json:"supplier_id" validate:"required,gt=0"`
	DocumentType   string      `json:"document_type" validate:"required,oneof=factura guia_despacho boleta"`
	DocumentNumber string      `json:"document_number" validate:"required,max=40"`
	DocumentDate   string      `json:"document_date" validate:"required,datetime=2006-01-02"` // emisión
	DueDate        *string     `json:"due_date" validate:"omitempty,datetime=2006-01-02"`
	Discount       int64       `json:"discount" validate:"gte=0,lte=10000000000"`
	Notes          *string     `json:"notes" validate:"omitempty,max=1000"`
	Items          []ItemInput `json:"items" validate:"required,min=1,max=300,dive"`
}

type Filter struct {
	SupplierID *int64
	Query      string
	From, To   string
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Create registra la recepción: crea lotes, líneas de compra, movimientos de stock y actualiza el costo del producto.
// Create registra el ingreso en la sucursal indicada; sus lotes y movimientos nacen en esa sucursal.
func (s *Service) Create(ctx context.Context, branchID, userID int64, in CreateInput) (Purchase, error) {
	docDate, _ := time.Parse(time.DateOnly, in.DocumentDate)
	y, m, d := time.Now().Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC) // comparable con fechas parseadas (UTC)
	if docDate.After(today) {
		return Purchase{}, apperr.Unprocessable("future_issue_date", "La fecha de emisión no puede ser posterior a hoy")
	}
	var dueDate *time.Time
	if in.DueDate != nil && strings.TrimSpace(*in.DueDate) != "" {
		dd, _ := time.Parse(time.DateOnly, *in.DueDate)
		if dd.Before(docDate) {
			return Purchase{}, apperr.Unprocessable("invalid_due_date", "La fecha de vencimiento no puede ser anterior a la fecha de emisión")
		}
		dueDate = &dd
	}
	var subtotal int64
	lineSubtotals := make([]int64, len(in.Items))
	for i, it := range in.Items {
		exp, _ := time.Parse(time.DateOnly, it.ExpiryDate)
		if !exp.After(today) {
			return Purchase{}, apperr.Unprocessable("expired_lot",
				fmt.Sprintf("La línea %d tiene un lote vencido o que vence hoy (%s)", i+1, it.ExpiryDate))
		}
		lineSubtotals[i] = int64(it.Quantity) * it.UnitCost
		subtotal += lineSubtotals[i]
	}
	if in.Discount > subtotal {
		return Purchase{}, apperr.Unprocessable("invalid_discount", "El descuento no puede superar el subtotal del documento")
	}
	// Descuento global sobre el neto (antes de IVA), prorrateado entre líneas para el costo efectivo de cada lote.
	lineDiscounts := allocateDiscount(lineSubtotals, in.Discount)
	net := subtotal - in.Discount
	tax := money.TaxFromNet(net)

	var id int64
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var active bool
		err := tx.QueryRow(ctx, `SELECT active FROM suppliers WHERE id = $1`, in.SupplierID).Scan(&active)
		if db.IsNoRows(err) || (err == nil && !active) {
			return apperr.Unprocessable("invalid_supplier", "El proveedor no existe o está inactivo")
		}
		if err != nil {
			return err
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO purchases (branch_id, supplier_id, document_type, document_number, document_date, due_date, user_id,
			                       subtotal_amount, discount_amount, net_amount, tax_amount, total_amount, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
			branchID, in.SupplierID, in.DocumentType, strings.TrimSpace(in.DocumentNumber), docDate, dueDate, userID,
			subtotal, in.Discount, net, tax, net+tax, in.Notes).Scan(&id)
		if db.IsUniqueViolation(err) {
			return apperr.Conflict("Ese documento ya fue ingresado para este proveedor")
		}
		if err != nil {
			return fmt.Errorf("insert purchase: %w", err)
		}

		for i, it := range in.Items {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM products WHERE id = $1 AND active)`, it.ProductID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return apperr.Unprocessable("invalid_product", fmt.Sprintf("El producto de la línea %d no existe o está inactivo", i+1))
			}
			exp, _ := time.Parse(time.DateOnly, it.ExpiryDate)
			lotCost := effectiveUnitCost(lineSubtotals[i], lineDiscounts[i], it.Quantity)
			var lotID int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO product_lots (branch_id, product_id, lot_number, expiry_date, qty_initial, qty_available, unit_cost, purchase_id)
				VALUES ($1,$2,$3,$4,$5,$5,$6,$7) RETURNING id`,
				branchID, it.ProductID, normalizeLot(it.LotNumber), exp, it.Quantity, lotCost, id).Scan(&lotID); err != nil {
				return fmt.Errorf("insert lot: %w", err)
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO purchase_items (branch_id, purchase_id, product_id, lot_id, quantity, unit_cost, subtotal, discount)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, branchID, id, it.ProductID, lotID, it.Quantity, it.UnitCost, lineSubtotals[i], lineDiscounts[i]); err != nil {
				return fmt.Errorf("insert purchase item: %w", err)
			}
			if _, err := tx.Exec(ctx, `UPDATE products SET cost = $2 WHERE id = $1`, it.ProductID, lotCost); err != nil {
				return err
			}
			if err := inventory.Record(ctx, tx, branchID, it.ProductID, lotID, inventory.MovCompra, it.Quantity, "compra", id, userID, nil); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Purchase{}, err
	}
	return s.Get(ctx, &branchID, id)
}

const selectSQL = `
	SELECT p.id, p.branch_id, b.name, p.supplier_id, s.business_name, s.rut, p.document_type, p.document_number, p.document_date,
	       p.due_date, u.full_name, p.subtotal_amount, p.discount_amount, p.net_amount, p.tax_amount, p.total_amount,
	       (SELECT count(*) FROM purchase_items WHERE purchase_id = p.id)::int,
	       (SELECT coalesce(sum(quantity), 0) FROM purchase_items WHERE purchase_id = p.id)::int,
	       p.notes, p.created_at
	FROM purchases p
	JOIN branches b ON b.id = p.branch_id
	JOIN suppliers s ON s.id = p.supplier_id
	JOIN users u ON u.id = p.user_id`

func scan(r pgx.Row) (Purchase, error) {
	var p Purchase
	err := r.Scan(&p.ID, &p.BranchID, &p.BranchName, &p.SupplierID, &p.SupplierName, &p.SupplierRUT, &p.DocumentType, &p.DocumentNumber, &p.DocumentDate,
		&p.DueDate, &p.UserName, &p.SubtotalAmount, &p.DiscountAmount, &p.NetAmount, &p.TaxAmount, &p.TotalAmount, &p.ItemsCount, &p.UnitsCount, &p.Notes, &p.CreatedAt)
	return p, err
}

// List lista los ingresos de la sucursal (branch nil = todas).
func (s *Service) List(ctx context.Context, branch *int64, f Filter, pg httpx.Page) ([]Purchase, int, error) {
	cond := `($1::bigint IS NULL OR p.supplier_id = $1)
		AND ($2 = '' OR p.document_number ILIKE '%' || $2 || '%' OR s.business_name ILIKE '%' || $2 || '%')
		AND ($3 = '' OR p.created_at >= $3::date)
		AND ($4 = '' OR p.created_at < $4::date + 1)
		AND ($5::bigint IS NULL OR p.branch_id = $5)`
	args := []any{f.SupplierID, strings.TrimSpace(f.Query), f.From, f.To, branch}
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count purchases: %w", err)
	}
	rows, err := s.pool.Query(ctx, selectSQL+` WHERE `+cond+` ORDER BY p.created_at DESC LIMIT $6 OFFSET $7`,
		append(args, pg.PageSize, pg.Offset())...)
	if err != nil {
		return nil, 0, fmt.Errorf("list purchases: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Purchase, error) { return scan(r) })
	return list, total, err
}

// Get retorna el ingreso si pertenece a la sucursal indicada (nil = cualquiera); si no, 404.
func (s *Service) Get(ctx context.Context, branch *int64, id int64) (Purchase, error) {
	p, err := scan(s.pool.QueryRow(ctx, selectSQL+` WHERE p.id = $1 AND ($2::bigint IS NULL OR p.branch_id = $2)`, id, branch))
	if db.IsNoRows(err) {
		return p, apperr.NotFound("Ingreso no encontrado")
	}
	if err != nil {
		return p, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT i.id, i.product_id, pr.name, pr.sku, i.lot_id, l.lot_number, l.expiry_date, i.quantity, i.unit_cost, i.subtotal,
		       i.discount, l.unit_cost
		FROM purchase_items i
		JOIN products pr ON pr.id = i.product_id
		JOIN product_lots l ON l.id = i.lot_id
		WHERE i.purchase_id = $1 ORDER BY i.id`, id)
	if err != nil {
		return p, err
	}
	p.Items, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Item, error) {
		var it Item
		return it, r.Scan(&it.ID, &it.ProductID, &it.ProductName, &it.ProductSKU, &it.LotID, &it.LotNumber, &it.ExpiryDate, &it.Quantity, &it.UnitCost, &it.Subtotal, &it.Discount, &it.LotUnitCost)
	})
	return p, err
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega))
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.List(r.Context(), branch.FromContext(r.Context()).ID, Filter{
			SupplierID: httpx.QueryInt64(r, "supplier_id"), Query: q.Get("q"), From: q.Get("from"), To: q.Get("to"),
		}, pg)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, httpx.NewList(list, total, pg))
	}))
	r.Get("/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		p, err := h.svc.Get(r.Context(), branch.FromContext(r.Context()).ID, id)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, p)
	}))
	r.Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in CreateInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		p, err := h.svc.Create(r.Context(), branchID, auth.FromContext(r.Context()).UserID, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, p)
	}))
}

// normalizeLot pasa el lote a mayúsculas; vacío o ausente se guarda como NULL (sin lote).
func normalizeLot(lot *string) *string {
	if lot == nil {
		return nil
	}
	v := strings.ToUpper(strings.TrimSpace(*lot))
	if v == "" {
		return nil
	}
	return &v
}
