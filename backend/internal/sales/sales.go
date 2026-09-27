// Package sales gestiona ventas (punto de venta) y sus anulaciones.
package sales

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
	"github.com/neofarma/backend/internal/platform/money"
	"github.com/neofarma/backend/internal/platform/rut"
)

type Sale struct {
	ID                 int64      `json:"id"`
	SessionID          int64      `json:"session_id"`
	UserID             int64      `json:"user_id"`
	BranchID           int64      `json:"branch_id"`
	BranchName         string     `json:"branch_name"`
	RegisterName       string     `json:"register_name"`
	UserName           string     `json:"user_name"`
	Status             string     `json:"status"`
	PaymentMethod      string     `json:"payment_method"`
	Subtotal           int64      `json:"subtotal"`
	Discount           int64      `json:"discount"`
	Total              int64      `json:"total"`
	NetAmount          int64      `json:"net_amount"`
	TaxAmount          int64      `json:"tax_amount"`
	AmountPaid         int64      `json:"amount_paid"`
	ChangeAmount       int64      `json:"change_amount"`
	CustomerRUT        *string    `json:"customer_rut"`
	CustomerName       *string    `json:"customer_name"`
	PrescriptionNumber *string    `json:"prescription_number"`
	PrescriberName     *string    `json:"prescriber_name"`
	ItemsCount         int        `json:"items_count"`
	VoidedAt           *time.Time `json:"voided_at"`
	VoidReason         *string    `json:"void_reason"`
	CreatedAt          time.Time  `json:"created_at"`
	Items              []Item     `json:"items,omitempty"`
}

type Item struct {
	ID          int64  `json:"id"`
	ProductID   int64  `json:"product_id"`
	ProductName string `json:"product_name"`
	ProductSKU  string `json:"product_sku"`
	Quantity    int    `json:"quantity"`
	UnitPrice   int64  `json:"unit_price"`
	Total       int64  `json:"total"`
	Lots        string `json:"lots"` // lotes consumidos, ej. "L123 (2), L456 (1)"
}

type ItemInput struct {
	ProductID int64 `json:"product_id" validate:"required,gt=0"`
	Quantity  int   `json:"quantity" validate:"required,gt=0,lte=10000"`
}

type CreateInput struct {
	PaymentMethod      string      `json:"payment_method" validate:"required,oneof=efectivo debito credito transferencia"`
	AmountPaid         int64       `json:"amount_paid" validate:"gte=0,lte=1000000000"`
	Discount           int64       `json:"discount" validate:"gte=0"`
	CustomerRUT        *string     `json:"customer_rut" validate:"omitempty,rut"`
	CustomerName       *string     `json:"customer_name" validate:"omitempty,max=120"`
	PrescriptionNumber *string     `json:"prescription_number" validate:"omitempty,max=60"`
	PrescriberName     *string     `json:"prescriber_name" validate:"omitempty,max=120"`
	Items              []ItemInput `json:"items" validate:"required,min=1,max=200,dive"`
}

type VoidInput struct {
	Reason string `json:"reason" validate:"required,min=5,max=500"`
}

type Filter struct {
	From, To      string
	Status        string
	PaymentMethod string
	SessionID     *int64
	UserID        *int64 // si se indica, solo ventas de ese vendedor
	BranchID      *int64 // si se indica, solo ventas de esa sucursal
	Query         string
}

