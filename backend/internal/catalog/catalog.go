// Package catalog gestiona categorías y productos.
package catalog

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/neofarma/backend/internal/platform/apperr"
	"github.com/neofarma/backend/internal/platform/auth"
	"github.com/neofarma/backend/internal/platform/branch"
	"github.com/neofarma/backend/internal/platform/db"
	"github.com/neofarma/backend/internal/platform/httpx"
)

type Category struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Products int    `json:"products"`
}

type Product struct {
	ID               int64        `json:"id"`
	SKU              string       `json:"sku"`
	Barcode          *string      `json:"barcode"`
	Name             string       `json:"name"`
	ActiveIngredient *string      `json:"active_ingredient"` // resumen: "Paracetamol + Cafeína"
	Concentration    *string      `json:"concentration"`     // resumen: "325 mg + 30 mg"
	Ingredients      []Ingredient `json:"ingredients"`
	Presentation     *string      `json:"presentation"`
	Laboratory       *string      `json:"laboratory"`
	CategoryID       *int64       `json:"category_id"`
	CategoryName     *string      `json:"category_name"`
	SaleCondition    string       `json:"sale_condition"`
	IsBioequivalent  bool         `json:"is_bioequivalent"`
	IsGeneric        bool         `json:"is_generic"`
	DosageForm       *string      `json:"dosage_form"`
	ISPRegistry      *string      `json:"isp_registry"`
	Price            int64        `json:"price"`
	Cost             *int64       `json:"cost,omitempty"` // costo neto de compra; se omite para el cajero (ver withoutCost)
	MinStock         int          `json:"min_stock"`
	Active           bool         `json:"active"`
	Stock            int          `json:"stock"`
	StockSellable    int          `json:"stock_sellable"`
	NextExpiry       *time.Time   `json:"next_expiry"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

type Lot struct {
	ID           int64     `json:"id"`
	BranchID     int64     `json:"branch_id"`
	BranchName   string    `json:"branch_name"`
	LotNumber    *string   `json:"lot_number"` // nil = sin lote
	ExpiryDate   time.Time `json:"expiry_date"`
	QtyInitial   int       `json:"qty_initial"`
	QtyAvailable int       `json:"qty_available"`
	UnitCost     int64     `json:"unit_cost"`
	PurchaseID   *int64    `json:"purchase_id"`
	CreatedAt    time.Time `json:"created_at"`
}

type ProductDetail struct {
	Product
	Lots []Lot `json:"lots"`
}

type ProductInput struct {
	SKU             string            `json:"sku" validate:"required,max=40"`
	Barcode         *string           `json:"barcode" validate:"omitempty,max=40"`
	Name            string            `json:"name" validate:"required,min=2,max=200"`
	Ingredients     []IngredientInput `json:"ingredients" validate:"max=10,dive"`
	Presentation    *string           `json:"presentation" validate:"omitempty,max=120"`
	Laboratory      *string           `json:"laboratory" validate:"omitempty,max=120"`
	CategoryID      *int64            `json:"category_id" validate:"omitempty,gt=0"`
	SaleCondition   string            `json:"sale_condition" validate:"required,oneof=directa receta_simple receta_retenida receta_cheque"`
	IsBioequivalent bool              `json:"is_bioequivalent"`
	IsGeneric       bool              `json:"is_generic"`
	DosageForm      *string           `json:"dosage_form" validate:"omitempty,max=40"`
	ISPRegistry     *string           `json:"isp_registry" validate:"omitempty,max=30"`
	Price           int64             `json:"price" validate:"gte=0,lte=100000000"`
	Cost            int64             `json:"cost" validate:"gte=0,lte=100000000"`
	MinStock        int               `json:"min_stock" validate:"gte=0,lte=1000000"`
	Active          *bool             `json:"active"`
}

type ProductFilter struct {
	Query           string
	CategoryID      *int64
	LowStock        bool
	IncludeInactive bool
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ---- Categorías ----

func (s *Service) ListCategories(ctx context.Context) ([]Category, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.name, count(p.id)::int
		FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.active
		GROUP BY c.id ORDER BY c.name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Category, error) {
		var c Category
		return c, r.Scan(&c.ID, &c.Name, &c.Products)
	})
}

func (s *Service) CreateCategory(ctx context.Context, name string) (Category, error) {
	c := Category{Name: strings.TrimSpace(name)}
	err := s.pool.QueryRow(ctx, `INSERT INTO categories (name) VALUES ($1) RETURNING id`, c.Name).Scan(&c.ID)
	if db.IsUniqueViolation(err) {
		return c, apperr.Conflict("La categoría ya existe")
	}
	return c, err
}

// ---- Productos ----

const productSelect = `
	SELECT p.id, p.sku, p.barcode, p.name, p.active_ingredient, p.concentration, p.presentation,
	       p.laboratory, p.category_id, c.name, p.sale_condition, p.is_bioequivalent, p.is_generic,
	       p.dosage_form, p.isp_registry, p.price, p.cost,
	       p.min_stock, p.active, ps.stock_total, ps.stock_sellable, ps.next_expiry, p.created_at, p.updated_at,
	       ` + ingredientsJSON + `
	FROM products p
	` + stockLateral + `
	LEFT JOIN categories c ON c.id = p.category_id`

// stockLateral calcula el stock del producto en la sucursal $1 (NULL = todas las sucursales).
// Toda consulta que lo use debe pasar la sucursal como primer parámetro.
const stockLateral = `
	CROSS JOIN LATERAL (
		SELECT coalesce(sum(l.qty_available), 0)::int AS stock_total,
		       coalesce(sum(l.qty_available) FILTER (WHERE l.expiry_date >= current_date), 0)::int AS stock_sellable,
		       min(l.expiry_date) FILTER (WHERE l.expiry_date >= current_date) AS next_expiry
		FROM product_lots l
		WHERE l.product_id = p.id AND l.qty_available > 0 AND ($1::bigint IS NULL OR l.branch_id = $1)
	) ps`

func scanProduct(r pgx.Row) (Product, error) {
	var p Product
	err := r.Scan(&p.ID, &p.SKU, &p.Barcode, &p.Name, &p.ActiveIngredient, &p.Concentration, &p.Presentation,
		&p.Laboratory, &p.CategoryID, &p.CategoryName, &p.SaleCondition, &p.IsBioequivalent, &p.IsGeneric,
		&p.DosageForm, &p.ISPRegistry, &p.Price, &p.Cost,
		&p.MinStock, &p.Active, &p.Stock, &p.StockSellable, &p.NextExpiry, &p.CreatedAt, &p.UpdatedAt,
		&p.Ingredients)
	return p, err
}

// ListProducts lista el catálogo con el stock de la sucursal indicada (nil = todas).
func (s *Service) ListProducts(ctx context.Context, branch *int64, f ProductFilter, pg httpx.Page) ([]Product, int, error) {
	where := []string{"true"}
	args := []any{branch}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, fmt.Sprintf(cond, len(args)))
	}
	if !f.IncludeInactive {
		where = append(where, "p.active")
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		args = append(args, "%"+q+"%", q)
		n := len(args)
		where = append(where, fmt.Sprintf(
			`((p.name || ' ' || coalesce(p.active_ingredient, '') || ' ' || coalesce(p.laboratory, '')) ILIKE $%d
			  OR p.sku = $%d OR p.barcode = $%d OR p.isp_registry = upper($%d))`, n-1, n, n, n))
	}
	if f.CategoryID != nil {
		add("p.category_id = $%d", *f.CategoryID)
	}
	if f.LowStock {
		where = append(where, "ps.stock_sellable <= p.min_stock")
	}
	cond := strings.Join(where, " AND ")

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM products p `+stockLateral+` WHERE `+cond, args...).
		Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count products: %w", err)
	}
	args = append(args, pg.PageSize, pg.Offset())
	rows, err := s.pool.Query(ctx, productSelect+` WHERE `+cond+
		fmt.Sprintf(` ORDER BY p.name LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list products: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Product, error) { return scanProduct(r) })
	return list, total, err
}

// GetProduct retorna el producto con el stock y los lotes de la sucursal indicada (nil = todas).
func (s *Service) GetProduct(ctx context.Context, branch *int64, id int64) (ProductDetail, error) {
	p, err := scanProduct(s.pool.QueryRow(ctx, productSelect+` WHERE p.id = $2`, branch, id))
	if db.IsNoRows(err) {
		return ProductDetail{}, apperr.NotFound("Producto no encontrado")
	}
	if err != nil {
		return ProductDetail{}, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.branch_id, b.name, l.lot_number, l.expiry_date, l.qty_initial, l.qty_available, l.unit_cost, l.purchase_id, l.created_at
		FROM product_lots l JOIN branches b ON b.id = l.branch_id
		WHERE l.product_id = $1 AND l.qty_available > 0 AND ($2::bigint IS NULL OR l.branch_id = $2)
		ORDER BY l.expiry_date, l.id`, id, branch)
	if err != nil {
		return ProductDetail{}, err
	}
	lots, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Lot, error) {
		var l Lot
		return l, r.Scan(&l.ID, &l.BranchID, &l.BranchName, &l.LotNumber, &l.ExpiryDate, &l.QtyInitial, &l.QtyAvailable, &l.UnitCost, &l.PurchaseID, &l.CreatedAt)
	})
	if lots == nil {
		lots = []Lot{}
	}
	return ProductDetail{Product: p, Lots: lots}, err
}

