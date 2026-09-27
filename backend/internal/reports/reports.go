// Package reports expone indicadores agregados para dashboard y reportes de gestión.
package reports

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/httpx"
)

type DayPoint struct {
	Date  string `json:"date"`
	Total int64  `json:"total"`
	Count int    `json:"count"`
}

type TopProduct struct {
	ProductID int64  `json:"product_id"`
	Name      string `json:"name"`
	Quantity  int    `json:"quantity"`
	Total     int64  `json:"total"`
	Margin    int64  `json:"margin"`
}

type StockAlert struct {
	ProductID     int64   `json:"product_id"`
	Name          string  `json:"name"`
	SKU           string  `json:"sku"`
	StockSellable int     `json:"stock_sellable"`
	MinStock      int     `json:"min_stock"`
	LotNumber     *string `json:"lot_number,omitempty"`
	ExpiryDate    *string `json:"expiry_date,omitempty"`
	DaysToExpiry  *int    `json:"days_to_expiry,omitempty"`
	Quantity      *int    `json:"quantity,omitempty"`
	BranchName    *string `json:"branch_name,omitempty"`
}

type Dashboard struct {
	// Scope indica el alcance de los datos: "all" (farmacia completa) o "own" (solo ventas del cajero;
	// en ese caso inventario, margen, alertas y productos no se calculan y vienen vacíos).
	Scope             string           `json:"scope"`
	TodaySalesTotal   int64            `json:"today_sales_total"`
	TodaySalesCount   int              `json:"today_sales_count"`
	TodayAvgTicket    int64            `json:"today_avg_ticket"`
	TodayMargin       int64            `json:"today_margin"` // margen bruto neto de IVA
	MonthSalesTotal   int64            `json:"month_sales_total"`
	MonthSalesCount   int              `json:"month_sales_count"`
	InventoryValue    int64            `json:"inventory_value"`
	ActiveProducts    int              `json:"active_products"`
	LowStockCount     int              `json:"low_stock_count"`
	ExpiringSoonCount int              `json:"expiring_soon_count"` // lotes que vencen en 90 días
	ExpiredCount      int              `json:"expired_count"`       // lotes vencidos con stock
	OpenSessions      int              `json:"open_sessions"`
	Last14Days        []DayPoint       `json:"last_14_days"`
	TodayByMethod     map[string]int64 `json:"today_by_method"`
	TopProducts       []TopProduct     `json:"top_products"`
	LowStock          []StockAlert     `json:"low_stock"`
	Expiring          []StockAlert     `json:"expiring"`
}

type SalesReport struct {
	From        string           `json:"from"`
	To          string           `json:"to"`
	Total       int64            `json:"total"`
	Net         int64            `json:"net"`
	Tax         int64            `json:"tax"`
	Discount    int64            `json:"discount"`
	Count       int              `json:"count"`
	VoidedCount int              `json:"voided_count"`
	Margin      int64            `json:"margin"`
	AvgTicket   int64            `json:"avg_ticket"`
	ByMethod    map[string]int64 `json:"by_method"`
	Daily       []DayPoint       `json:"daily"`
	TopProducts []TopProduct     `json:"top_products"`
	ByUser      []UserSales      `json:"by_user"`
	ByBranch    []BranchSales    `json:"by_branch"`
}

type BranchSales struct {
	BranchID   int64  `json:"branch_id"`
	BranchName string `json:"branch_name"`
	Count      int    `json:"count"`
	Total      int64  `json:"total"`
}

