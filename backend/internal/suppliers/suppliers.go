// Package suppliers gestiona el registro de proveedores.
package suppliers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
	"github.com/neofarma/backend/internal/platform/rut"
)

type Supplier struct {
	ID               int64      `json:"id"`
	RUT              string     `json:"rut"`
	BusinessName     string     `json:"business_name"`
	TradeName        *string    `json:"trade_name"`
	ContactName      *string    `json:"contact_name"`
	Phone            *string    `json:"phone"`
	Email            *string    `json:"email"`
	Address          *string    `json:"address"`
	PaymentTermsDays int        `json:"payment_terms_days"`
	Notes            *string    `json:"notes"`
	Active           bool       `json:"active"`
	PurchasesCount   int        `json:"purchases_count"`
	LastPurchaseAt   *time.Time `json:"last_purchase_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

type Input struct {
	RUT              string  `json:"rut" validate:"required,rut"`
	BusinessName     string  `json:"business_name" validate:"required,min=2,max=200"`
	TradeName        *string `json:"trade_name" validate:"omitempty,max=200"`
	ContactName      *string `json:"contact_name" validate:"omitempty,max=120"`
	Phone            *string `json:"phone" validate:"omitempty,max=40"`
	Email            *string `json:"email" validate:"omitempty,email,max=120"`
	Address          *string `json:"address" validate:"omitempty,max=250"`
	PaymentTermsDays int     `json:"payment_terms_days" validate:"gte=0,lte=365"`
	Notes            *string `json:"notes" validate:"omitempty,max=1000"`
	Active           *bool   `json:"active"`
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

const selectSQL = `
	SELECT s.id, s.rut, s.business_name, s.trade_name, s.contact_name, s.phone, s.email, s.address,
	       s.payment_terms_days, s.notes, s.active, coalesce(pa.cnt, 0)::int, pa.last_at, s.created_at
	FROM suppliers s
	LEFT JOIN LATERAL (
		SELECT count(*) AS cnt, max(created_at) AS last_at FROM purchases WHERE supplier_id = s.id
	) pa ON true`

func scan(r pgx.Row) (Supplier, error) {
	var s Supplier
	err := r.Scan(&s.ID, &s.RUT, &s.BusinessName, &s.TradeName, &s.ContactName, &s.Phone, &s.Email, &s.Address,
		&s.PaymentTermsDays, &s.Notes, &s.Active, &s.PurchasesCount, &s.LastPurchaseAt, &s.CreatedAt)
	return s, err
}

func (s *Service) List(ctx context.Context, q string, includeInactive bool, pg httpx.Page) ([]Supplier, int, error) {
	where := "($1 = '' OR (s.business_name || ' ' || coalesce(s.trade_name, '') || ' ' || s.rut) ILIKE '%' || $1 || '%')"
	if !includeInactive {
		where += " AND s.active"
	}
	q = strings.TrimSpace(q)
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM suppliers s WHERE `+where, q).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count suppliers: %w", err)
	}
	rows, err := s.pool.Query(ctx, selectSQL+` WHERE `+where+` ORDER BY s.business_name LIMIT $2 OFFSET $3`,
		q, pg.PageSize, pg.Offset())
	if err != nil {
		return nil, 0, fmt.Errorf("list suppliers: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Supplier, error) { return scan(r) })
	return list, total, err
}

func (s *Service) Get(ctx context.Context, id int64) (Supplier, error) {
	sp, err := scan(s.pool.QueryRow(ctx, selectSQL+` WHERE s.id = $1`, id))
	if db.IsNoRows(err) {
		return sp, apperr.NotFound("Proveedor no encontrado")
	}
	return sp, err
}

func (s *Service) Create(ctx context.Context, in Input) (Supplier, error) {
	in.normalize()
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO suppliers (rut, business_name, trade_name, contact_name, phone, email, address, payment_terms_days, notes, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10,true)) RETURNING id`,
		in.RUT, in.BusinessName, in.TradeName, in.ContactName, in.Phone, in.Email, in.Address,
		in.PaymentTermsDays, in.Notes, in.Active).Scan(&id)
	if db.IsUniqueViolation(err) {
		return Supplier{}, apperr.Conflict("Ya existe un proveedor con el RUT " + in.RUT)
	}
	if err != nil {
		return Supplier{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Update(ctx context.Context, id int64, in Input) (Supplier, error) {
	in.normalize()
	tag, err := s.pool.Exec(ctx, `
		UPDATE suppliers SET rut=$2, business_name=$3, trade_name=$4, contact_name=$5, phone=$6, email=$7,
		       address=$8, payment_terms_days=$9, notes=$10, active=coalesce($11, active)
		WHERE id = $1`,
		id, in.RUT, in.BusinessName, in.TradeName, in.ContactName, in.Phone, in.Email, in.Address,
		in.PaymentTermsDays, in.Notes, in.Active)
	if db.IsUniqueViolation(err) {
		return Supplier{}, apperr.Conflict("Ya existe un proveedor con el RUT " + in.RUT)
	}
	if err != nil {
		return Supplier{}, err
	}
	if tag.RowsAffected() == 0 {
		return Supplier{}, apperr.NotFound("Proveedor no encontrado")
	}
	return s.Get(ctx, id)
}

func (in *Input) normalize() {
	in.RUT = rut.Normalize(in.RUT)
	in.BusinessName = strings.TrimSpace(in.BusinessName)
	for _, p := range []**string{&in.TradeName, &in.ContactName, &in.Phone, &in.Email, &in.Address, &in.Notes} {
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
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.List(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("include_inactive") == "true", pg)
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
		sp, err := h.svc.Get(r.Context(), id)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, sp)
	}))
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega))
		r.Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			var in Input
			if err := httpx.Decode(w, r, &in); err != nil {
				return err
			}
			sp, err := h.svc.Create(r.Context(), in)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusCreated, sp)
		}))
		r.Put("/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			id, err := httpx.IDParam(r, "id")
			if err != nil {
				return err
			}
			var in Input
			if err := httpx.Decode(w, r, &in); err != nil {
				return err
			}
			sp, err := h.svc.Update(r.Context(), id, in)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusOK, sp)
		}))
	})
}
