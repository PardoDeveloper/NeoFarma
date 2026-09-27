package money

import "testing"

func TestTaxFromNet(t *testing.T) {
	cases := map[int64]int64{0: 0, 100: 19, 1000: 190, 1234: 234, 5: 1, 2: 0}
	for net, want := range cases {
		if got := TaxFromNet(net); got != want {
			t.Errorf("TaxFromNet(%d) = %d, want %d", net, got, want)
		}
	}
}

func TestSplitGross(t *testing.T) {
	cases := []struct{ gross, net, tax int64 }{
		{0, 0, 0},
		{119, 100, 19},
		{1190, 1000, 190},
		{2990, 2513, 477},
		{1, 1, 0},
	}
	for _, c := range cases {
		net, tax := SplitGross(c.gross)
		if net != c.net || tax != c.tax {
			t.Errorf("SplitGross(%d) = (%d, %d), want (%d, %d)", c.gross, net, tax, c.net, c.tax)
		}
		if net+tax != c.gross {
			t.Errorf("SplitGross(%d): net+tax != gross", c.gross)
		}
	}
}