type UserSales struct {
	UserName string `json:"user_name"`
	Count    int    `json:"count"`
	Total    int64  `json:"total"`
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// stockLateral: stock vendible del producto p en la sucursal $1 (NULL = todas).
const stockLateral = `
	CROSS JOIN LATERAL (
		SELECT coalesce(sum(l.qty_available) FILTER (WHERE l.expiry_date >= current_date), 0)::int AS stock_sellable
		FROM product_lots l
		WHERE l.product_id = p.id AND l.qty_available > 0 AND ($1::bigint IS NULL OR l.branch_id = $1)
	) ps`

// CashierDashboard es el dashboard del cajero: solo sus propias ventas en la sucursal (hoy, mes, ticket promedio,
// medios de pago de hoy y serie de 14 días). No incluye datos del resto de la farmacia.
func (s *Service) CashierDashboard(ctx context.Context, branch *int64, userID int64) (Dashboard, error) {
	d := Dashboard{Scope: "own", TopProducts: []TopProduct{}, LowStock: []StockAlert{}, Expiring: []StockAlert{}}
	err := s.pool.QueryRow(ctx, `
		SELECT
			coalesce(sum(total) FILTER (WHERE created_at >= current_date), 0),
			count(*) FILTER (WHERE created_at >= current_date),
			coalesce(sum(total), 0),
			count(*)
		FROM sales
		WHERE status = 'completada' AND user_id = $1 AND created_at >= date_trunc('month', current_date)
		  AND ($2::bigint IS NULL OR branch_id = $2)`, userID, branch).
		Scan(&d.TodaySalesTotal, &d.TodaySalesCount, &d.MonthSalesTotal, &d.MonthSalesCount)
	if err != nil {
		return d, fmt.Errorf("cashier dashboard sales: %w", err)
	}
	if d.TodaySalesCount > 0 {
		d.TodayAvgTicket = d.TodaySalesTotal / int64(d.TodaySalesCount)
	}
	today := time.Now().Format(time.DateOnly)
	if d.Last14Days, err = s.daily(ctx, branch, time.Now().AddDate(0, 0, -13).Format(time.DateOnly), today, &userID); err != nil {
		return d, err
	}
	d.TodayByMethod, err = s.byMethod(ctx, branch, today, today, &userID)
	return d, err
}

// Dashboard resume la sucursal indicada (branch nil = consolidado de todas las sucursales).
func (s *Service) Dashboard(ctx context.Context, branch *int64) (Dashboard, error) {
	d := Dashboard{Scope: "all"}
	err := s.pool.QueryRow(ctx, `
		SELECT
			coalesce(sum(total) FILTER (WHERE created_at >= current_date), 0),
			count(*) FILTER (WHERE created_at >= current_date),
			coalesce(sum(total), 0),
			count(*)
		FROM sales
		WHERE status = 'completada' AND created_at >= date_trunc('month', current_date)
		  AND ($1::bigint IS NULL OR branch_id = $1)`, branch).
		Scan(&d.TodaySalesTotal, &d.TodaySalesCount, &d.MonthSalesTotal, &d.MonthSalesCount)
	if err != nil {
		return d, fmt.Errorf("dashboard sales: %w", err)
	}
	if d.TodaySalesCount > 0 {
		d.TodayAvgTicket = d.TodaySalesTotal / int64(d.TodaySalesCount)
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(round(si.total / 1.19) - si.unit_cost * si.quantity), 0)::bigint
		FROM sale_items si JOIN sales s ON s.id = si.sale_id
		WHERE s.status = 'completada' AND s.created_at >= current_date
		  AND ($1::bigint IS NULL OR s.branch_id = $1)`, branch).Scan(&d.TodayMargin); err != nil {
		return d, err
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
			(SELECT coalesce(sum(qty_available::bigint * unit_cost), 0) FROM product_lots
			  WHERE qty_available > 0 AND expiry_date >= current_date AND ($1::bigint IS NULL OR branch_id = $1)),
			(SELECT count(*) FROM products WHERE active),
			(SELECT count(*) FROM products p `+stockLateral+` WHERE p.active AND ps.stock_sellable <= p.min_stock),
			(SELECT count(*) FROM product_lots WHERE qty_available > 0 AND expiry_date >= current_date
			  AND expiry_date <= current_date + 90 AND ($1::bigint IS NULL OR branch_id = $1)),
			(SELECT count(*) FROM product_lots WHERE qty_available > 0 AND expiry_date < current_date
			  AND ($1::bigint IS NULL OR branch_id = $1)),
			(SELECT count(*) FROM cash_sessions WHERE status = 'abierta' AND ($1::bigint IS NULL OR branch_id = $1))`, branch).
		Scan(&d.InventoryValue, &d.ActiveProducts, &d.LowStockCount, &d.ExpiringSoonCount, &d.ExpiredCount, &d.OpenSessions)
	if err != nil {
		return d, fmt.Errorf("dashboard inventory: %w", err)
	}

	today := time.Now().Format(time.DateOnly)
	from := time.Now().AddDate(0, 0, -13).Format(time.DateOnly)
	if d.Last14Days, err = s.daily(ctx, branch, from, today, nil); err != nil {
		return d, err
	}
	if d.TodayByMethod, err = s.byMethod(ctx, branch, today, today, nil); err != nil {
		return d, err
	}
	if d.TopProducts, err = s.topProducts(ctx, branch, time.Now().AddDate(0, 0, -29).Format(time.DateOnly), today, 6); err != nil {
		return d, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.name, p.sku, ps.stock_sellable, p.min_stock
		FROM products p `+stockLateral+`
		WHERE p.active AND ps.stock_sellable <= p.min_stock
		ORDER BY ps.stock_sellable::float / greatest(p.min_stock, 1), p.name LIMIT 8`, branch)
	if err != nil {
		return d, err
	}
	if d.LowStock, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (StockAlert, error) {
		var a StockAlert
		return a, r.Scan(&a.ProductID, &a.Name, &a.SKU, &a.StockSellable, &a.MinStock)
	}); err != nil {
		return d, err
	}
	rows, err = s.pool.Query(ctx, `
		SELECT p.id, p.name, p.sku, ps.stock_sellable, p.min_stock, l.lot_number, to_char(l.expiry_date, 'YYYY-MM-DD'),
		       (l.expiry_date - current_date)::int, l.qty_available, b.name
		FROM product_lots l
		JOIN products p ON p.id = l.product_id
		JOIN branches b ON b.id = l.branch_id
		`+stockLateral+`
		WHERE l.qty_available > 0 AND l.expiry_date <= current_date + 90 AND ($1::bigint IS NULL OR l.branch_id = $1)
		ORDER BY l.expiry_date LIMIT 8`, branch)
	if err != nil {
		return d, err
	}
	d.Expiring, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (StockAlert, error) {
		var a StockAlert
		return a, r.Scan(&a.ProductID, &a.Name, &a.SKU, &a.StockSellable, &a.MinStock, &a.LotNumber, &a.ExpiryDate, &a.DaysToExpiry, &a.Quantity, &a.BranchName)
	})
	nonNil(&d.LowStock)
	nonNil(&d.Expiring)
	return d, err
}

// Sales es el reporte de ventas del período para la sucursal indicada (nil = todas).
func (s *Service) Sales(ctx context.Context, branch *int64, from, to string) (SalesReport, error) {
	rep := SalesReport{From: from, To: to}
	err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(total) FILTER (WHERE status = 'completada'), 0),
		       coalesce(sum(net_amount) FILTER (WHERE status = 'completada'), 0),
		       coalesce(sum(tax_amount) FILTER (WHERE status = 'completada'), 0),
		       coalesce(sum(discount) FILTER (WHERE status = 'completada'), 0),
		       count(*) FILTER (WHERE status = 'completada'),
		       count(*) FILTER (WHERE status = 'anulada')
		FROM sales WHERE created_at >= $1::date AND created_at < $2::date + 1
		  AND ($3::bigint IS NULL OR branch_id = $3)`, from, to, branch).
		Scan(&rep.Total, &rep.Net, &rep.Tax, &rep.Discount, &rep.Count, &rep.VoidedCount)
	if err != nil {
		return rep, fmt.Errorf("sales report totals: %w", err)
	}
	if rep.Count > 0 {
		rep.AvgTicket = rep.Total / int64(rep.Count)
	}
	// Margen bruto: venta neta de IVA menos costo neto de lotes consumidos (prorrateando el descuento global).
	if err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(s.net_amount), 0) - coalesce(sum(c.cost), 0)
		FROM sales s
		JOIN LATERAL (SELECT sum(unit_cost * quantity) AS cost FROM sale_items WHERE sale_id = s.id) c ON true
		WHERE s.status = 'completada' AND s.created_at >= $1::date AND s.created_at < $2::date + 1
		  AND ($3::bigint IS NULL OR s.branch_id = $3)`, from, to, branch).Scan(&rep.Margin); err != nil {
		return rep, err
	}
	if rep.ByMethod, err = s.byMethod(ctx, branch, from, to, nil); err != nil {
		return rep, err
	}
	if rep.Daily, err = s.daily(ctx, branch, from, to, nil); err != nil {
		return rep, err
	}
	if rep.TopProducts, err = s.topProducts(ctx, branch, from, to, 15); err != nil {
		return rep, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT u.full_name, count(*)::int, sum(s.total)
		FROM sales s JOIN users u ON u.id = s.user_id
		WHERE s.status = 'completada' AND s.created_at >= $1::date AND s.created_at < $2::date + 1
		  AND ($3::bigint IS NULL OR s.branch_id = $3)
		GROUP BY u.full_name ORDER BY 3 DESC`, from, to, branch)
	if err != nil {
		return rep, err
	}
	rep.ByUser, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (UserSales, error) {
		var u UserSales
		return u, r.Scan(&u.UserName, &u.Count, &u.Total)
	})
	nonNil(&rep.ByUser)
	if err != nil {
		return rep, err
	}
	rep.ByBranch, err = s.byBranch(ctx, branch, from, to)
	return rep, err
}

