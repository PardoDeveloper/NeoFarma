// Package branch resuelve y valida la sucursal activa de cada request (header X-Branch-ID).
//
// Reglas (ver docs/adr/0004-sucursales.md):
//   - X-Branch-ID: <id>  → el usuario debe pertenecer a esa sucursal (admin: cualquiera) y estar activa.
//   - X-Branch-ID: all   → solo admin; alcance consolidado de SOLO LECTURA.
//   - sin header         → si el usuario pertenece a una única sucursal se usa esa; el admin obtiene "all".
//
// Las escrituras obtienen la sucursal con Require, que falla si el alcance es "all".
package branch

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
)

const Header = "X-Branch-ID"

// Scope es el alcance de sucursal de un request. ID nil = todas las sucursales (solo admin, solo lectura).
type Scope struct {
	ID *int64
}

type ctxKey struct{}

// FromContext retorna el alcance del request. Solo válido detrás de Middleware.
func FromContext(ctx context.Context) Scope {
	s, _ := ctx.Value(ctxKey{}).(Scope)
	return s
}

// WithScope agrega el alcance al contexto (útil en tests y en código que llama servicios directamente).
func WithScope(ctx context.Context, s Scope) context.Context {
	return context.WithValue(ctx, ctxKey{}, s)
}

// Require retorna la sucursal concreta del request; falla si el alcance es "todas" (operaciones de escritura).
func Require(ctx context.Context) (int64, error) {
	s := FromContext(ctx)
	if s.ID == nil {
		return 0, ErrRequired
	}
	return *s.ID, nil
}

var (
	ErrRequired = apperr.Unprocessable("branch_required", "Seleccione una sucursal para realizar esta operación")
	ErrNoAccess = apperr.New(http.StatusForbidden, "branch_forbidden", "No tiene acceso a esta sucursal")
)

// Middleware valida el header X-Branch-ID contra las sucursales del usuario. Debe ir después de auth.
func Middleware(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scope, err := resolve(r.Context(), pool, auth.FromContext(r.Context()), strings.TrimSpace(r.Header.Get(Header)))
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithScope(r.Context(), scope)))
		})
	}
}

func resolve(ctx context.Context, pool *pgxpool.Pool, p auth.Principal, header string) (Scope, error) {
	isAdmin := p.Role == auth.RoleAdmin
	switch header {
	case "all":
		if !isAdmin {
			return Scope{}, ErrNoAccess
		}
		return Scope{}, nil
	case "":
		if isAdmin {
			return Scope{}, nil
		}
		// Sin header: válido solo si el usuario trabaja en una única sucursal activa.
		var ids []int64
		rows, err := pool.Query(ctx, `
			SELECT b.id FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
			WHERE ub.user_id = $1 AND b.active`, p.UserID)
		if err != nil {
			return Scope{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return Scope{}, err
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			return Scope{}, err
		}
		if len(ids) != 1 {
			return Scope{}, ErrRequired
		}
		return Scope{ID: &ids[0]}, nil
	}

	id, err := strconv.ParseInt(header, 10, 64)
	if err != nil || id <= 0 {
		return Scope{}, apperr.BadRequest("Header " + Header + " inválido")
	}
	var active, member bool
	err = pool.QueryRow(ctx, `
		SELECT b.active, EXISTS (SELECT 1 FROM user_branches WHERE user_id = $2 AND branch_id = b.id)
		FROM branches b WHERE b.id = $1`, id, p.UserID).Scan(&active, &member)
	if db.IsNoRows(err) {
		return Scope{}, ErrNoAccess
	}
	if err != nil {
		return Scope{}, err
	}
	// El admin accede a cualquier sucursal (incluso inactiva, para consultar su historia).
	if !isAdmin && (!member || !active) {
		return Scope{}, ErrNoAccess
	}
	return Scope{ID: &id}, nil
}
