package rut

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"11.111.111-1", "11111111-1"},
		{"76.086.428-5", "76086428-5"},
		{"12345678-5", "12345678-5"},
		{"12.345.678-k", ""},
		{"10.000.013-k", "10000013-K"},
		{"12345678-9", ""},
		{"", ""},
		{"abc", ""},
	}
	for _, c := range cases {
		if got := Normalize(c.in); got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
