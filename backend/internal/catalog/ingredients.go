package catalog

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Ingredient es un principio activo de la composición de un producto (ej. Paracetamol 325 mg).
type Ingredient struct {
	Name string   `json:"name"`
	Dose *float64 `json:"dose"`
	Unit *string  `json:"unit"`
}

type IngredientInput struct {
	Name string   `json:"name" validate:"required,min=2,max=120"`
	Dose *float64 `json:"dose" validate:"omitempty,gt=0,lte=1000000"`
	Unit *string  `json:"unit" validate:"omitempty,max=20"`
}

// IngredientUnits son las unidades de dosis aceptadas (espejo del CHECK de la migración 00003).
var IngredientUnits = []string{"mg", "g", "mcg", "UI", "ml", "%", "mg/ml", "mg/5 ml", "mcg/dosis", "mEq"}

// prepareIngredients normaliza la composición y agrega a fields los errores por fila
// (claves "ingredients[i].name" / "ingredients[i].unit", mismo formato que el validador).
func prepareIngredients(list []IngredientInput, fields map[string]any) {
	seen := map[string]bool{}
	for i := range list {
		ing := &list[i]
		ing.Name = strings.Join(strings.Fields(ing.Name), " ")
		key := strings.ToLower(ing.Name)
		if seen[key] {
			fields[fmt.Sprintf("ingredients[%d].name", i)] = "unique"
		}
		seen[key] = true

		if ing.Dose == nil {
			ing.Unit = nil // sin dosis la unidad no aplica
			continue
		}
		if ing.Unit == nil || !slices.Contains(IngredientUnits, *ing.Unit) {
			fields[fmt.Sprintf("ingredients[%d].unit", i)] = "oneof"
		}
	}
}

// summarizeIngredients arma el resumen desnormalizado que se guarda en products:
// nombres "Paracetamol + Cafeína" y concentración "325 mg + 30 mg".
func summarizeIngredients(list []IngredientInput) (names, concentration *string) {
	if len(list) == 0 {
		return nil, nil
	}
	var ns, cs []string
	for _, ing := range list {
		ns = append(ns, ing.Name)
		if ing.Dose != nil && ing.Unit != nil {
			cs = append(cs, FormatDose(*ing.Dose)+" "+*ing.Unit)
		}
	}
	n := strings.Join(ns, " + ")
	names = &n
	if len(cs) > 0 {
		c := strings.Join(cs, " + ")
		concentration = &c
	}
	return names, concentration
}

// FormatDose formatea la dosis al estilo chileno, sin ceros sobrantes: 0.5 → "0,5", 325 → "325".
func FormatDose(d float64) string {
	return strings.Replace(strconv.FormatFloat(d, 'f', -1, 64), ".", ",", 1)
}

// saveIngredients reemplaza la composición completa del producto dentro de la transacción.
func saveIngredients(ctx context.Context, tx pgx.Tx, productID int64, list []IngredientInput) error {
	if _, err := tx.Exec(ctx, `DELETE FROM product_ingredients WHERE product_id = $1`, productID); err != nil {
		return fmt.Errorf("delete ingredients: %w", err)
	}
	for i, ing := range list {
		if _, err := tx.Exec(ctx, `
			INSERT INTO product_ingredients (product_id, position, name, dose, unit) VALUES ($1, $2, $3, $4, $5)`,
			productID, i+1, ing.Name, ing.Dose, ing.Unit); err != nil {
			return fmt.Errorf("insert ingredient: %w", err)
		}
	}
	return nil
}

// ingredientsJSON es la subconsulta que adjunta la composición ordenada a cada producto.
const ingredientsJSON = `coalesce((
		SELECT json_agg(json_build_object('name', pi.name, 'dose', pi.dose::float8, 'unit', pi.unit) ORDER BY pi.position)
		FROM product_ingredients pi WHERE pi.product_id = p.id), '[]'::json)`