// scopeFor limita lo que un usuario puede ver: el cajero solo sus propias ventas; químico y admin, todas.
func scopeFor(actor auth.Principal) *int64 {
	if actor.Role == auth.RoleCajero {
		return &actor.UserID
	}
	return nil
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type lotAlloc struct {
	lotID    int64
	lotNo    string
	qty      int
	unitCost int64
}

type line struct {
	productID int64
	name      string
	qty       int
	price     int64
	total     int64
	allocs    []lotAlloc
}

// mergeItems agrupa cantidades del mismo producto y ordena por id (orden de bloqueo consistente, evita deadlocks).
func mergeItems(items []ItemInput) []ItemInput {
	byID := map[int64]int{}
	for _, it := range items {
		byID[it.ProductID] += it.Quantity
	}
	out := make([]ItemInput, 0, len(byID))
	for id, q := range byID {
		out = append(out, ItemInput{ProductID: id, Quantity: q})
	}
	slices.SortFunc(out, func(a, b ItemInput) int { return cmp.Compare(a.ProductID, b.ProductID) })
	return out
}

// allocateFEFO reparte qty entre lotes ordenados por vencimiento. Retorna false si no alcanza.
func allocateFEFO(lots []lotAlloc, qty int) ([]lotAlloc, bool) {
	var out []lotAlloc
	for _, l := range lots {
		if qty == 0 {
			break
		}
		take := min(l.qty, qty)
		out = append(out, lotAlloc{lotID: l.lotID, lotNo: l.lotNo, qty: take, unitCost: l.unitCost})
		qty -= take
	}
	return out, qty == 0
}

// Create registra una venta en la sesión de caja abierta del usuario.
// La venta se registra en la sucursal de la caja abierta del usuario, que debe coincidir con branchID
// (la sucursal activa del request). Los lotes se descuentan solo de esa sucursal.
func (s *Service) Create(ctx context.Context, actor auth.Principal, branchID int64, in CreateInput) (Sale, error) {
	normalizeOpt(&in.CustomerName, &in.PrescriptionNumber, &in.PrescriberName)
	if in.CustomerRUT != nil {
		r := rut.Normalize(*in.CustomerRUT)
		in.CustomerRUT = &r
	}
	var saleID int64
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		// FOR SHARE: impide que la sesión se cierre mientras se registra la venta.
		var sessionID, sessionBranch int64
		var sessionBranchName string
		err := tx.QueryRow(ctx, `
			SELECT cs.id, cs.branch_id, b.name FROM cash_sessions cs JOIN branches b ON b.id = cs.branch_id
			WHERE cs.user_id = $1 AND cs.status = 'abierta' FOR SHARE OF cs`, actor.UserID).Scan(&sessionID, &sessionBranch, &sessionBranchName)
		if db.IsNoRows(err) {
			return apperr.Unprocessable("no_open_session", "Debe abrir una caja antes de vender")
		}
		if err != nil {
			return err
		}
		if sessionBranch != branchID {
			return apperr.Unprocessable("branch_mismatch",
				"Su caja abierta pertenece a la sucursal "+sessionBranchName+": cambie a esa sucursal para vender")
		}

		var lines []line
		needsRx := false
		for _, it := range mergeItems(in.Items) {
			var ln line
			var active bool
			var cond string
			err := tx.QueryRow(ctx, `SELECT name, price, active, sale_condition FROM products WHERE id = $1`, it.ProductID).
				Scan(&ln.name, &ln.price, &active, &cond)
			if db.IsNoRows(err) || (err == nil && !active) {
				return apperr.Unprocessable("invalid_product", fmt.Sprintf("El producto %d no existe o está inactivo", it.ProductID))
			}
			if err != nil {
				return err
			}
			if cond == "receta_retenida" || cond == "receta_cheque" {
				needsRx = true
			}
			rows, err := tx.Query(ctx, `
				SELECT id, coalesce(lot_number, 'S/L'), qty_available, unit_cost FROM product_lots
				WHERE product_id = $1 AND branch_id = $2 AND qty_available > 0 AND expiry_date >= current_date
				ORDER BY expiry_date, id FOR UPDATE`, it.ProductID, branchID)
			if err != nil {
				return err
			}
			lots, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (lotAlloc, error) {
				var l lotAlloc
				return l, r.Scan(&l.lotID, &l.lotNo, &l.qty, &l.unitCost)
			})
			if err != nil {
				return err
			}
			allocs, ok := allocateFEFO(lots, it.Quantity)
			if !ok {
				available := 0
				for _, l := range lots {
					available += l.qty
				}
				return apperr.Unprocessable("insufficient_stock",
					fmt.Sprintf("Stock insuficiente para %s: disponible %d, solicitado %d", ln.name, available, it.Quantity)).
					WithDetails(map[string]any{"product_id": it.ProductID, "available": available, "requested": it.Quantity})
			}
			ln.productID, ln.qty, ln.allocs = it.ProductID, it.Quantity, allocs
			ln.total = int64(it.Quantity) * ln.price
			lines = append(lines, ln)
		}

		if needsRx && (in.PrescriptionNumber == nil || in.PrescriberName == nil) {
			return apperr.Unprocessable("prescription_required",
				"La venta incluye productos con receta retenida/cheque: indique N° de receta y nombre del médico")
		}

		var subtotal int64
		for _, ln := range lines {
			subtotal += ln.total
		}
		if in.Discount > subtotal {
			return apperr.Unprocessable("invalid_discount", "El descuento no puede superar el subtotal")
		}
		total := subtotal - in.Discount
		net, tax := money.SplitGross(total)
		paid, change := total, int64(0)
		if in.PaymentMethod == "efectivo" {
			if in.AmountPaid < total {
				return apperr.Unprocessable("insufficient_payment", "El monto recibido es menor al total")
			}
			paid, change = in.AmountPaid, in.AmountPaid-total
		}

		err = tx.QueryRow(ctx, `
			INSERT INTO sales (branch_id, session_id, user_id, payment_method, subtotal, discount, total, net_amount, tax_amount,
			                   amount_paid, change_amount, customer_rut, customer_name, prescription_number, prescriber_name)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
			branchID, sessionID, actor.UserID, in.PaymentMethod, subtotal, in.Discount, total, net, tax, paid, change,
			in.CustomerRUT, in.CustomerName, in.PrescriptionNumber, in.PrescriberName).Scan(&saleID)
		if err != nil {
			return fmt.Errorf("insert sale: %w", err)
		}

		for _, ln := range lines {
			var costSum int64
			for _, a := range ln.allocs {
				costSum += int64(a.qty) * a.unitCost
			}
			var itemID int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO sale_items (branch_id, sale_id, product_id, quantity, unit_price, unit_cost, total)
				VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
				branchID, saleID, ln.productID, ln.qty, ln.price, costSum/int64(ln.qty), ln.total).Scan(&itemID); err != nil {
				return fmt.Errorf("insert sale item: %w", err)
			}
			for _, a := range ln.allocs {
				if _, err := tx.Exec(ctx, `UPDATE product_lots SET qty_available = qty_available - $2 WHERE id = $1 AND branch_id = $3`, a.lotID, a.qty, branchID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `INSERT INTO sale_item_lots (branch_id, sale_item_id, lot_id, quantity) VALUES ($1,$2,$3,$4)`, branchID, itemID, a.lotID, a.qty); err != nil {
					return err
				}
				if err := inventory.Record(ctx, tx, branchID, ln.productID, a.lotID, inventory.MovVenta, -a.qty, "venta", saleID, actor.UserID, nil); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return Sale{}, err
	}
	return s.Get(ctx, &branchID, saleID)
}

// Void anula una venta de una sesión aún abierta y devuelve el stock a los lotes originales.
// Void anula una venta de la sucursal indicada; una venta de otra sucursal se trata como inexistente.
func (s *Service) Void(ctx context.Context, actor auth.Principal, branchID, id int64, in VoidInput) (Sale, error) {
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var status, sessionStatus string
		err := tx.QueryRow(ctx, `
			SELECT s.status, cs.status FROM sales s JOIN cash_sessions cs ON cs.id = s.session_id
			WHERE s.id = $1 AND s.branch_id = $2 FOR UPDATE OF s`, id, branchID).Scan(&status, &sessionStatus)
		if db.IsNoRows(err) {
			return apperr.NotFound("Venta no encontrada")
		}
		if err != nil {
			return err
		}
		if status == "anulada" {
			return apperr.Unprocessable("already_voided", "La venta ya está anulada")
		}
		if sessionStatus != "abierta" {
			return apperr.Unprocessable("session_closed", "No se puede anular una venta de una caja ya cerrada")
		}
		rows, err := tx.Query(ctx, `
			SELECT si.product_id, sil.lot_id, sil.quantity
			FROM sale_items si JOIN sale_item_lots sil ON sil.sale_item_id = si.id
			WHERE si.sale_id = $1 ORDER BY sil.lot_id`, id)
		if err != nil {
			return err
		}
		type restore struct {
			productID, lotID int64
			qty              int
		}
		items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (restore, error) {
			var x restore
			return x, r.Scan(&x.productID, &x.lotID, &x.qty)
		})
		if err != nil {
			return err
		}
		for _, x := range items {
			if _, err := tx.Exec(ctx, `UPDATE product_lots SET qty_available = qty_available + $2 WHERE id = $1 AND branch_id = $3`, x.lotID, x.qty, branchID); err != nil {
				return err
			}
			if err := inventory.Record(ctx, tx, branchID, x.productID, x.lotID, inventory.MovAnulacionVenta, x.qty, "venta", id, actor.UserID, nil); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE sales SET status = 'anulada', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
			id, actor.UserID, strings.TrimSpace(in.Reason))
		return err
	})
	if err != nil {
		return Sale{}, err
	}
	return s.Get(ctx, &branchID, id)
}

const selectSQL = `
	SELECT s.id, s.session_id, s.user_id, s.branch_id, b.name, r.name, u.full_name, s.status, s.payment_method, s.subtotal, s.discount, s.total,
	       s.net_amount, s.tax_amount, s.amount_paid, s.change_amount, s.customer_rut, s.customer_name,
	       s.prescription_number, s.prescriber_name,
	       (SELECT coalesce(sum(quantity), 0) FROM sale_items WHERE sale_id = s.id)::int,
	       s.voided_at, s.void_reason, s.created_at
	FROM sales s
	JOIN cash_sessions cs ON cs.id = s.session_id
	JOIN cash_registers r ON r.id = cs.register_id
	JOIN branches b ON b.id = s.branch_id
	JOIN users u ON u.id = s.user_id`

func scan(r pgx.Row) (Sale, error) {
	var s Sale
	err := r.Scan(&s.ID, &s.SessionID, &s.UserID, &s.BranchID, &s.BranchName, &s.RegisterName, &s.UserName, &s.Status, &s.PaymentMethod, &s.Subtotal, &s.Discount,
		&s.Total, &s.NetAmount, &s.TaxAmount, &s.AmountPaid, &s.ChangeAmount, &s.CustomerRUT, &s.CustomerName,
		&s.PrescriptionNumber, &s.PrescriberName, &s.ItemsCount, &s.VoidedAt, &s.VoidReason, &s.CreatedAt)
	return s, err
}

// Get retorna la venta si pertenece a la sucursal indicada (nil = cualquiera); si no, 404.
func (s *Service) Get(ctx context.Context, branch *int64, id int64) (Sale, error) {
	sale, err := scan(s.pool.QueryRow(ctx, selectSQL+` WHERE s.id = $1 AND ($2::bigint IS NULL OR s.branch_id = $2)`, id, branch))
	if db.IsNoRows(err) {
		return sale, apperr.NotFound("Venta no encontrada")
	}
	if err != nil {
		return sale, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT si.id, si.product_id, p.name, p.sku, si.quantity, si.unit_price, si.total,
		       coalesce(string_agg(coalesce(l.lot_number, 'S/L') || ' (' || sil.quantity || ')', ', ' ORDER BY l.expiry_date), '')
		FROM sale_items si
		JOIN products p ON p.id = si.product_id
		LEFT JOIN sale_item_lots sil ON sil.sale_item_id = si.id
		LEFT JOIN product_lots l ON l.id = sil.lot_id
		WHERE si.sale_id = $1
		GROUP BY si.id, p.name, p.sku ORDER BY si.id`, id)
	if err != nil {
		return sale, err
	}
	sale.Items, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Item, error) {
		var it Item
		return it, r.Scan(&it.ID, &it.ProductID, &it.ProductName, &it.ProductSKU, &it.Quantity, &it.UnitPrice, &it.Total, &it.Lots)
	})
	return sale, err
}

