// Package cash gestiona cajas, sesiones de caja (apertura/cierre) y movimientos de efectivo.
package cash

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
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
)

type Register struct {
	ID              int64   `json:"id"`
	BranchID        int64   `json:"branch_id"`
	BranchName      string  `json:"branch_name"`
	Name            string  `json:"name"`
	Active          bool    `json:"active"`
	OpenSessionID   *int64  `json:"open_session_id"`
	OpenSessionUser *string `json:"open_session_user"`
}

type Session struct {
	ID            int64      `json:"id"`
	BranchID      int64      `json:"branch_id"`
	BranchName    string     `json:"branch_name"`
	RegisterID    int64      `json:"register_id"`
	RegisterName  string     `json:"register_name"`
	UserID        int64      `json:"user_id"`
	UserName      string     `json:"user_name"`
	Status        string     `json:"status"`
	OpeningAmount int64      `json:"opening_amount"`
	OpenedAt      time.Time  `json:"opened_at"`
	ClosedAt      *time.Time `json:"closed_at"`
	ExpectedCash  *int64     `json:"expected_cash"`
	CountedCash   *int64     `json:"counted_cash"`
	Difference    *int64     `json:"difference"`
	ClosingNotes  *string    `json:"closing_notes"`
	Summary       *Summary   `json:"summary,omitempty"`
	Movements     []Movement `json:"movements,omitempty"`
}

// Summary resume la actividad de una sesión; ExpectedCash es el efectivo que debería haber en caja.
type Summary struct {
	SalesCount   int              `json:"sales_count"`
	VoidedCount  int              `json:"voided_count"`
	SalesTotal   int64            `json:"sales_total"`
	ByMethod     map[string]int64 `json:"by_method"`
	CashIn       int64            `json:"cash_in"`
	CashOut      int64            `json:"cash_out"`
	ExpectedCash int64            `json:"expected_cash"`
}

type Movement struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"`
	Amount    int64     `json:"amount"`
	Reason    string    `json:"reason"`
	UserName  string    `json:"user_name"`
	CreatedAt time.Time `json:"created_at"`
}

type OpenInput struct {
	RegisterID    int64 `json:"register_id" validate:"required,gt=0"`
	OpeningAmount int64 `json:"opening_amount" validate:"gte=0,lte=100000000"`
}

type MovementInput struct {
	Type   string `json:"type" validate:"required,oneof=ingreso egreso"`
	Amount int64  `json:"amount" validate:"required,gt=0,lte=100000000"`
	Reason string `json:"reason" validate:"required,min=3,max=250"`
}

type CloseInput struct {
	CountedCash int64   `json:"counted_cash" validate:"gte=0,lte=1000000000"`
	Notes       *string `json:"notes" validate:"omitempty,max=1000"`
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ListRegisters lista las cajas de la sucursal (branch nil = todas).
func (s *Service) ListRegisters(ctx context.Context, branch *int64) ([]Register, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.branch_id, b.name, r.name, r.active, cs.id, u.full_name
		FROM cash_registers r
		JOIN branches b ON b.id = r.branch_id
		LEFT JOIN cash_sessions cs ON cs.register_id = r.id AND cs.status = 'abierta'
		LEFT JOIN users u ON u.id = cs.user_id
		WHERE $1::bigint IS NULL OR r.branch_id = $1
		ORDER BY b.name, r.name`, branch)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Register, error) {
		var reg Register
		return reg, r.Scan(&reg.ID, &reg.BranchID, &reg.BranchName, &reg.Name, &reg.Active, &reg.OpenSessionID, &reg.OpenSessionUser)
	})
}

type RegisterInput struct {
	Name   string `json:"name" validate:"required,min=2,max=40"`
	Active *bool  `json:"active"`
}

// CreateRegister crea una caja en la sucursal indicada.
func (s *Service) CreateRegister(ctx context.Context, branchID int64, in RegisterInput) (Register, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `INSERT INTO cash_registers (branch_id, name, active) VALUES ($1, $2, coalesce($3, true)) RETURNING id`,
		branchID, strings.TrimSpace(in.Name), in.Active).Scan(&id)
	if db.IsUniqueViolation(err) {
		return Register{}, apperr.Conflict("Ya existe una caja con ese nombre en la sucursal")
	}
	if err != nil {
		return Register{}, err
	}
	return s.getRegister(ctx, id)
}

// UpdateRegister renombra o (des)activa una caja de la sucursal indicada.
func (s *Service) UpdateRegister(ctx context.Context, branchID, id int64, in RegisterInput) (Register, error) {
	if in.Active != nil && !*in.Active {
		var open bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cash_sessions WHERE register_id = $1 AND status = 'abierta')`, id).Scan(&open); err != nil {
			return Register{}, err
		}
		if open {
			return Register{}, apperr.Unprocessable("register_open", "La caja tiene un turno abierto: ciérrelo antes de desactivarla")
		}
	}
	tag, err := s.pool.Exec(ctx, `UPDATE cash_registers SET name = $3, active = coalesce($4, active) WHERE id = $1 AND branch_id = $2`,
		id, branchID, strings.TrimSpace(in.Name), in.Active)
	if db.IsUniqueViolation(err) {
		return Register{}, apperr.Conflict("Ya existe una caja con ese nombre en la sucursal")
	}
	if err != nil {
		return Register{}, err
	}
	if tag.RowsAffected() == 0 {
		return Register{}, apperr.NotFound("Caja no encontrada en esta sucursal")
	}
	return s.getRegister(ctx, id)
}

