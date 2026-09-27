package reports

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/httpx"
)

// SellerCommission resume las comisiones de un vendedor en el período (solo ventas completadas).
type SellerCommission struct {
	UserID          int64  `json:"user_id"`
	UserName        string `json:"user_name"`
	Role            string `json:"role"`
	CurrentBps      int    `json:"current_bps"` // tasa vigente hoy (las ventas conservan la tasa con que se hicieron)
	SalesCount      int    `json:"sales_count"`
	NetTotal        int64  `json:"net_total"`
	CommissionTotal int64  `json:"commission_total"`
	VoidedCount     int    `json:"voided_count"` // ventas anuladas: no generan comisión
}

type CommissionReport struct {
	From            string             `json:"from"`
	To              string             `json:"to"`
	NetTotal        int64              `json:"net_total"`
	CommissionTotal int64              `json:"commission_total"`
	Sellers         []SellerCommission `json:"sellers"`
}

// CommissionSale es una venta con su comisión (detalle por vendedor).
type CommissionSale struct {
	SaleID     int64     `json:"sale_id"`
	CreatedAt  time.Time `json:"created_at"`
	BranchName string    `json:"branch_name"`
	Status     string    `json:"status"`
	Total      int64     `json:"total"`
	NetAmount  int64     `json:"net_amount"`
	Bps        int       `json:"commission_bps"`
	Commission int64     `json:"commission_amount"` // 0 efectivo si la venta está anulada
}

// Commissions agrupa por vendedor las comisiones del período en la sucursal (nil = todas).
func (s *Service) Commissions(ctx context.Context, branch *int64, from, to string) (CommissionReport, error) {
	rep := CommissionReport{From: from, To: to}
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.full_name, u.role, u.commission_bps,
		       count(s.id) FILTER (WHERE s.status = 'completada')::int,
		       coalesce(sum(s.net_amount) FILTER (WHERE s.status = 'completada'), 0),
		       coalesce(sum(s.commission_amount) FILTER (WHERE s.status = 'completada'), 0),
		       count(s.id) FILTER (WHERE s.status = 'anulada')::int
		FROM users u
		LEFT JOIN sales s ON s.user_id = u.id AND s.created_at >= $1::date AND s.created_at < $2::date + 1
		                 AND ($3::bigint IS NULL OR s.branch_id = $3)
		GROUP BY u.id
		-- Vendedores con ventas en el período, o con tasa asignada (aunque no hayan vendido).
		HAVING count(s.id) > 0 OR u.commission_bps > 0
		ORDER BY 7 DESC, u.full_name`, from, to, branch)
	if err != nil {
		return rep, fmt.Errorf("commissions: %w", err)
	}
	rep.Sellers, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (SellerCommission, error) {
		var c SellerCommission
		return c, r.Scan(&c.UserID, &c.UserName, &c.Role, &c.CurrentBps, &c.SalesCount, &c.NetTotal, &c.CommissionTotal, &c.VoidedCount)
	})
	if err != nil {
		return rep, err
	}
	nonNil(&rep.Sellers)
	for _, c := range rep.Sellers {
		rep.NetTotal += c.NetTotal
		rep.CommissionTotal += c.CommissionTotal
	}
	return rep, nil
}

// CommissionDetail lista las ventas de un vendedor en el período con su comisión.
func (s *Service) CommissionDetail(ctx context.Context, branch *int64, userID int64, from, to string) ([]CommissionSale, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.created_at, b.name, s.status, s.total, s.net_amount, s.commission_bps,
		       CASE WHEN s.status = 'completada' THEN s.commission_amount ELSE 0 END
		FROM sales s JOIN branches b ON b.id = s.branch_id
		WHERE s.user_id = $1 AND s.created_at >= $2::date AND s.created_at < $3::date + 1
		  AND ($4::bigint IS NULL OR s.branch_id = $4)
		ORDER BY s.created_at DESC, s.id DESC
		LIMIT 2000`, userID, from, to, branch)
	if err != nil {
		return nil, fmt.Errorf("commission detail: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (CommissionSale, error) {
		var c CommissionSale
		return c, r.Scan(&c.SaleID, &c.CreatedAt, &c.BranchName, &c.Status, &c.Total, &c.NetAmount, &c.Bps, &c.Commission)
	})
	nonNil(&list)
	return list, err
}

// ownCommission retorna la comisión del usuario hoy y en el mes (ventas completadas), y su tasa vigente.
func (s *Service) ownCommission(ctx context.Context, branch *int64, userID int64) (today, month int64, bps int, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(s.commission_amount) FILTER (WHERE s.created_at >= current_date), 0),
		       coalesce(sum(s.commission_amount), 0),
		       (SELECT commission_bps FROM users WHERE id = $1)
		FROM sales s
		WHERE s.user_id = $1 AND s.status = 'completada' AND s.created_at >= date_trunc('month', current_date)
		  AND ($2::bigint IS NULL OR s.branch_id = $2)`, userID, branch).Scan(&today, &month, &bps)
	return today, month, bps, err
}

// parseRange valida from/to (AAAA-MM-DD, máx. un año).
func parseRange(r *http.Request) (string, string, error) {
	q := r.URL.Query()
	from, to := q.Get("from"), q.Get("to")
	f, err1 := time.Parse(time.DateOnly, from)
	t, err2 := time.Parse(time.DateOnly, to)
	if err1 != nil || err2 != nil || t.Before(f) {
		return "", "", apperr.BadRequest("Parámetros from/to inválidos (formato AAAA-MM-DD, from <= to)")
	}
	if t.Sub(f) > 366*24*time.Hour {
		return "", "", apperr.BadRequest("El rango máximo es de un año")
	}
	return from, to, nil
}

func (h *Handler) commissions(w http.ResponseWriter, r *http.Request) error {
	from, to, err := parseRange(r)
	if err != nil {
		return err
	}
	rep, err := h.svc.Commissions(r.Context(), branch.FromContext(r.Context()).ID, from, to)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, rep)
}

func (h *Handler) commissionDetail(w http.ResponseWriter, r *http.Request) error {
	userID, err := httpx.IDParam(r, "userID")
	if err != nil {
		return err
	}
	from, to, err := parseRange(r)
	if err != nil {
		return err
	}
	list, err := h.svc.CommissionDetail(r.Context(), branch.FromContext(r.Context()).ID, userID, from, to)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, map[string]any{"data": list})
}
