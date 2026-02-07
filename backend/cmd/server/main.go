package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"

	"frop/internal/room"
	"frop/internal/ws"
	"frop/models"

	"github.com/lmittmann/tint"
)

func main() {
	setupLogging(slog.LevelInfo)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/ws", ws.ServeHttp)

	http.HandleFunc("POST /api/room", handleCreateRoom)
	http.Handle("/", http.FileServer(http.Dir("../frontend")))

	slog.Info("Server starting", "port", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		slog.Error("Server failed", "error", err)
	}
}

func handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	code := room.CreateRoom()
	w.Header().Set("Content-Type", "application/json")
	resp := models.CreateRoomResponse{
		Code: code,
	}
	json.NewEncoder(w).Encode(&resp)
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
