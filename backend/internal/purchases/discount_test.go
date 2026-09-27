package purchases

import "testing"

func sum(xs []int64) (t int64) {
	for _, x := range xs {
		t += x
	}
	return
}

func TestAllocateDiscount(t *testing.T) {
	cases := []struct {
		name      string
		subtotals []int64
		discount  int64
		want      []int64
	}{
		{"sin descuento", []int64{1000, 2000}, 0, []int64{0, 0}},
		{"proporcional exacto", []int64{30000, 70000}, 10000, []int64{3000, 7000}},
		{"resto a la línea mayor", []int64{100, 100, 101}, 100, []int64{33, 33, 34}},
		{"una línea", []int64{5000}, 1234, []int64{1234}},
		{"descuento igual al subtotal", []int64{300, 700}, 1000, []int64{300, 700}},
		{"línea en cero", []int64{0, 1000}, 500, []int64{0, 500}},
	}
	for _, c := range cases {
		got := allocateDiscount(c.subtotals, c.discount)
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("%s: %v, want %v", c.name, got, c.want)
				break
			}
		}
		if sum(got) != min(c.discount, sum(c.subtotals)) {
			t.Errorf("%s: la suma %d no cuadra con el descuento %d", c.name, sum(got), c.discount)
		}
		for i := range got {
			if got[i] > c.subtotals[i] || got[i] < 0 {
				t.Errorf("%s: la línea %d recibe %d (subtotal %d)", c.name, i, got[i], c.subtotals[i])
			}
		}
	}
}

func TestEffectiveUnitCost(t *testing.T) {
	cases := []struct {
		subtotal, discount int64
		qty                int
		want               int64
	}{
		{10000, 0, 10, 1000},
		{10000, 1000, 10, 900},
		{1000, 1, 3, 333}, // 999/3
		{1000, 0, 3, 333}, // 333,33 → 333
		{1001, 0, 2, 501}, // 500,5 → 501 (mitad hacia arriba)
	}
	for _, c := range cases {
		if got := effectiveUnitCost(c.subtotal, c.discount, c.qty); got != c.want {
			t.Errorf("effectiveUnitCost(%d, %d, %d) = %d, want %d", c.subtotal, c.discount, c.qty, got, c.want)
		}
	}
}
