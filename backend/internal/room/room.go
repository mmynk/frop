package room

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/gorilla/websocket"
)

const lifespan = 30 * time.Minute
const alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

type Room struct {
	Peers     []*Peer
	Code      string
	CreatedAt time.Time
}

// CreateRoom creates a new empty room, stores it, and returns the code
func CreateRoom() string {
	peers := make([]*Peer, 0, 2)
	code := generateRandomCode()
	room := &Room{
		Peers:     peers,
		Code:      code,
		CreatedAt: time.Now(),
	}
	roomStore.rooms[code] = room
	slog.Info("Created new room", "code", code)
	return code
}

func GetRoom(code string) (*Room, error) {
	room, exists := roomStore.rooms[code]
	if !exists {
		return nil, ErrRoomNotFound
	}
	if time.Since(room.CreatedAt) > lifespan {
		// lazy expiration: if expired, remove from store
		roomStore.deleteRoom(code)
		return nil, ErrRoomExpired
	}
	return room, nil
}

func JoinRoom(code string, conn *websocket.Conn) (*Room, error) {
	room, exists := roomStore.rooms[code]
	if !exists {
		slog.Error("No room found", "code", code)
		return nil, ErrRoomNotFound
	}

	if len(room.Peers) > 1 {
		return nil, ErrRoomFull
	}

	peer := &Peer{conn}
	room.Peers = append(room.Peers, peer)
	slog.Info("Successfully joined room", "code", code)
	return room, nil
}

func (r *Room) SetCreatedAt(t time.Time) {
	r.CreatedAt = t
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
