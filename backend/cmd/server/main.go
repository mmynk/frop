package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"

	"frop/internal/room"
	"frop/models"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// client := ws.NewClient()
	// http.HandleFunc("/ws", client.ServeHttp)

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
