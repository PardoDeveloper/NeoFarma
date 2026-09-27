// Package branches gestiona las sucursales (locales) de la farmacia.
package branches

import (
	"context"
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
)

type Branch struct {
	ID        int64     `json:"id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Address   *string   `json:"address"`
	Phone     *string   `json:"phone"`
	Active    bool      `json:"active"`
	Users     int       `json:"users"`     // usuarios asignados
	Registers int       `json:"registers"` // cajas
	CreatedAt time.Time `json:"created_at"`
}

type Input struct {
	Code    string  `json:"code" validate:"required,min=2,max=20"`
	Name    string  `json:"name" validate:"required,min=2,max=80"`
	Address *string `json:"address" validate:"omitempty,max=200"`
	Phone   *string `json:"phone" validate:"omitempty,max=40"`
	Active  *bool   `json:"active"`
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

const selectSQL = `
	SELECT b.id, b.code, b.name, b.address, b.phone, b.active,
	       (SELECT count(*) FROM user_branches WHERE branch_id = b.id)::int,
	       (SELECT count(*) FROM cash_registers WHERE branch_id = b.id)::int,
	       b.created_at
	FROM branches b`

func scan(r pgx.Row) (Branch, error) {
	var b Branch
	err := r.Scan(&b.ID, &b.Code, &b.Name, &b.Address, &b.Phone, &b.Active, &b.Users, &b.Registers, &b.CreatedAt)
	return b, err
}

// ListFor retorna las sucursales accesibles: admin → todas; resto → sus sucursales activas.
func (s *Service) ListFor(ctx context.Context, p auth.Principal) ([]Branch, error) {
	q := selectSQL + ` ORDER BY b.active DESC, b.name`
	args := []any{}
	if p.Role != auth.RoleAdmin {
		q = selectSQL + ` WHERE b.active AND EXISTS (SELECT 1 FROM user_branches ub WHERE ub.branch_id = b.id AND ub.user_id = $1) ORDER BY b.name`
		args = append(args, p.UserID)
	}
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Branch, error) { return scan(r) })
	if list == nil {
		list = []Branch{}
	}
	return list, err
}

func (s *Service) Get(ctx context.Context, id int64) (Branch, error) {
	b, err := scan(s.pool.QueryRow(ctx, selectSQL+` WHERE b.id = $1`, id))
	if db.IsNoRows(err) {
		return b, apperr.NotFound("Sucursal no encontrada")
	}
	return b, err
}

func (in *Input) normalize() {
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	in.Name = strings.TrimSpace(in.Name)
	for _, p := range []**string{&in.Address, &in.Phone} {
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

func writeErr(err error) error {
	switch {
	case err == nil:
		return nil
	case db.IsUniqueViolation(err):
		return apperr.Conflict("Ya existe una sucursal con ese código o nombre")
	case db.IsCheckViolation(err):
		return apperr.Unprocessable("invalid_code", "Código inválido: use 2-20 caracteres A-Z, 0-9, guion o guion bajo")
	}
	return err
}

func (s *Service) Create(ctx context.Context, in Input) (Branch, error) {
	in.normalize()
	var id int64
	err := s.pool.QueryRow(ctx, `
		INSERT INTO branches (code, name, address, phone, active) VALUES ($1,$2,$3,$4,coalesce($5,true)) RETURNING id`,
		in.Code, in.Name, in.Address, in.Phone, in.Active).Scan(&id)
	if err := writeErr(err); err != nil {
		return Branch{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Update(ctx context.Context, id int64, in Input) (Branch, error) {
	in.normalize()
	if in.Active != nil && !*in.Active {
		// No se desactiva una sucursal con cajas abiertas: dejaría turnos sin posibilidad de cierre.
		var open bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cash_sessions WHERE branch_id = $1 AND status = 'abierta')`, id).Scan(&open); err != nil {
			return Branch{}, err
		}
		if open {
			return Branch{}, apperr.Unprocessable("open_sessions", "La sucursal tiene cajas abiertas: ciérrelas antes de desactivarla")
		}
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE branches SET code=$2, name=$3, address=$4, phone=$5, active=coalesce($6, active) WHERE id = $1`,
		id, in.Code, in.Name, in.Address, in.Phone, in.Active)
	if err := writeErr(err); err != nil {
		return Branch{}, err
	}
	if tag.RowsAffected() == 0 {
		return Branch{}, apperr.NotFound("Sucursal no encontrada")
	}
	return s.Get(ctx, id)
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	// Cualquier usuario autenticado lista sus sucursales (selector de sucursal).
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := h.svc.ListFor(r.Context(), auth.FromContext(r.Context()))
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"data": list})
	}))
	r.Group(func(r chi.Router) {
		r.Use(auth.RequireRoles()) // administración: solo admin
		r.Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			var in Input
			if err := httpx.Decode(w, r, &in); err != nil {
				return err
			}
			b, err := h.svc.Create(r.Context(), in)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusCreated, b)
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
			b, err := h.svc.Update(r.Context(), id, in)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusOK, b)
		}))
	})
}
