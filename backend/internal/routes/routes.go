package routes

import (
	"encoding/json"
	"net/http"

	"frop/internal/room"
	"frop/internal/ws"
	"frop/models"
)

// Setup registers all API routes on the given mux
func Setup(mux *http.ServeMux) {
	mux.HandleFunc("/ws", ws.ServeHttp)
	mux.HandleFunc("GET /api/room/{code}", handleGetRoom)
	mux.HandleFunc("POST /api/room", handleCreateRoom)
}

func handleGetRoom(w http.ResponseWriter, req *http.Request) {
	defer req.Body.Close()

	code := req.PathValue("code")
	r, err := room.GetRoom(code)
	w.Header().Set("Content-Type", "application/json")

	var res *models.RoomResponse
	if err != nil {
		res = &models.RoomResponse{
			Error: err.Error(),
		}
	} else {
		res = &models.RoomResponse{
			Code: r.Code,
		}
	}
	json.NewEncoder(w).Encode(res)
}

func handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	code := room.CreateRoom()
	w.Header().Set("Content-Type", "application/json")
	resp := models.RoomResponse{
		Code: code,
	}
	json.NewEncoder(w).Encode(&resp)
}
