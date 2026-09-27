// Package users gestiona usuarios del sistema y la autenticación.
package users

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
)

type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	FullName  string    `json:"full_name"`
	Role      string    `json:"role"`
	Active    bool      `json:"active"`
	BranchIDs []int64   `json:"branch_ids"` // sucursales asignadas (el admin accede a todas sin asignación)
	CreatedAt time.Time `json:"created_at"`
}

type CreateInput struct {
	Username  string  `json:"username" validate:"required,min=3,max=40"`
	FullName  string  `json:"full_name" validate:"required,min=2,max=120"`
	Password  string  `json:"password" validate:"required,min=8,max=72"`
	Role      string  `json:"role" validate:"required,oneof=admin quimico cajero bodega"`
	BranchIDs []int64 `json:"branch_ids" validate:"max=50,dive,gt=0"`
}

type UpdateInput struct {
	FullName  string  `json:"full_name" validate:"required,min=2,max=120"`
	Role      string  `json:"role" validate:"required,oneof=admin quimico cajero bodega"`
	Active    bool    `json:"active"`
	Password  *string `json:"password" validate:"omitempty,min=8,max=72"`
	BranchIDs []int64 `json:"branch_ids" validate:"max=50,dive,gt=0"`
}

type LoginInput struct {
	Username string `json:"username" validate:"required"`
	Password string `json:"password" validate:"required"`
}

type LoginResult struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	User      User      `json:"user"`
}

type Service struct {
	pool   *pgxpool.Pool
	tokens *auth.Tokens
}

func NewService(pool *pgxpool.Pool, tokens *auth.Tokens) *Service {
	return &Service{pool: pool, tokens: tokens}
}

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("neofarma-dummy"), bcrypt.DefaultCost)

const userCols = `id, username, full_name, role, active,
	coalesce((SELECT array_agg(ub.branch_id ORDER BY ub.branch_id) FROM user_branches ub WHERE ub.user_id = users.id), '{}'),
	created_at`

func (s *Service) Login(ctx context.Context, in LoginInput) (LoginResult, error) {
	var u User
	var hash string
	err := s.pool.QueryRow(ctx, `SELECT `+userCols+`, password_hash FROM users WHERE username = $1`,
		strings.ToLower(strings.TrimSpace(in.Username))).
		Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Active, &u.BranchIDs, &u.CreatedAt, &hash)
	if db.IsNoRows(err) {
		// Compara igual contra un hash ficticio para no filtrar qué usuarios existen por tiempo de respuesta.
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(in.Password))
		return LoginResult{}, apperr.ErrUnauthorized
	}
	if err != nil {
		return LoginResult{}, fmt.Errorf("query user: %w", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil || !u.Active {
		return LoginResult{}, apperr.ErrUnauthorized
	}
	token, exp, err := s.tokens.Issue(auth.Principal{UserID: u.ID, Username: u.Username, FullName: u.FullName, Role: u.Role})
	if err != nil {
		return LoginResult{}, fmt.Errorf("issue token: %w", err)
	}
	return LoginResult{Token: token, ExpiresAt: exp, User: u}, nil
}

func (s *Service) Get(ctx context.Context, id int64) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Active, &u.BranchIDs, &u.CreatedAt)
	if db.IsNoRows(err) {
		return u, apperr.NotFound("Usuario no encontrado")
	}
	return u, err
}

func (s *Service) List(ctx context.Context) ([]User, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+userCols+` FROM users ORDER BY active DESC, full_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &u.Active, &u.BranchIDs, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// checkBranches exige al menos una sucursal para roles que no son admin.
func checkBranches(role string, ids []int64) error {
	if role != auth.RoleAdmin && len(ids) == 0 {
		return apperr.Unprocessable("branches_required", "Asigne al menos una sucursal al usuario")
	}
	return nil
}

// setBranches reemplaza las sucursales del usuario (el admin no guarda asignaciones: accede a todas).
func setBranches(ctx context.Context, tx pgx.Tx, userID int64, role string, ids []int64) error {
	if _, err := tx.Exec(ctx, `DELETE FROM user_branches WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if role == auth.RoleAdmin {
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO user_branches (user_id, branch_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`, userID, ids)
	if db.IsFKViolation(err) {
		return apperr.Unprocessable("invalid_branch", "Alguna de las sucursales indicadas no existe")
	}
	return err
}

func (s *Service) Create(ctx context.Context, in CreateInput) (User, error) {
	if err := checkBranches(in.Role, in.BranchIDs); err != nil {
		return User{}, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, err
	}
	var id int64
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx,
			`INSERT INTO users (username, full_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`,
			strings.ToLower(strings.TrimSpace(in.Username)), strings.TrimSpace(in.FullName), string(hash), in.Role).Scan(&id)
		if db.IsUniqueViolation(err) {
			return apperr.Conflict("El nombre de usuario ya existe")
		}
		if db.IsCheckViolation(err) {
			return apperr.Unprocessable("invalid_username", "Nombre de usuario inválido: use 3-40 caracteres a-z, 0-9, punto, guion o guion bajo")
		}
		if err != nil {
			return err
		}
		return setBranches(ctx, tx, id, in.Role, in.BranchIDs)
	})
	if err != nil {
		return User{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Update(ctx context.Context, actor auth.Principal, id int64, in UpdateInput) (User, error) {
	if actor.UserID == id && (!in.Active || in.Role != auth.RoleAdmin) && actor.Role == auth.RoleAdmin {
		return User{}, apperr.Unprocessable("self_demotion", "No puede desactivarse ni quitarse el rol de administrador a sí mismo")
	}
	if err := checkBranches(in.Role, in.BranchIDs); err != nil {
		return User{}, err
	}
	var hash *string
	if in.Password != nil {
		h, err := bcrypt.GenerateFromPassword([]byte(*in.Password), bcrypt.DefaultCost)
		if err != nil {
			return User{}, err
		}
		hs := string(h)
		hash = &hs
	}
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE users SET full_name = $2, role = $3, active = $4, password_hash = coalesce($5, password_hash) WHERE id = $1`,
			id, strings.TrimSpace(in.FullName), in.Role, in.Active, hash)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return apperr.NotFound("Usuario no encontrado")
		}
		return setBranches(ctx, tx, id, in.Role, in.BranchIDs)
	})
	if err != nil {
		return User{}, err
	}
	return s.Get(ctx, id)
}

// ---- HTTP ----

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) error {
	var in LoginInput
	if err := httpx.Decode(w, r, &in); err != nil {
		return err
	}
	res, err := h.svc.Login(r.Context(), in)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, res)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) error {
	u, err := h.svc.Get(r.Context(), auth.FromContext(r.Context()).UserID)
	if err != nil {
		return err
	}
	return httpx.JSON(w, http.StatusOK, u)
}

// Routes monta las rutas de administración de usuarios (solo admin).
func (h *Handler) Routes(r chi.Router) {
	r.Use(auth.RequireRoles(auth.RoleAdmin))
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := h.svc.List(r.Context())
		if err != nil {
			return err
		}
		if list == nil {
			list = []User{}
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"data": list})
	}))
	r.Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in CreateInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		u, err := h.svc.Create(r.Context(), in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, u)
	}))
	r.Put("/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		var in UpdateInput
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		u, err := h.svc.Update(r.Context(), auth.FromContext(r.Context()), id, in)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, u)
	}))
}
