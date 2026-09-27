// Package transfers gestiona los traspasos de stock entre sucursales.
//
// Un traspaso es inmediato y atómico: descuenta los lotes de origen y crea en destino lotes equivalentes
// (mismo N° de lote, vencimiento y costo), registrando traspaso_salida / traspaso_entrada en el ledger.
// El stock total de la organización no cambia.
package transfers

import (
	"cmp"
	"context"
	"fmt"
	"net/http"
	"slices"
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
)

type Transfer struct {
	ID             int64     `json:"id"`
	FromBranchID   int64     `json:"from_branch_id"`
	FromBranchName string    `json:"from_branch_name"`
	ToBranchID     int64     `json:"to_branch_id"`
	ToBranchName   string    `json:"to_branch_name"`
	UserName       string    `json:"user_name"`
	Notes          *string   `json:"notes"`
	ItemsCount     int       `json:"items_count"`
	UnitsCount     int       `json:"units_count"`
	CreatedAt      time.Time `json:"created_at"`
	Items          []Item    `json:"items,omitempty"`
}

type Item struct {
	ProductID   int64     `json:"product_id"`
	ProductName string    `json:"product_name"`
	ProductSKU  string    `json:"product_sku"`
	LotNumber   *string   `json:"lot_number"`
	ExpiryDate  time.Time `json:"expiry_date"`
	Quantity    int       `json:"quantity"`
	FromLotID   int64     `json:"from_lot_id"`
	ToLotID     int64     `json:"to_lot_id"`
}

type ItemInput struct {
	LotID    int64 `json:"lot_id" validate:"required,gt=0"`
	Quantity int   `json:"quantity" validate:"required,gt=0,lte=100000"`
}

