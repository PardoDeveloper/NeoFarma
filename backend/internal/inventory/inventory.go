// Package inventory gestiona lotes, el ledger de movimientos de stock y ajustes de inventario.
package inventory

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
)

// Tipos de movimiento de stock.
const (
	MovCompra          = "compra"
	MovVenta           = "venta"
	MovAnulacionVenta  = "anulacion_venta"
	MovAjustePositivo  = "ajuste_positivo"
	MovAjusteNegativo  = "ajuste_negativo"
	MovMerma           = "merma"
	MovTraspasoSalida  = "traspaso_salida"
	MovTraspasoEntrada = "traspaso_entrada"
)

// Movement es una entrada del ledger. Quantity lleva signo (+ entra, - sale).
type Movement struct {
	ID            int64     `json:"id"`
	ProductID     int64     `json:"product_id"`
	ProductName   string    `json:"product_name"`
	BranchID      int64     `json:"branch_id"`
	BranchName    string    `json:"branch_name"`
	LotID         int64     `json:"lot_id"`
	LotNumber     *string   `json:"lot_number"`
	Type          string    `json:"type"`
	Quantity      int       `json:"quantity"`
	ReferenceType *string   `json:"reference_type"`
	ReferenceID   *int64    `json:"reference_id"`
	UserName      string    `json:"user_name"`
	Notes         *string   `json:"notes"`
	CreatedAt     time.Time `json:"created_at"`
}