// Lookup busca un producto activo por código exacto (código de barras o SKU), usado por el lector del POS.
// El stock informado es el de la sucursal indicada.
func (s *Service) Lookup(ctx context.Context, branch *int64, code string) (Product, error) {
	code = strings.TrimSpace(code)
	p, err := scanProduct(s.pool.QueryRow(ctx, productSelect+` WHERE p.active AND (p.barcode = $2 OR p.sku = $2) LIMIT 1`, branch, code))
	if db.IsNoRows(err) {
		return p, apperr.NotFound("No existe un producto con el código " + code)
	}
	return p, err
}

func (s *Service) CreateProduct(ctx context.Context, branch *int64, in ProductInput) (ProductDetail, error) {
	if err := in.prepare(); err != nil {
		return ProductDetail{}, err
	}
	names, conc := summarizeIngredients(in.Ingredients)
	var id int64
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO products (sku, barcode, name, active_ingredient, concentration, presentation, laboratory,
			                      category_id, sale_condition, is_bioequivalent, is_generic, dosage_form, isp_registry,
			                      price, cost, min_stock, active)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,coalesce($17,true)) RETURNING id`,
			in.SKU, in.Barcode, in.Name, names, conc, in.Presentation, in.Laboratory,
			in.CategoryID, in.SaleCondition, in.IsBioequivalent, in.IsGeneric, in.DosageForm, in.ISPRegistry,
			in.Price, in.Cost, in.MinStock, in.Active).Scan(&id)
		if err := productWriteErr(err); err != nil {
			return err
		}
		return saveIngredients(ctx, tx, id, in.Ingredients)
	})
	if err != nil {
		return ProductDetail{}, err
	}
	return s.GetProduct(ctx, branch, id)
}

func (s *Service) UpdateProduct(ctx context.Context, branch *int64, id int64, in ProductInput) (ProductDetail, error) {
	if err := in.prepare(); err != nil {
		return ProductDetail{}, err
	}
	names, conc := summarizeIngredients(in.Ingredients)
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE products SET sku=$2, barcode=$3, name=$4, active_ingredient=$5, concentration=$6, presentation=$7,
			       laboratory=$8, category_id=$9, sale_condition=$10, is_bioequivalent=$11, is_generic=$12,
			       dosage_form=$13, isp_registry=$14, price=$15, cost=$16, min_stock=$17, active=coalesce($18, active)
			WHERE id = $1`,
			id, in.SKU, in.Barcode, in.Name, names, conc, in.Presentation, in.Laboratory,
			in.CategoryID, in.SaleCondition, in.IsBioequivalent, in.IsGeneric, in.DosageForm, in.ISPRegistry,
			in.Price, in.Cost, in.MinStock, in.Active)
		if err := productWriteErr(err); err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return apperr.NotFound("Producto no encontrado")
		}
		return saveIngredients(ctx, tx, id, in.Ingredients)
	})
	if err != nil {
		return ProductDetail{}, err
	}
	return s.GetProduct(ctx, branch, id)
}

