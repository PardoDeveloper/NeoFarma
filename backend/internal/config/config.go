// Package config carga la configuración desde variables de entorno (12-factor).
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	Env            string
	HTTPAddr       string
	DatabaseURL    string
	JWTSecret      string
	JWTTTL         time.Duration
	AllowedOrigins []string
	AutoMigrate    bool
}

func Load() (Config, error) {
	loadDotEnv(findDotEnv())

	cfg := Config{
		Env:            get("APP_ENV", "development"),
		HTTPAddr:       get("HTTP_ADDR", ":8080"),
		DatabaseURL:    get("DATABASE_URL", ""),
		JWTSecret:      get("JWT_SECRET", ""),
		AllowedOrigins: strings.Split(get("CORS_ORIGINS", "http://localhost:5173"), ","),
		AutoMigrate:    get("AUTO_MIGRATE", "true") == "true",
	}
	ttl, err := time.ParseDuration(get("JWT_TTL", "12h"))
	if err != nil {
		return cfg, fmt.Errorf("JWT_TTL inválido: %w", err)
	}
	cfg.JWTTTL = ttl

	if cfg.DatabaseURL == "" {
		return cfg, fmt.Errorf("DATABASE_URL es obligatorio")
	}
	if len(cfg.JWTSecret) < 32 {
		return cfg, fmt.Errorf("JWT_SECRET debe tener al menos 32 caracteres")
	}
	return cfg, nil
}

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// findDotEnv busca un archivo .env desde el directorio actual hacia arriba (útil al correr tests desde subpaquetes).
func findDotEnv() string {
	dir, err := os.Getwd()
	if err != nil {
		return ".env"
	}
	for {
		p := filepath.Join(dir, ".env")
		if _, err := os.Stat(p); err == nil {
			return p
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ".env"
		}
		dir = parent
	}
}

// loadDotEnv carga un archivo .env simple sin sobrescribir variables ya definidas.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if _, exists := os.LookupEnv(k); !exists {
			os.Setenv(k, v)
		}
	}
}
