// Package auth maneja emisión/validación de JWT y autorización por rol.
package auth

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/httpx"
)

const (
	RoleAdmin   = "admin"
	RoleQuimico = "quimico"
	RoleCajero  = "cajero"
	RoleBodega  = "bodega"
)

// Principal es el usuario autenticado de la solicitud.
type Principal struct {
	UserID   int64  `json:"user_id"`
	Username string `json:"username"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}

type claims struct {
	Username string `json:"usr"`
	FullName string `json:"name"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type Tokens struct {
	secret []byte
	ttl    time.Duration
}

func NewTokens(secret string, ttl time.Duration) *Tokens {
	return &Tokens{secret: []byte(secret), ttl: ttl}
}

func (t *Tokens) Issue(p Principal) (string, time.Time, error) {
	exp := time.Now().Add(t.ttl)
	c := claims{
		Username: p.Username,
		FullName: p.FullName,
		Role:     p.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   fmt.Sprint(p.UserID),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(exp),
			Issuer:    "neofarma",
		},
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(t.secret)
	return s, exp, err
}

func (t *Tokens) Parse(token string) (Principal, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(*jwt.Token) (any, error) { return t.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer("neofarma"))
	if err != nil {
		return Principal{}, err
	}
	var id int64
	if _, err := fmt.Sscan(c.Subject, &id); err != nil {
		return Principal{}, err
	}
	return Principal{UserID: id, Username: c.Username, FullName: c.FullName, Role: c.Role}, nil
}

type ctxKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

// FromContext retorna el usuario autenticado. Solo debe usarse detrás de Middleware.
func FromContext(ctx context.Context) Principal {
	p, _ := ctx.Value(ctxKey{}).(Principal)
	return p
}

// Middleware exige un Bearer token válido.
func (t *Tokens) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok || token == "" {
			httpx.WriteError(w, r, apperr.ErrUnauthorized)
			return
		}
		p, err := t.Parse(token)
		if err != nil {
			httpx.WriteError(w, r, apperr.ErrUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

// RequireRoles restringe el acceso a los roles indicados (admin siempre tiene acceso).
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := FromContext(r.Context())
			if p.Role != RoleAdmin && !slices.Contains(roles, p.Role) {
				httpx.WriteError(w, r, apperr.ErrForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
