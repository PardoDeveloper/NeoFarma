// Package rut valida y normaliza RUT chilenos (módulo 11).
package rut

import (
	"strconv"
	"strings"
)

// Normalize retorna el RUT en formato "12345678-9" o "" si es inválido.
func Normalize(s string) string {
	s = strings.ToUpper(strings.NewReplacer(".", "", " ", "", "-", "").Replace(strings.TrimSpace(s)))
	if len(s) < 2 || len(s) > 9 {
		return ""
	}
	body, dv := s[:len(s)-1], s[len(s)-1:]
	n, err := strconv.Atoi(body)
	if err != nil || n <= 0 {
		return ""
	}
	if checkDigit(n) != dv {
		return ""
	}
	return strconv.Itoa(n) + "-" + dv
}

func Valid(s string) bool { return Normalize(s) != "" }

func checkDigit(n int) string {
	sum, mul := 0, 2
	for ; n > 0; n /= 10 {
		sum += (n % 10) * mul
		mul++
		if mul > 7 {
			mul = 2
		}
	}
	switch r := 11 - sum%11; r {
	case 11:
		return "0"
	case 10:
		return "K"
	default:
		return strconv.Itoa(r)
	}
}

// FromNumber construye un RUT válido "12345678-9" a partir del número sin dígito verificador.
func FromNumber(n int) string { return strconv.Itoa(n) + "-" + checkDigit(n) }