func (s *Service) getRegister(ctx context.Context, id int64) (Register, error) {
	var reg Register
	err := s.pool.QueryRow(ctx, `
		SELECT r.id, r.branch_id, b.name, r.name, r.active, cs.id, u.full_name
		FROM cash_registers r
		JOIN branches b ON b.id = r.branch_id
		LEFT JOIN cash_sessions cs ON cs.register_id = r.id AND cs.status = 'abierta'
		LEFT JOIN users u ON u.id = cs.user_id
		WHERE r.id = $1`, id).Scan(&reg.ID, &reg.BranchID, &reg.BranchName, &reg.Name, &reg.Active, &reg.OpenSessionID, &reg.OpenSessionUser)
	return reg, err
}

const sessionSelect = `
	SELECT cs.id, cs.branch_id, b.name, cs.register_id, r.name, cs.user_id, u.full_name, cs.status, cs.opening_amount, cs.opened_at,
	       cs.closed_at, cs.expected_cash, cs.counted_cash, cs.difference, cs.closing_notes
	FROM cash_sessions cs
	JOIN cash_registers r ON r.id = cs.register_id
	JOIN branches b ON b.id = cs.branch_id
	JOIN users u ON u.id = cs.user_id`

func scanSession(r pgx.Row) (Session, error) {
	var s Session
	err := r.Scan(&s.ID, &s.BranchID, &s.BranchName, &s.RegisterID, &s.RegisterName, &s.UserID, &s.UserName, &s.Status, &s.OpeningAmount,
		&s.OpenedAt, &s.ClosedAt, &s.ExpectedCash, &s.CountedCash, &s.Difference, &s.ClosingNotes)
	return s, err
}

// Open abre una sesión de caja para el usuario en una caja de la sucursal indicada.
func (s *Service) Open(ctx context.Context, branchID, userID int64, in OpenInput) (Session, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `SELECT active FROM cash_registers WHERE id = $1 AND branch_id = $2`, in.RegisterID, branchID).Scan(&active)
	if db.IsNoRows(err) || (err == nil && !active) {
		return Session{}, apperr.Unprocessable("invalid_register", "La caja no existe en esta sucursal o está inactiva")
	}
	if err != nil {
		return Session{}, err
	}
	var id int64
	err = s.pool.QueryRow(ctx, `INSERT INTO cash_sessions (branch_id, register_id, user_id, opening_amount) VALUES ($1,$2,$3,$4) RETURNING id`,
		branchID, in.RegisterID, userID, in.OpeningAmount).Scan(&id)
	if db.IsUniqueViolation(err) {
		return Session{}, apperr.Conflict("La caja ya está abierta o usted ya tiene una caja abierta")
	}
	if err != nil {
		return Session{}, fmt.Errorf("open session: %w", err)
	}
	return s.Get(ctx, nil, id)
}

// Current retorna la sesión abierta del usuario (en cualquier sucursal: el usuario tiene a lo más una), o nil.
func (s *Service) Current(ctx context.Context, userID int64) (*Session, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `SELECT id FROM cash_sessions WHERE user_id = $1 AND status = 'abierta'`, userID).Scan(&id)
	if db.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sess, err := s.Get(ctx, nil, id)
	return &sess, err
}