func (s *Service) List(ctx context.Context, f Filter, pg httpx.Page) ([]Sale, int, error) {
	cond := `($1 = '' OR s.created_at >= $1::date)
		AND ($2 = '' OR s.created_at < $2::date + 1)
		AND ($3 = '' OR s.status = $3)
		AND ($4 = '' OR s.payment_method = $4)
		AND ($5::bigint IS NULL OR s.session_id = $5)
		AND ($6 = '' OR s.id::text = $6 OR s.customer_name ILIKE '%' || $6 || '%' OR s.customer_rut ILIKE $6 || '%')
		AND ($7::bigint IS NULL OR s.user_id = $7)
		AND ($8::bigint IS NULL OR s.branch_id = $8)`
	args := []any{f.From, f.To, f.Status, f.PaymentMethod, f.SessionID, strings.TrimSpace(f.Query), f.UserID, f.BranchID}
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM sales s WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count sales: %w", err)
	}
	rows, err := s.pool.Query(ctx, selectSQL+` WHERE `+cond+` ORDER BY s.created_at DESC, s.id DESC LIMIT $9 OFFSET $10`,
		append(args, pg.PageSize, pg.Offset())...)
	if err != nil {
		return nil, 0, fmt.Errorf("list sales: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Sale, error) { return scan(r) })
	return list, total, err
}

func normalizeOpt(ps ...**string) {
	for _, p := range ps {
		if *p != nil {
			v := strings.TrimSpace(**p)
			if v == "" {
				*p = nil
			} else {
				*p = &v
			}
		}
	}
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleCajero))
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.List(r.Context(), Filter{
			From: q.Get("from"), To: q.Get("to"), Status: q.Get("status"), PaymentMethod: q.Get("payment_method"),
			SessionID: httpx.QueryInt64(r, "session_id"), Query: q.Get("q"),
			// El alcance por rol lo impone el servidor; no depende de parámetros de la URL.
			UserID:   scopeFor(auth.FromContext(r.Context())),
			BranchID: branch.FromContext(r.Context()).ID,
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
		sale, err := h.svc.Get(r.Context(), branch.FromContext(r.Context()).ID, id)
		if err != nil {
			return err
		}
		// Un cajero no puede consultar ventas ajenas; se responde 404 para no revelar que existen.
		if uid := scopeFor(auth.FromContext(r.Context())); uid != nil && sale.UserID != *uid {
			return apperr.NotFound("Venta no encontrada")
		}
		return httpx.JSON(w, http.StatusOK, sale)
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
		sale, err := h.svc.Create(r.Context(), auth.FromContext(r.Context()), branchID, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, sale)
	}))
	// Anular requiere supervisor (químico farmacéutico o admin).
	r.With(auth.RequireRoles(auth.RoleQuimico)).Post("/{id}/void", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		var in VoidInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		sale, err := h.svc.Void(r.Context(), auth.FromContext(r.Context()), branchID, id, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, sale)
	}))
}