// Record inserta un movimiento en el ledger dentro de la transacción dada. branchID debe ser la sucursal
// del lote: la FK compuesta (lot_id, branch_id) rechaza cualquier movimiento cruzado entre sucursales.
func Record(ctx context.Context, q db.DBTX, branchID, productID, lotID int64, typ string, qty int, refType string, refID int64, userID int64, notes *string) error {
	var rt *string
	var rid *int64
	if refType != "" {
		rt, rid = &refType, &refID
	}
	_, err := q.Exec(ctx, `
		INSERT INTO stock_movements (branch_id, product_id, lot_id, type, quantity, reference_type, reference_id, user_id, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, branchID, productID, lotID, typ, qty, rt, rid, userID, notes)
	if err != nil {
		return fmt.Errorf("record stock movement: %w", err)
	}
	return nil
}

// LotView es un lote con datos del producto, para listados de inventario.
type LotView struct {
	ID           int64     `json:"id"`
	BranchID     int64     `json:"branch_id"`
	BranchName   string    `json:"branch_name"`
	ProductID    int64     `json:"product_id"`
	ProductName  string    `json:"product_name"`
	ProductSKU   string    `json:"product_sku"`
	Laboratory   *string   `json:"laboratory"`
	LotNumber    *string   `json:"lot_number"`
	ExpiryDate   time.Time `json:"expiry_date"`
	DaysToExpiry int       `json:"days_to_expiry"`
	QtyInitial   int       `json:"qty_initial"`
	QtyAvailable int       `json:"qty_available"`
	UnitCost     int64     `json:"unit_cost"`
	StockValue   int64     `json:"stock_value"`
	ExpiryStatus string    `json:"expiry_status"` // vencido | critico (<=30d) | proximo (<=90d) | vigente
	SupplierName *string   `json:"supplier_name"`
	ReceivedAt   time.Time `json:"received_at"`
}

type LotFilter struct {
	ProductID    *int64
	Query        string
	ExpiringDays *int // lotes que vencen dentro de N días (incluye vencidos)
	OnlyExpired  bool
}

type AdjustmentInput struct {
	LotID    int64  `json:"lot_id" validate:"required,gt=0"`
	Type     string `json:"type" validate:"required,oneof=ajuste_positivo ajuste_negativo merma"`
	Quantity int    `json:"quantity" validate:"required,gt=0,lte=100000"`
	Notes    string `json:"notes" validate:"required,min=3,max=500"`
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ListLots lista lotes con stock de la sucursal (branch nil = todas las sucursales).
func (s *Service) ListLots(ctx context.Context, branch *int64, f LotFilter, pg httpx.Page) ([]LotView, int, error) {
	args := []any{branch}
	where := []string{"l.qty_available > 0", "($1::bigint IS NULL OR l.branch_id = $1)"}
	if f.ProductID != nil {
		args = append(args, *f.ProductID)
		where = append(where, fmt.Sprintf("l.product_id = $%d", len(args)))
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		args = append(args, "%"+q+"%")
		where = append(where, fmt.Sprintf("(p.name ILIKE $%[1]d OR p.sku ILIKE $%[1]d OR l.lot_number ILIKE $%[1]d)", len(args)))
	}
	if f.OnlyExpired {
		where = append(where, "l.expiry_date < current_date")
	} else if f.ExpiringDays != nil {
		args = append(args, *f.ExpiringDays)
		where = append(where, fmt.Sprintf("l.expiry_date <= current_date + $%d::int", len(args)))
	}
	cond := strings.Join(where, " AND ")

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM product_lots l JOIN products p ON p.id = l.product_id WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count lots: %w", err)
	}
	args = append(args, pg.PageSize, pg.Offset())
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.branch_id, b.name, p.id, p.name, p.sku, p.laboratory, l.lot_number, l.expiry_date,
		       (l.expiry_date - current_date)::int, l.qty_initial, l.qty_available, l.unit_cost,
		       l.qty_available::bigint * l.unit_cost,
		       CASE WHEN l.expiry_date < current_date THEN 'vencido'
		            WHEN l.expiry_date <= current_date + 30 THEN 'critico'
		            WHEN l.expiry_date <= current_date + 90 THEN 'proximo'
		            ELSE 'vigente' END,
		       sp.business_name, l.created_at
		FROM product_lots l
		JOIN products p ON p.id = l.product_id
		JOIN branches b ON b.id = l.branch_id
		LEFT JOIN purchases pu ON pu.id = l.purchase_id
		LEFT JOIN suppliers sp ON sp.id = pu.supplier_id
		WHERE `+cond+fmt.Sprintf(` ORDER BY l.expiry_date, p.name LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list lots: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (LotView, error) {
		var l LotView
		return l, r.Scan(&l.ID, &l.BranchID, &l.BranchName, &l.ProductID, &l.ProductName, &l.ProductSKU, &l.Laboratory, &l.LotNumber, &l.ExpiryDate,
			&l.DaysToExpiry, &l.QtyInitial, &l.QtyAvailable, &l.UnitCost, &l.StockValue, &l.ExpiryStatus, &l.SupplierName, &l.ReceivedAt)
	})
	return list, total, err
}

// ListMovements lista el ledger de la sucursal (branch nil = todas).
func (s *Service) ListMovements(ctx context.Context, branch *int64, productID *int64, typ string, pg httpx.Page) ([]Movement, int, error) {
	args := []any{productID, typ, branch}
	cond := `($1::bigint IS NULL OR m.product_id = $1) AND ($2 = '' OR m.type = $2) AND ($3::bigint IS NULL OR m.branch_id = $3)`
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM stock_movements m WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count movements: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT m.id, m.product_id, p.name, m.branch_id, b.name, m.lot_id, l.lot_number, m.type, m.quantity,
		       m.reference_type, m.reference_id, u.full_name, m.notes, m.created_at
		FROM stock_movements m
		JOIN products p ON p.id = m.product_id
		JOIN product_lots l ON l.id = m.lot_id
		JOIN users u ON u.id = m.user_id
		JOIN branches b ON b.id = m.branch_id
		WHERE `+cond+` ORDER BY m.created_at DESC, m.id DESC LIMIT $4 OFFSET $5`,
		productID, typ, branch, pg.PageSize, pg.Offset())
	if err != nil {
		return nil, 0, fmt.Errorf("list movements: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Movement, error) {
		var m Movement
		return m, r.Scan(&m.ID, &m.ProductID, &m.ProductName, &m.BranchID, &m.BranchName, &m.LotID, &m.LotNumber, &m.Type, &m.Quantity,
			&m.ReferenceType, &m.ReferenceID, &m.UserName, &m.Notes, &m.CreatedAt)
	})
	return list, total, err
}

// Adjust aplica un ajuste de inventario o merma sobre un lote de la sucursal indicada.
// Un lote de otra sucursal se trata como inexistente.
func (s *Service) Adjust(ctx context.Context, branchID, userID int64, in AdjustmentInput) error {
	return db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var productID int64
		var available int
		err := tx.QueryRow(ctx, `SELECT product_id, qty_available FROM product_lots WHERE id = $1 AND branch_id = $2 FOR UPDATE`, in.LotID, branchID).
			Scan(&productID, &available)
		if db.IsNoRows(err) {
			return apperr.NotFound("Lote no encontrado")
		}
		if err != nil {
			return err
		}
		delta := in.Quantity
		if in.Type != MovAjustePositivo {
			delta = -in.Quantity
			if in.Quantity > available {
				return apperr.Unprocessable("insufficient_stock",
					"El lote solo tiene "+strconv.Itoa(available)+" unidades disponibles")
			}
		}
		// qty_initial se amplía si un ajuste positivo supera lo recibido, para mantener consistencia.
		if _, err := tx.Exec(ctx, `
			UPDATE product_lots SET qty_available = qty_available + $2,
			       qty_initial = greatest(qty_initial, qty_available + $2)
			WHERE id = $1`, in.LotID, delta); err != nil {
			return err
		}
		notes := strings.TrimSpace(in.Notes)
		return Record(ctx, tx, branchID, productID, in.LotID, in.Type, delta, "", 0, userID, &notes)
	})
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	// Inventario (lotes, movimientos, ajustes): químico, bodega y admin. El cajero no accede.
	r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega))
	r.Get("/lots", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		f := LotFilter{ProductID: httpx.QueryInt64(r, "product_id"), Query: q.Get("q"), OnlyExpired: q.Get("expired") == "true"}
		if d, err := strconv.Atoi(q.Get("expiring_days")); err == nil && d >= 0 {
			f.ExpiringDays = &d
		}
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.ListLots(r.Context(), branch.FromContext(r.Context()).ID, f, pg)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, httpx.NewList(list, total, pg))
	}))
	// Rotación de productos (kardex con saldo): solo administrador.
	r.With(auth.RequireRoles()).Get("/rotation", httpx.Handle(h.rotation))
	r.Get("/movements", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.ListMovements(r.Context(), branch.FromContext(r.Context()).ID, httpx.QueryInt64(r, "product_id"), r.URL.Query().Get("type"), pg)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, httpx.NewList(list, total, pg))
	}))
	r.Post("/adjustments", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in AdjustmentInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		if err := h.svc.Adjust(r.Context(), branchID, auth.FromContext(r.Context()).UserID, in); err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusNoContent, nil)
	}))
}