// Get retorna la sesión con su resumen y movimientos si pertenece a la sucursal indicada (nil = cualquiera).
func (s *Service) Get(ctx context.Context, branch *int64, id int64) (Session, error) {
	sess, err := scanSession(s.pool.QueryRow(ctx, sessionSelect+` WHERE cs.id = $1 AND ($2::bigint IS NULL OR cs.branch_id = $2)`, id, branch))
	if db.IsNoRows(err) {
		return sess, apperr.NotFound("Sesión de caja no encontrada")
	}
	if err != nil {
		return sess, err
	}
	sum, err := summarize(ctx, s.pool, id, sess.OpeningAmount)
	if err != nil {
		return sess, err
	}
	sess.Summary = &sum
	rows, err := s.pool.Query(ctx, `
		SELECT m.id, m.type, m.amount, m.reason, u.full_name, m.created_at
		FROM cash_movements m JOIN users u ON u.id = m.user_id
		WHERE m.session_id = $1 ORDER BY m.created_at`, id)
	if err != nil {
		return sess, err
	}
	sess.Movements, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Movement, error) {
		var m Movement
		return m, r.Scan(&m.ID, &m.Type, &m.Amount, &m.Reason, &m.UserName, &m.CreatedAt)
	})
	if sess.Movements == nil {
		sess.Movements = []Movement{}
	}
	return sess, err
}

func summarize(ctx context.Context, q db.DBTX, sessionID, opening int64) (Summary, error) {
	sum := Summary{ByMethod: map[string]int64{"efectivo": 0, "debito": 0, "credito": 0, "transferencia": 0}}
	rows, err := q.Query(ctx, `
		SELECT payment_method, count(*) FILTER (WHERE status = 'completada'), count(*) FILTER (WHERE status = 'anulada'),
		       coalesce(sum(total) FILTER (WHERE status = 'completada'), 0)
		FROM sales WHERE session_id = $1 GROUP BY payment_method`, sessionID)
	if err != nil {
		return sum, fmt.Errorf("summarize sales: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var method string
		var cnt, voided int
		var total int64
		if err := rows.Scan(&method, &cnt, &voided, &total); err != nil {
			return sum, err
		}
		sum.SalesCount += cnt
		sum.VoidedCount += voided
		sum.SalesTotal += total
		sum.ByMethod[method] = total
	}
	if err := rows.Err(); err != nil {
		return sum, err
	}
	if err := q.QueryRow(ctx, `
		SELECT coalesce(sum(amount) FILTER (WHERE type = 'ingreso'), 0), coalesce(sum(amount) FILTER (WHERE type = 'egreso'), 0)
		FROM cash_movements WHERE session_id = $1`, sessionID).Scan(&sum.CashIn, &sum.CashOut); err != nil {
		return sum, fmt.Errorf("summarize movements: %w", err)
	}
	sum.ExpectedCash = opening + sum.ByMethod["efectivo"] + sum.CashIn - sum.CashOut
	return sum, nil
}

// lockOpenSession bloquea la sesión y verifica que esté abierta y que el actor pueda operarla.
func lockOpenSession(ctx context.Context, tx pgx.Tx, actor auth.Principal, branchID, id int64) (opening int64, err error) {
	var status string
	var owner int64
	err = tx.QueryRow(ctx, `SELECT status, user_id, opening_amount FROM cash_sessions WHERE id = $1 AND branch_id = $2 FOR UPDATE`, id, branchID).
		Scan(&status, &owner, &opening)
	if db.IsNoRows(err) {
		return 0, apperr.NotFound("Sesión de caja no encontrada")
	}
	if err != nil {
		return 0, err
	}
	if status != "abierta" {
		return 0, apperr.Unprocessable("session_closed", "La sesión de caja ya está cerrada")
	}
	if owner != actor.UserID && actor.Role != auth.RoleAdmin && actor.Role != auth.RoleQuimico {
		return 0, apperr.ErrForbidden
	}
	return opening, nil
}

func (s *Service) AddMovement(ctx context.Context, actor auth.Principal, branchID, sessionID int64, in MovementInput) (Session, error) {
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		opening, err := lockOpenSession(ctx, tx, actor, branchID, sessionID)
		if err != nil {
			return err
		}
		if in.Type == "egreso" {
			sum, err := summarize(ctx, tx, sessionID, opening)
			if err != nil {
				return err
			}
			if in.Amount > sum.ExpectedCash {
				return apperr.Unprocessable("insufficient_cash", "El egreso supera el efectivo disponible en caja")
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO cash_movements (session_id, type, amount, reason, user_id) VALUES ($1,$2,$3,$4,$5)`,
			sessionID, in.Type, in.Amount, strings.TrimSpace(in.Reason), actor.UserID)
		return err
	})
	if err != nil {
		return Session{}, err
	}
	return s.Get(ctx, &branchID, sessionID)
}

// Close cierra la sesión registrando el arqueo (efectivo contado) y la diferencia contra lo esperado.
func (s *Service) Close(ctx context.Context, actor auth.Principal, branchID, sessionID int64, in CloseInput) (Session, error) {
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		opening, err := lockOpenSession(ctx, tx, actor, branchID, sessionID)
		if err != nil {
			return err
		}
		sum, err := summarize(ctx, tx, sessionID, opening)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE cash_sessions SET status = 'cerrada', closed_at = now(), expected_cash = $2, counted_cash = $3,
			       difference = $3::bigint - $2::bigint, closing_notes = $4
			WHERE id = $1`, sessionID, sum.ExpectedCash, in.CountedCash, in.Notes)
		return err
	})
	if err != nil {
		return Session{}, err
	}
	return s.Get(ctx, &branchID, sessionID)
}