func productWriteErr(err error) error {
	switch {
	case err == nil:
		return nil
	case db.IsUniqueViolation(err):
		return apperr.Conflict("Ya existe un producto con ese SKU o código de barras")
	case db.IsFKViolation(err):
		return apperr.Unprocessable("invalid_category", "La categoría indicada no existe")
	}
	return err
}

// DosageForms son los códigos de forma farmacéutica aceptados (espejo del CHECK de la migración 00002).
var DosageForms = []string{
	"comprimido", "comprimido_recubierto", "comprimido_efervescente", "comprimido_masticable",
	"comprimido_liberacion_prolongada", "capsula", "capsula_blanda", "jarabe", "suspension_oral",
	"solucion_oral", "gotas_orales", "polvo_suspension_oral", "granulado", "solucion_inyectable",
	"polvo_inyectable", "crema", "gel", "unguento", "locion", "solucion_topica", "supositorio",
	"ovulo", "aerosol_inhalacion", "polvo_inhalacion", "spray_nasal", "solucion_oftalmica",
	"gotas_oticas", "parche_transdermico", "otro",
}

// ispRegistryRe valida el formato del registro sanitario ISP, ej. "F-12345/20".
var ispRegistryRe = regexp.MustCompile(`^[A-Z]{1,3}-[0-9]{1,6}/[0-9]{2,4}$`)

