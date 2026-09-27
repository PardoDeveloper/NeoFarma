// Package httpx contiene utilidades HTTP compartidas: JSON, errores, validación y paginación.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-playground/validator/v10"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/rut"
)

const maxBodyBytes = 1 << 20 // 1 MiB

var validate = newValidator()

func newValidator() *validator.Validate {
	v := validator.New(validator.WithRequiredStructEnabled())
	_ = v.RegisterValidation("rut", func(fl validator.FieldLevel) bool {
		return rut.Valid(fl.Field().String())
	})
	return v
}

// HandlerFunc es un handler que retorna error; Handle lo adapta a http.HandlerFunc.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

func Handle(h HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			WriteError(w, r, err)
		}
	}
}

func JSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return nil
	}
	return json.NewEncoder(w).Encode(v)
}

func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	e, ok := apperr.As(err)
	if !ok {
		slog.ErrorContext(r.Context(), "internal error",
			"err", err, "path", r.URL.Path, "method", r.Method,
			"request_id", middleware.GetReqID(r.Context()))
		e = apperr.New(http.StatusInternalServerError, "internal", "Error interno del servidor")
	}
	_ = JSON(w, e.Status, map[string]any{"error": e})
}

// Decode lee el body JSON (con límite de tamaño, sin campos desconocidos) y lo valida.
func Decode(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return apperr.BadRequest("El cuerpo de la solicitud está vacío")
		}
		return apperr.BadRequest("JSON inválido: " + err.Error())
	}
	return Validate(dst)
}

func Validate(v any) error {
	if err := validate.Struct(v); err != nil {
		var ve validator.ValidationErrors
		if errors.As(err, &ve) {
			fields := map[string]any{}
			for _, fe := range ve {
				fields[jsonFieldPath(fe.Namespace())] = fe.Tag()
			}
			return apperr.Unprocessable("validation_error", "Datos inválidos").WithDetails(map[string]any{"fields": fields})
		}
		return apperr.BadRequest(err.Error())
	}
	return nil
}

// jsonFieldPath convierte "CreateReq.Items[0].ProductID" en "items[0].product_id".
func jsonFieldPath(ns string) string {
	parts := strings.Split(ns, ".")
	if len(parts) > 1 {
		parts = parts[1:]
	}
	for i, p := range parts {
		parts[i] = toSnake(p)
	}
	return strings.Join(parts, ".")
}

func toSnake(s string) string {
	var b strings.Builder
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			if i > 0 && s[i-1] != '[' && !(s[i-1] >= 'A' && s[i-1] <= 'Z') {
				b.WriteByte('_')
			}
			b.WriteRune(r + ('a' - 'A'))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// IDParam obtiene un parámetro de ruta numérico positivo.
func IDParam(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(chi.URLParam(r, name), 10, 64)
	if err != nil || id <= 0 {
		return 0, apperr.BadRequest("Identificador inválido")
	}
	return id, nil
}

// Page describe parámetros de paginación.
type Page struct {
	Page     int
	PageSize int
}

func (p Page) Offset() int { return (p.Page - 1) * p.PageSize }

func ParsePage(r *http.Request) Page {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	size, _ := strconv.Atoi(q.Get("page_size"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return Page{Page: page, PageSize: size}
}

// List es la respuesta estándar de listados paginados.
type List[T any] struct {
	Data     []T `json:"data"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}

func NewList[T any](data []T, total int, p Page) List[T] {
	if data == nil {
		data = []T{}
	}
	return List[T]{Data: data, Total: total, Page: p.Page, PageSize: p.PageSize}
}

// QueryInt64 lee un parámetro de query numérico opcional.
func QueryInt64(r *http.Request, key string) *int64 {
	v, err := strconv.ParseInt(r.URL.Query().Get(key), 10, 64)
	if err != nil {
		return nil
	}
	return &v
}
