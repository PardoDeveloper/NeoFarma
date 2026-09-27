// Package apperr define errores de dominio con su código HTTP asociado.
package apperr

import (
	"errors"
	"net/http"
)

type Error struct {
	Status  int            `json:"-"`
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func (e *Error) WithDetails(d map[string]any) *Error {
	c := *e
	c.Details = d
	return &c
}

func New(status int, code, msg string) *Error {
	return &Error{Status: status, Code: code, Message: msg}
}

func NotFound(msg string) *Error   { return New(http.StatusNotFound, "not_found", msg) }
func BadRequest(msg string) *Error { return New(http.StatusBadRequest, "bad_request", msg) }
func Conflict(msg string) *Error   { return New(http.StatusConflict, "conflict", msg) }
func Unprocessable(code, msg string) *Error {
	return New(http.StatusUnprocessableEntity, code, msg)
}

var (
	ErrUnauthorized = New(http.StatusUnauthorized, "unauthorized", "Credenciales inválidas o sesión expirada")
	ErrForbidden    = New(http.StatusForbidden, "forbidden", "No tiene permisos para esta acción")
)

// As extrae un *Error de la cadena de errores.
func As(err error) (*Error, bool) {
	var e *Error
	ok := errors.As(err, &e)
	return e, ok
}