// prepare normaliza el input y valida las reglas que el validador por tags no cubre.
func (in *ProductInput) prepare() error {
	in.SKU = strings.ToUpper(strings.TrimSpace(in.SKU))
	in.Name = strings.TrimSpace(in.Name)
	for _, p := range []**string{&in.Barcode, &in.Presentation, &in.Laboratory, &in.DosageForm, &in.ISPRegistry} {
		if *p != nil {
			v := strings.TrimSpace(**p)
			if v == "" {
				*p = nil
			} else {
				*p = &v
			}
		}
	}
	fields := map[string]any{}
	prepareIngredients(in.Ingredients, fields)
	if in.DosageForm != nil && !slices.Contains(DosageForms, *in.DosageForm) {
		fields["dosage_form"] = "oneof"
	}
	if in.ISPRegistry != nil {
		v := strings.ToUpper(strings.ReplaceAll(*in.ISPRegistry, " ", ""))
		in.ISPRegistry = &v
		if !ispRegistryRe.MatchString(v) {
			fields["isp_registry"] = "format"
		}
	}
	if len(fields) > 0 {
		return apperr.Unprocessable("validation_error", "Datos inválidos").WithDetails(map[string]any{"fields": fields})
	}
	return nil
}

// ---- HTTP ----

// hideCost indica si se debe omitir el costo de compra: el cajero solo ve el precio de venta al público.
func hideCost(r *http.Request) bool {
	return auth.FromContext(r.Context()).Role == auth.RoleCajero
}

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) CategoryRoutes(r chi.Router) {
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		list, err := h.svc.ListCategories(r.Context())
		if err != nil {
			return err
		}
		if list == nil {
			list = []Category{}
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"data": list})
	}))
	r.With(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega)).Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Name string `json:"name" validate:"required,min=2,max=80"`
		}
		if err := httpx.Decode(w, r, &in); err != nil {
			return err
		}
		c, err := h.svc.CreateCategory(r.Context(), in.Name)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusCreated, c)
	}))
}

func (h *Handler) ProductRoutes(r chi.Router) {
	r.Get("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		f := ProductFilter{
			Query:           q.Get("q"),
			CategoryID:      httpx.QueryInt64(r, "category_id"),
			LowStock:        q.Get("low_stock") == "true",
			IncludeInactive: q.Get("include_inactive") == "true",
		}
		pg := httpx.ParsePage(r)
		list, total, err := h.svc.ListProducts(r.Context(), branch.FromContext(r.Context()).ID, f, pg)
		if err != nil {
			return err
		}
		if hideCost(r) {
			for i := range list {
				list[i].Cost = nil
			}
		}
		return httpx.JSON(w, http.StatusOK, httpx.NewList(list, total, pg))
	}))
	r.Get("/lookup", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		code := r.URL.Query().Get("code")
		if strings.TrimSpace(code) == "" {
			return apperr.BadRequest("Debe indicar el parámetro code")
		}
		p, err := h.svc.Lookup(r.Context(), branch.FromContext(r.Context()).ID, code)
		if err != nil {
			return err
		}
		if hideCost(r) {
			p.Cost = nil
		}
		return httpx.JSON(w, http.StatusOK, p)
	}))
	// Ficha completa (lotes, costos): solo químico, bodega y admin. El cajero usa la lista y /lookup desde el POS.
	r.With(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega)).Get("/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		id, err := httpx.IDParam(r, "id")
		if err != nil {
			return err
		}
		p, err := h.svc.GetProduct(r.Context(), branch.FromContext(r.Context()).ID, id)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, p)
	}))

	r.Group(func(r chi.Router) {
		r.Use(auth.RequireRoles(auth.RoleQuimico, auth.RoleBodega))
		r.Post("/", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			var in ProductInput
			if err := httpx.Decode(w, r, &in); err != nil {
				return err
			}
			p, err := h.svc.CreateProduct(r.Context(), branch.FromContext(r.Context()).ID, in)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusCreated, p)
		}))
		r.Put("/{id}", httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			id, err := httpx.IDParam(r, "id")
			if err != nil {
				return err
			}
			var in ProductInput
			if err := httpx.Decode(w, r, &in); err != nil {
				return err
			}
			p, err := h.svc.UpdateProduct(r.Context(), branch.FromContext(r.Context()).ID, id, in)
			if err != nil {
				return err
			}
			return httpx.JSON(w, http.StatusOK, p)
		}))
	})
}
