package session

import (
	"errors"
	"frop/internal/room"

	"github.com/gorilla/websocket"
)

var (
	ErrSessionNotFound  = errors.New("session not found")
	ErrPeerDisconnected = errors.New("peer disconnected")
)

var sessionStore = newStore()

type store struct {
	sessionsByToken map[string]*Session
	sessionsByConn  map[*websocket.Conn]*Session // needed to update peers in a session on disconnect
	// TODO: mutex for multiple goroutines
}

func newStore() *store {
	st := make(map[string]*Session)
	sc := make(map[*websocket.Conn]*Session)
	return &store{st, sc}
}

func GetSession(token string) (*Session, bool) {
	s, exists := sessionStore.sessionsByToken[token]
	return s, exists
}

func LookupSessionForConn(conn *websocket.Conn) (*Session, bool) {
	s, exists := sessionStore.sessionsByConn[conn]
	return s, exists
}

func GetRemotePeer(conn *websocket.Conn) (*room.Peer, error) {
	s, exists := LookupSessionForConn(conn)
	if !exists {
		return nil, ErrSessionNotFound
	}
	peer, exists := s.GetPeer(conn)
	if !exists {
		return nil, ErrPeerDisconnected
	}
	return peer, nil
}

// Reset deletes the store (used for testing)
func Reset() {
	sessionStore = newStore()
}
