package room

import (
	"fmt"
	"log/slog"
	"math/rand/v2"

	"github.com/gorilla/websocket"
)

var alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
var roomStore = newStore()

type Peer struct {
	conn *websocket.Conn
}

type Room struct {
	peers []*Peer
	code  string
}

type store struct {
	rooms map[string]*Room
	// TODO: mutex for multiple goroutines
}

func newStore() *store {
	rooms := make(map[string]*Room)
	return &store{rooms}
}

func NewRoom(peer1 *websocket.Conn) *Room {
	src := &Peer{
		conn: peer1,
	}
	peers := make([]*Peer, 2)
	peers[0] = src
	code := generateRandomCode()
	room := &Room{
		peers,
		code,
	}
	roomStore.rooms[code] = room
	return room
}

// CreateRoom creates a new empty room, stores it, and returns the code
func CreateRoom() string {
	peers := make([]*Peer, 2)
	code := generateRandomCode()
	room := &Room{
		peers,
		code,
	}
	roomStore.rooms[code] = room
	slog.Info("Created new room", "code", code)
	return code
}

func GetRoom(code string) (bool, *Room) {
	if room, exists := roomStore.rooms[code]; exists {
		return true, room
	} else {
		return false, nil
	}
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

func (r *Room) Connect(dst *Peer) {
	r.peers[1] = dst
	// send offer
}
