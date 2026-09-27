// Package server compone el router HTTP con todos los módulos.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/branches"
	"github.com/neofarma/backend/internal/cash"
	"github.com/neofarma/backend/internal/catalog"
	"github.com/neofarma/backend/internal/inventory"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/httpx"
	"github.com/neofarma/backend/internal/purchases"
	"github.com/neofarma/backend/internal/reports"
	"github.com/neofarma/backend/internal/sales"
	"github.com/neofarma/backend/internal/suppliers"
	"github.com/neofarma/backend/internal/transfers"
	"github.com/neofarma/backend/internal/users"
)

type Deps struct {
	Pool           *pgxpool.Pool
	Tokens         *auth.Tokens
	AllowedOrigins []string
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, requestLogger, middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: d.AllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type", branch.Header},
		MaxAge:         600,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := d.Pool.Ping(ctx); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	usersH := users.NewHandler(users.NewService(d.Pool, d.Tokens))
	catalogH := catalog.NewHandler(catalog.NewService(d.Pool))

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", httpx.Handle(usersH.Login))

		r.Group(func(r chi.Router) {
			r.Use(d.Tokens.Middleware)
			r.Get("/auth/me", httpx.Handle(usersH.Me))
			r.Route("/users", usersH.Routes)
			r.Route("/categories", catalogH.CategoryRoutes)
			r.Route("/suppliers", suppliers.NewHandler(suppliers.NewService(d.Pool)).Routes)
			r.Route("/branches", branches.NewHandler(branches.NewService(d.Pool)).Routes)

			// Rutas operativas: requieren contexto de sucursal (header X-Branch-ID, ver docs/adr/0004-sucursales.md).
			r.Group(func(r chi.Router) {
				r.Use(branch.Middleware(d.Pool))
				r.Route("/products", catalogH.ProductRoutes)
				r.Route("/inventory", inventory.NewHandler(inventory.NewService(d.Pool)).Routes)
				r.Route("/purchases", purchases.NewHandler(purchases.NewService(d.Pool)).Routes)
				r.Route("/cash", cash.NewHandler(cash.NewService(d.Pool)).Routes)
				r.Route("/sales", sales.NewHandler(sales.NewService(d.Pool)).Routes)
				r.Route("/reports", reports.NewHandler(reports.NewService(d.Pool)).Routes)
				r.Route("/transfers", transfers.NewHandler(transfers.NewService(d.Pool)).Routes)
			})
		})
	})
	return r
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		if r.URL.Path == "/healthz" {
			return
		}
		slog.Info("http",
			"method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"bytes", ww.BytesWritten(), "duration_ms", time.Since(start).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()))
	})
}
