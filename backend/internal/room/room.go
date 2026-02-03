package room

import (
	"fmt"
	"log/slog"
	"math/rand/v2"

	"github.com/gorilla/websocket"
)

var alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

type Room struct {
	Peers []*Peer
	Code  string
}

// CreateRoom creates a new empty room, stores it, and returns the code
func CreateRoom() string {
	peers := make([]*Peer, 0, 2)
	code := generateRandomCode()
	room := &Room{
		peers,
		code,
	}
	roomStore.rooms[code] = room
	slog.Info("Created new room", "code", code)
	return code
}

func GetRoom(code string) (*Room, bool) {
	room, exists := roomStore.rooms[code]
	return room, exists
}

func JoinRoom(code string, conn *websocket.Conn) (*Room, error) {
	room, exists := roomStore.rooms[code]
	if !exists {
		slog.Error("No room found", "code", code)
		return nil, fmt.Errorf("No room found for code=%s", code)
	}
	peer := &Peer{conn}
	room.Peers = append(room.Peers, peer)
	slog.Info("Successfully joined room", "code", code)
	return room, nil
}

// generateRandomCode generates a random six digit alpha-numeric code, eg: ABC123
func generateRandomCode() string {
	prefix := make([]byte, 3)
	for i := range 3 {
		idx := rand.IntN(len(alphabets))
		prefix[i] = alphabets[idx]
	}
	suffix := rand.IntN(1000)
	return fmt.Sprintf("%s%03d", prefix, suffix)
}