// byBranch desglosa las ventas por sucursal (útil en el consolidado).
func (s *Service) byBranch(ctx context.Context, branch *int64, from, to string) ([]BranchSales, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT b.id, b.name, count(s.id)::int, coalesce(sum(s.total), 0)
		FROM branches b
		LEFT JOIN sales s ON s.branch_id = b.id AND s.status = 'completada'
		     AND s.created_at >= $1::date AND s.created_at < $2::date + 1
		WHERE $3::bigint IS NULL OR b.id = $3
		GROUP BY b.id ORDER BY 4 DESC, b.name`, from, to, branch)
	if err != nil {
		return nil, fmt.Errorf("sales by branch: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (BranchSales, error) {
		var x BranchSales
		return x, r.Scan(&x.BranchID, &x.BranchName, &x.Count, &x.Total)
	})
	nonNil(&list)
	return list, err
}

func (s *Service) daily(ctx context.Context, branch *int64, from, to string, userID *int64) ([]DayPoint, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT to_char(d, 'YYYY-MM-DD'), coalesce(sum(s.total), 0), count(s.id)::int
		FROM generate_series($1::date, $2::date, interval '1 day') d
		LEFT JOIN sales s ON s.status = 'completada' AND s.created_at >= d AND s.created_at < d + interval '1 day'
		                 AND ($3::bigint IS NULL OR s.user_id = $3)
		                 AND ($4::bigint IS NULL OR s.branch_id = $4)
		GROUP BY d ORDER BY d`, from, to, userID, branch)
	if err != nil {
		return nil, fmt.Errorf("daily series: %w", err)
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DayPoint, error) {
		var p DayPoint
		return p, r.Scan(&p.Date, &p.Total, &p.Count)
	})
}

