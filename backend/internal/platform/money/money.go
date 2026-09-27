// Package money contiene cálculos monetarios en pesos chilenos enteros (CLP) e IVA.
package money

// TaxRatePercent es la tasa de IVA vigente en Chile.
const TaxRatePercent = 19

// roundDiv divide redondeando al entero más cercano (a mitad hacia arriba) para valores no negativos.
func roundDiv(a, b int64) int64 { return (2*a + b) / (2 * b) }

// TaxFromNet calcula el IVA de un monto neto.
func TaxFromNet(net int64) int64 { return roundDiv(net*TaxRatePercent, 100) }

// SplitGross separa un monto bruto (IVA incluido) en neto e IVA. net + tax == gross siempre.
func SplitGross(gross int64) (net, tax int64) {
	net = roundDiv(gross*100, 100+TaxRatePercent)
	return net, gross - net
}
