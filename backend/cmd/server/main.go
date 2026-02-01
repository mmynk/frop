package main

import (
	"log/slog"
	"net/http"
	"os"
	// "frop/internal/ws"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// client := ws.NewClient()
	// http.HandleFunc("/ws", client.ServeHttp)

	http.Handle("/", http.FileServer(http.Dir("../frontend")))

	slog.Info("Server starting", "port", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		slog.Error("Server failed", "error", err)
	}
}
