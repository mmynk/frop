package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"frop/internal/routes"

	"github.com/lmittmann/tint"
)

func main() {
	setupLogging(slog.LevelInfo)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()
	routes.Setup(mux)
	mux.Handle("/", http.FileServer(http.Dir("../frontend")))

	slog.Info("Server starting", "port", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		slog.Error("Server failed", "error", err)
	}
}

// setupLogging configures colored logging with source info
func setupLogging(level slog.Level) {
	slog.SetDefault(slog.New(
		tint.NewHandler(os.Stderr, &tint.Options{
			Level:      level,
			TimeFormat: time.Kitchen,
			AddSource:  true,
		}),
	))
}