func (s *Service) byMethod(ctx context.Context, branch *int64, from, to string, userID *int64) (map[string]int64, error) {
	out := map[string]int64{"efectivo": 0, "debito": 0, "credito": 0, "transferencia": 0}
	rows, err := s.pool.Query(ctx, `
		SELECT payment_method, sum(total) FROM sales
		WHERE status = 'completada' AND created_at >= $1::date AND created_at < $2::date + 1
		  AND ($3::bigint IS NULL OR user_id = $3)
		  AND ($4::bigint IS NULL OR branch_id = $4)
		GROUP BY payment_method`, from, to, userID, branch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m string
		var t int64
		if err := rows.Scan(&m, &t); err != nil {
			return nil, err
		}
		out[m] = t
	}
	return out, rows.Err()
}

func (s *Service) topProducts(ctx context.Context, branch *int64, from, to string, limit int) ([]TopProduct, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.name, sum(si.quantity)::int, sum(si.total),
		       sum(round(si.total / 1.19) - si.unit_cost * si.quantity)::bigint
		FROM sale_items si
		JOIN sales s ON s.id = si.sale_id
		JOIN products p ON p.id = si.product_id
		WHERE s.status = 'completada' AND s.created_at >= $1::date AND s.created_at < $2::date + 1
		  AND ($4::bigint IS NULL OR s.branch_id = $4)
		GROUP BY p.id ORDER BY 4 DESC LIMIT $3`, from, to, limit, branch)
	if err != nil {
		return nil, fmt.Errorf("top products: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (TopProduct, error) {
		var t TopProduct
		return t, r.Scan(&t.ProductID, &t.Name, &t.Quantity, &t.Total, &t.Margin)
	})
	nonNil(&list)
	return list, err
}

func nonNil[T any](s *[]T) {
	if *s == nil {
		*s = []T{}
	}
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Get("/dashboard", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		// El cajero solo recibe sus propias cifras; los datos de la farmacia no se calculan para él.
		if actor := auth.FromContext(r.Context()); actor.Role == auth.RoleCajero {
			d, err := h.svc.CashierDashboard(r.Context(), branch.FromContext(r.Context()).ID, actor.UserID)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusOK, d)
		}
		d, err := h.svc.Dashboard(r.Context(), branch.FromContext(r.Context()).ID)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, d)
	}))
	// Reportes de gestión: químico farmacéutico y admin (igual que la pantalla de Reportes).
	r.With(auth.RequireRoles(auth.RoleQuimico)).Get("/sales", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		from, to := q.Get("from"), q.Get("to")
		f, err1 := time.Parse(time.DateOnly, from)
		t, err2 := time.Parse(time.DateOnly, to)
		if err1 != nil || err2 != nil || t.Before(f) {
			return apperr.BadRequest("Parámetros from/to inválidos (formato AAAA-MM-DD, from <= to)")
		}
		if t.Sub(f) > 366*24*time.Hour {
			return apperr.BadRequest("El rango máximo es de un año")
		}
		rep, err := h.svc.Sales(r.Context(), branch.FromContext(r.Context()).ID, from, to)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, rep)
	}))
}