type CreateInput struct {
	ToBranchID int64       `json:"to_branch_id" validate:"required,gt=0"`
	Notes      *string     `json:"notes" validate:"omitempty,max=500"`
	Items      []ItemInput `json:"items" validate:"required,min=1,max=200,dive"`
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type srcLot struct {
	productID int64
	lotNumber *string
	expiry    time.Time
	available int
	unitCost  int64
	expired   bool
}

// Create traspasa unidades de lotes de fromBranch a in.ToBranchID en una transacción.
func (s *Service) Create(ctx context.Context, fromBranch, userID int64, in CreateInput) (Transfer, error) {
	if in.ToBranchID == fromBranch {
		return Transfer{}, apperr.Unprocessable("same_branch", "La sucursal de destino debe ser distinta a la de origen")
	}
	seen := map[int64]bool{}
	for i, it := range in.Items {
		if seen[it.LotID] {
			return Transfer{}, apperr.Unprocessable("duplicate_lot", fmt.Sprintf("La línea %d repite un lote ya incluido", i+1))
		}
		seen[it.LotID] = true
	}
	if in.Notes != nil {
		n := strings.TrimSpace(*in.Notes)
		in.Notes = &n
		if n == "" {
			in.Notes = nil
		}
	}
	// Bloqueo en orden de id de lote: dos traspasos concurrentes no pueden entrar en deadlock.
	items := slices.Clone(in.Items)
	slices.SortFunc(items, func(a, b ItemInput) int { return cmp.Compare(a.LotID, b.LotID) })

	var id int64
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var toActive bool
		err := tx.QueryRow(ctx, `SELECT active FROM branches WHERE id = $1`, in.ToBranchID).Scan(&toActive)
		if db.IsNoRows(err) || (err == nil && !toActive) {
			return apperr.Unprocessable("invalid_branch", "La sucursal de destino no existe o está inactiva")
		}
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO transfers (from_branch_id, to_branch_id, user_id, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
			fromBranch, in.ToBranchID, userID, in.Notes).Scan(&id); err != nil {
			return fmt.Errorf("insert transfer: %w", err)
		}
		for _, it := range items {
			var l srcLot
			// Solo lotes de la sucursal de origen: un lote de otra sucursal se trata como inexistente.
			err := tx.QueryRow(ctx, `
				SELECT product_id, lot_number, expiry_date, qty_available, unit_cost, expiry_date < current_date
				FROM product_lots WHERE id = $1 AND branch_id = $2 FOR UPDATE`, it.LotID, fromBranch).
				Scan(&l.productID, &l.lotNumber, &l.expiry, &l.available, &l.unitCost, &l.expired)
			if db.IsNoRows(err) {
				return apperr.NotFound(fmt.Sprintf("El lote %d no existe en la sucursal de origen", it.LotID))
			}
			if err != nil {
				return err
			}
			if l.expired {
				return apperr.Unprocessable("expired_lot", fmt.Sprintf("El lote %d está vencido: regístrelo como merma en vez de traspasarlo", it.LotID))
			}
			if it.Quantity > l.available {
				return apperr.Unprocessable("insufficient_stock",
					fmt.Sprintf("El lote %d solo tiene %d unidades disponibles", it.LotID, l.available)).
					WithDetails(map[string]any{"lot_id": it.LotID, "available": l.available, "requested": it.Quantity})
			}
			if _, err := tx.Exec(ctx, `UPDATE product_lots SET qty_available = qty_available - $2 WHERE id = $1 AND branch_id = $3`,
				it.LotID, it.Quantity, fromBranch); err != nil {
				return err
			}
			var toLot int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO product_lots (branch_id, product_id, lot_number, expiry_date, qty_initial, qty_available, unit_cost)
				VALUES ($1,$2,$3,$4,$5,$5,$6) RETURNING id`,
				in.ToBranchID, l.productID, l.lotNumber, l.expiry, it.Quantity, l.unitCost).Scan(&toLot); err != nil {
				return fmt.Errorf("insert destination lot: %w", err)
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO transfer_items (transfer_id, from_branch_id, to_branch_id, product_id, from_lot_id, to_lot_id, quantity)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, fromBranch, in.ToBranchID, l.productID, it.LotID, toLot, it.Quantity); err != nil {
				return fmt.Errorf("insert transfer item: %w", err)
			}
			if err := inventory.Record(ctx, tx, fromBranch, l.productID, it.LotID, inventory.MovTraspasoSalida, -it.Quantity, "traspaso", id, userID, in.Notes); err != nil {
				return err
			}
			if err := inventory.Record(ctx, tx, in.ToBranchID, l.productID, toLot, inventory.MovTraspasoEntrada, it.Quantity, "traspaso", id, userID, in.Notes); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return Transfer{}, err
	}
	return s.Get(ctx, &fromBranch, id)
}

const selectSQL = `
	SELECT t.id, t.from_branch_id, fb.name, t.to_branch_id, tb.name, u.full_name, t.notes,
	       (SELECT count(*) FROM transfer_items WHERE transfer_id = t.id)::int,
	       (SELECT coalesce(sum(quantity), 0) FROM transfer_items WHERE transfer_id = t.id)::int,
	       t.created_at
	FROM transfers t
	JOIN branches fb ON fb.id = t.from_branch_id
	JOIN branches tb ON tb.id = t.to_branch_id
	JOIN users u ON u.id = t.user_id`

// visible: el traspaso involucra a la sucursal (como origen o destino); branch nil = todas.
const visible = `($1::bigint IS NULL OR t.from_branch_id = $1 OR t.to_branch_id = $1)`

func scan(r pgx.Row) (Transfer, error) {
	var t Transfer
	err := r.Scan(&t.ID, &t.FromBranchID, &t.FromBranchName, &t.ToBranchID, &t.ToBranchName, &t.UserName, &t.Notes,
		&t.ItemsCount, &t.UnitsCount, &t.CreatedAt)
	return t, err
}

// List lista los traspasos enviados o recibidos por la sucursal (nil = todas).
func (s *Service) List(ctx context.Context, branch *int64, pg httpx.Page) ([]Transfer, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM transfers t WHERE `+visible, branch).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, selectSQL+` WHERE `+visible+` ORDER BY t.created_at DESC, t.id DESC LIMIT $2 OFFSET $3`,
		branch, pg.PageSize, pg.Offset())
	if err != nil {
		return nil, 0, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Transfer, error) { return scan(r) })
	return list, total, err
}

// Get retorna el traspaso si involucra a la sucursal indicada (nil = cualquiera); si no, 404.
func (s *Service) Get(ctx context.Context, branch *int64, id int64) (Transfer, error) {
	t, err := scan(s.pool.QueryRow(ctx, selectSQL+` WHERE t.id = $2 AND `+visible, branch, id))
	if db.IsNoRows(err) {
		return t, apperr.NotFound("Traspaso no encontrado")
	}
	if err != nil {
		return t, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT ti.product_id, p.name, p.sku, l.lot_number, l.expiry_date, ti.quantity, ti.from_lot_id, ti.to_lot_id
		FROM transfer_items ti
		JOIN products p ON p.id = ti.product_id
		JOIN product_lots l ON l.id = ti.from_lot_id
		WHERE ti.transfer_id = $1 ORDER BY ti.id`, id)
	if err != nil {
		return t, err
	}
	t.Items, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Item, error) {
		var it Item
		return it, r.Scan(&it.ProductID, &it.ProductName, &it.ProductSKU, &it.LotNumber, &it.ExpiryDate, &it.Quantity, &it.FromLotID, &it.ToLotID)
	})
	return t, err
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega))
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.List(r.Context(), branch.FromContext(r.Context()).ID, pg)
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
		t, err := h.svc.Get(r.Context(), branch.FromContext(r.Context()).ID, id)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, t)
	}))
	r.Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		from, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		var in CreateInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		t, err := h.svc.Create(r.Context(), from, auth.FromContext(r.Context()).UserID, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, t)
	}))
}