// List lista sesiones de la sucursal (branch nil = todas).
func (s *Service) List(ctx context.Context, branch *int64, status string, pg httpx.Page) ([]Session, int, error) {
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM cash_sessions WHERE ($1 = '' OR status = $1) AND ($2::bigint IS NULL OR branch_id = $2)`, status, branch).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx, sessionSelect+` WHERE ($1 = '' OR cs.status = $1) AND ($2::bigint IS NULL OR cs.branch_id = $2) ORDER BY cs.opened_at DESC LIMIT $3 OFFSET $4`,
		status, branch, pg.PageSize, pg.Offset())
	if err != nil {
		return nil, 0, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Session, error) { return scanSession(r) })
	if err != nil {
		return nil, 0, err
	}
	// Resumen por sesión: la página es pequeña (<=100), un query por sesión es aceptable aquí.
	for i := range list {
		sum, err := summarize(ctx, s.pool, list[i].ID, list[i].OpeningAmount)
		if err != nil {
			return nil, 0, err
		}
		list[i].Summary = &sum
	}
	return list, total, nil
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Routes(r chi.Router) {
	r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleCajero))
	r.Get("/registers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := h.svc.ListRegisters(r.Context(), branch.FromContext(r.Context()).ID)
		if err != nil {
			return err
		}
		if list == nil {
			list = []Register{}
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"data": list})
	}))
	// Administración de cajas de la sucursal activa: solo admin.
	r.With(auth.RequireRoles()).Post("/registers", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		var in RegisterInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		reg, err := h.svc.CreateRegister(r.Context(), branchID, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, reg)
	}))
	r.With(auth.RequireRoles()).Put("/registers/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		var in RegisterInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		reg, err := h.svc.UpdateRegister(r.Context(), branchID, id, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, reg)
	}))
	r.Get("/sessions/current", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		sess, err := h.svc.Current(r.Context(), auth.FromContext(r.Context()).UserID)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"session": sess})
	}))
	// El historial de cierres (sesiones de todos los usuarios) es exclusivo del administrador.
	r.With(auth.RequireRoles()).Get("/sessions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.List(r.Context(), branch.FromContext(r.Context()).ID, r.URL.Query().Get("status"), pg)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, httpx.NewList(list, total, pg))
	}))
	r.Get("/sessions/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		sess, err := h.svc.Get(r.Context(), branch.FromContext(r.Context()).ID, id)
		if err != nil {
			return err
		}
		// Cada usuario solo puede consultar sus propias sesiones; el administrador, todas.
		if actor := auth.FromContext(r.Context()); actor.Role != auth.RoleAdmin && sess.UserID != actor.UserID {
			return apperr.ErrForbidden
		}
		return httpx.JSON(w, http.StatusOK, sess)
	}))
	r.Post("/sessions", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in OpenInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		sess, err := h.svc.Open(r.Context(), branchID, auth.FromContext(r.Context()).UserID, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, sess)
	}))
	r.Post("/sessions/{id}/movements", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		var in MovementInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		sess, err := h.svc.AddMovement(r.Context(), auth.FromContext(r.Context()), branchID, id, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, sess)
	}))
	r.Post("/sessions/{id}/close", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		var in CloseInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		branchID, err := branch.Require(r.Context())
		if err != nil {
			return err
		}
		sess, err := h.svc.Close(r.Context(), auth.FromContext(r.Context()), branchID, id, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, sess)
	}))
}
