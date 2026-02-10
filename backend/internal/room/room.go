package room

import (
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sync/atomic"
	"time"
)

const lifespan = 30 * time.Minute
const alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

type Room struct {
	peerA     atomic.Pointer[Peer]
	peerB     atomic.Pointer[Peer]
	Code      string
	CreatedAt time.Time
}

// CreateRoom creates a new empty room, stores it, and returns the code
func CreateRoom() string {
	code := generateRandomCode()
	room := &Room{
		Code:      code,
		CreatedAt: time.Now(),
	}
	roomStore.Store(code, room)
	slog.Info("Created new room", "code", code)
	return code
}

func GetRoom(code string) (*Room, error) {
	v, exists := roomStore.Load(code)
	if !exists {
		return nil, ErrRoomNotFound
	}
	room := v.(*Room)
	if time.Since(room.CreatedAt) > lifespan {
		deleteRoom(code)
		return nil, ErrRoomExpired
	}
	return room, nil
}

// JoinRoom adds a peer to the room using atomic CAS.
// Returns (peers, nil) when this peer completes the pair.
// Returns (nil, nil) when this is the first peer.
func JoinRoom(code string, peer *Peer) ([]*Peer, error) {
	v, exists := roomStore.Load(code)
	if !exists {
		slog.Error("No room found", "code", code)
		return nil, ErrRoomNotFound
	}
	room := v.(*Room)

	// Try to claim first slot
	if room.peerA.CompareAndSwap(nil, peer) {
		slog.Info("Successfully joined room", "code", code)
		return nil, nil
	}

	// Try to claim second slot
	if room.peerB.CompareAndSwap(nil, peer) {
		slog.Info("Successfully joined room", "code", code)
		// Return both peers - peerA is guaranteed to be set
		return []*Peer{room.peerA.Load(), peer}, nil
	}

	return nil, ErrRoomFull
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
