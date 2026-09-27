package purchases

// allocateDiscount reparte un descuento global entre las líneas en proporción a su subtotal.
// Usa enteros (CLP): cada línea recibe la parte entera de su proporción y el resto (por redondeo)
// se asigna a las líneas de mayor subtotal, de modo que la suma de las partes es exactamente discount
// y ninguna línea recibe más que su propio subtotal.
func allocateDiscount(subtotals []int64, discount int64) []int64 {
	out := make([]int64, len(subtotals))
	var total int64
	for _, s := range subtotals {
		total += s
	}
	if discount <= 0 || total <= 0 {
		return out
	}
	if discount > total {
		discount = total
	}
	var assigned int64
	for i, s := range subtotals {
		out[i] = discount * s / total
		assigned += out[i]
	}
	// Reparte el resto, de a 1 peso, empezando por las líneas de mayor subtotal (orden estable).
	order := make([]int, len(subtotals))
	for i := range order {
		order[i] = i
	}
	for i := 1; i < len(order); i++ { // inserción: pocos elementos, orden estable
		for j := i; j > 0 && subtotals[order[j]] > subtotals[order[j-1]]; j-- {
			order[j], order[j-1] = order[j-1], order[j]
		}
	}
	for rest := discount - assigned; rest > 0; {
		for _, i := range order {
			if rest == 0 {
				break
			}
			if out[i] < subtotals[i] {
				out[i]++
				rest--
			}
		}
	}
	return out
}

// effectiveUnitCost es el costo unitario neto tras el descuento de la línea, redondeado al peso.
func effectiveUnitCost(subtotal, discount int64, qty int) int64 {
	if qty <= 0 {
		return 0
	}
	net := subtotal - discount
	return (2*net + int64(qty)) / (2 * int64(qty))
}
