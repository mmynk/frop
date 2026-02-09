package session

import (
	"frop/internal/room"
	"time"

	"github.com/gorilla/websocket"
)

const lifespan = 15 * time.Minute

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

func (s *store) deleteSession(token string) {
	sess, exists := s.sessionsByToken[token]
	if !exists {
		return
	}
	delete(s.sessionsByToken, token)
	// Peers may be nil if already disconnected
	if sess.PeerA != nil {
		delete(s.sessionsByConn, sess.PeerA.Conn)
	}
	if sess.PeerB != nil {
		delete(s.sessionsByConn, sess.PeerB.Conn)
	}
}

func GetSession(token string) (*Session, error) {
	s, exists := sessionStore.sessionsByToken[token]
	if !exists {
		return nil, ErrSessionNotFound
	}
	if time.Since(s.LastSeen) > lifespan {
		// lazy expiration: if expired, remove from store
		sessionStore.deleteSession(token)
		return nil, ErrSessionExpired
	}
	// update last seen to now
	s.LastSeen = time.Now()
	return s, nil
}

func LookupSessionForConn(conn *websocket.Conn) (*Session, error) {
	s, exists := sessionStore.sessionsByConn[conn]
	if !exists {
		return nil, ErrSessionNotFound
	}
	if time.Since(s.LastSeen) > lifespan {
		return nil, ErrSessionExpired
	}
	return s, nil
}

func GetRemotePeer(conn *websocket.Conn) (*room.Peer, error) {
	s, err := LookupSessionForConn(conn)
	if err != nil {
		return nil, err
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
