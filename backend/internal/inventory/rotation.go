package inventory

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
)

// maxRotationRows acota el reporte para no devolver respuestas desmedidas en rangos largos.
const maxRotationRows = 5000

// RotationRow es un movimiento del producto con su entrada/salida y el saldo resultante.
type RotationRow struct {
	ID            int64     `json:"id"`
	BranchName    string    `json:"branch_name"`
	CreatedAt     time.Time `json:"created_at"`
	Type          string    `json:"type"`
	LotNumber     *string   `json:"lot_number"`
	ReferenceType *string   `json:"reference_type"`
	ReferenceID   *int64    `json:"reference_id"`
	Document      *string   `json:"document"` // ej. "Factura N° 123456" o "Venta #368"
	UserName      string    `json:"user_name"`
	Notes         *string   `json:"notes"`
	QtyIn         int       `json:"qty_in"`
	QtyOut        int       `json:"qty_out"`
	Balance       int       `json:"balance"` // stock total del producto después del movimiento
}

// Rotation es el kardex de un producto en un rango de fechas.
type Rotation struct {
	ProductID      int64         `json:"product_id"`
	ProductName    string        `json:"product_name"`
	ProductSKU     string        `json:"product_sku"`
	Barcode        *string       `json:"barcode"`
	From           string        `json:"from"`
	To             string        `json:"to"`
	OpeningBalance int           `json:"opening_balance"` // stock al inicio del rango
	TotalIn        int           `json:"total_in"`
	TotalOut       int           `json:"total_out"`
	ClosingBalance int           `json:"closing_balance"` // stock al final del rango
	Truncated      bool          `json:"truncated"`       // true si se superó maxRotationRows (se entregan los más recientes)
	Rows           []RotationRow `json:"rows"`
}

// Rotation arma el kardex del producto: saldo inicial, cada movimiento del rango (del más reciente
// al más antiguo) con el saldo que quedó tras él, y saldo final.
// branch nil = consolidado de todas las sucursales (el saldo es el stock total de la organización).
func (s *Service) Rotation(ctx context.Context, branch *int64, productID int64, from, to string) (Rotation, error) {
	rot := Rotation{ProductID: productID, From: from, To: to, Rows: []RotationRow{}}
	err := s.pool.QueryRow(ctx, `SELECT name, sku, barcode FROM products WHERE id = $1`, productID).
		Scan(&rot.ProductName, &rot.ProductSKU, &rot.Barcode)
	if db.IsNoRows(err) {
		return rot, apperr.NotFound("Producto no encontrado")
	}
	if err != nil {
		return rot, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(quantity), 0)::int FROM stock_movements
		WHERE product_id = $1 AND created_at < $2::date AND ($3::bigint IS NULL OR branch_id = $3)`, productID, from, branch).Scan(&rot.OpeningBalance); err != nil {
		return rot, fmt.Errorf("opening balance: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT m.id, b.name, m.created_at, m.type, l.lot_number, m.reference_type, m.reference_id,
		       CASE m.reference_type
		           WHEN 'compra' THEN initcap(replace(pu.document_type, '_', ' ')) || ' N° ' || pu.document_number
		           WHEN 'venta' THEN 'Venta #' || m.reference_id
		       END,
		       u.full_name, m.notes,
		       greatest(m.quantity, 0), greatest(-m.quantity, 0),
		       $4::int + sum(m.quantity) OVER (ORDER BY m.created_at, m.id)::int
		FROM stock_movements m
		JOIN product_lots l ON l.id = m.lot_id
		JOIN users u ON u.id = m.user_id
		JOIN branches b ON b.id = m.branch_id
		LEFT JOIN purchases pu ON m.reference_type = 'compra' AND pu.id = m.reference_id
		WHERE m.product_id = $1 AND m.created_at >= $2::date AND m.created_at < $3::date + 1
		  AND ($6::bigint IS NULL OR m.branch_id = $6)
		-- El saldo (ventana) se acumula en orden cronológico; las filas se entregan de la más reciente a la más antigua.
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT $5`, productID, from, to, rot.OpeningBalance, maxRotationRows+1, branch)
	if err != nil {
		return rot, fmt.Errorf("rotation rows: %w", err)
	}
	rot.Rows, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (RotationRow, error) {
		var x RotationRow
		return x, r.Scan(&x.ID, &x.BranchName, &x.CreatedAt, &x.Type, &x.LotNumber, &x.ReferenceType, &x.ReferenceID,
			&x.Document, &x.UserName, &x.Notes, &x.QtyIn, &x.QtyOut, &x.Balance)
	})
	if err != nil {
		return rot, err
	}
	if len(rot.Rows) > maxRotationRows {
		rot.Rows, rot.Truncated = rot.Rows[:maxRotationRows], true
	}
	// Totales y saldo final se calculan sobre todo el rango (no solo las filas devueltas).
	if err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(greatest(quantity, 0)), 0)::int, coalesce(sum(greatest(-quantity, 0)), 0)::int
		FROM stock_movements
		WHERE product_id = $1 AND created_at >= $2::date AND created_at < $3::date + 1
		  AND ($4::bigint IS NULL OR branch_id = $4)`, productID, from, to, branch).
		Scan(&rot.TotalIn, &rot.TotalOut); err != nil {
		return rot, fmt.Errorf("rotation totals: %w", err)
	}
	rot.ClosingBalance = rot.OpeningBalance + rot.TotalIn - rot.TotalOut
	if rot.Rows == nil {
		rot.Rows = []RotationRow{}
	}
	return rot, nil
}

func (h *Handler) rotation(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	productID := httpx.QueryInt64(r, "product_id")
	if productID == nil || *productID <= 0 {
		return apperr.BadRequest("Debe indicar el producto (product_id)")
	}
	from, to := q.Get("from"), q.Get("to")
	f, err1 := time.Parse(time.DateOnly, from)
	t, err2 := time.Parse(time.DateOnly, to)
	if err1 != nil || err2 != nil || t.Before(f) {
		return apperr.BadRequest("Parámetros from/to inválidos (formato AAAA-MM-DD, from <= to)")
	}
	if t.Sub(f) > 366*24*time.Hour {
		return apperr.BadRequest("El rango máximo es de un año")
	}
	rot, err := h.svc.Rotation(r.Context(), branch.FromContext(r.Context()).ID, *productID, from, to)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, rot)
}
