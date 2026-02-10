package session

import (
	"frop/internal/room"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const lifespan = 15 * time.Minute

var (
	sessionsByToken sync.Map // map[string]*Session
	sessionsByConn  sync.Map // map[*websocket.Conn]*Session
)

func deleteSession(token string) {
	v, exists := sessionsByToken.Load(token)
	if !exists {
		return
	}
	sessionsByToken.Delete(token)

	sess := v.(*Session)
	// Load peers atomically and clean up conn mappings
	if peerA := sess.peerA.Load(); peerA != nil {
		sessionsByConn.Delete(peerA.Conn)
	}
	if peerB := sess.peerB.Load(); peerB != nil {
		sessionsByConn.Delete(peerB.Conn)
	}
}

func GetSession(token string) (*Session, error) {
	v, exists := sessionsByToken.Load(token)
	if !exists {
		return nil, ErrSessionNotFound
	}
	s := v.(*Session)

	lastSeen := time.Unix(0, s.lastSeen.Load())
	if time.Since(lastSeen) > lifespan {
		deleteSession(token)
		return nil, ErrSessionExpired
	}
	s.lastSeen.Store(time.Now().UnixNano())
	return s, nil
}

func LookupSessionForConn(conn *websocket.Conn) (*Session, error) {
	v, exists := sessionsByConn.Load(conn)
	if !exists {
		return nil, ErrSessionNotFound
	}
	s := v.(*Session)

	lastSeen := time.Unix(0, s.lastSeen.Load())
	if time.Since(lastSeen) > lifespan {
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

func registerConn(conn *websocket.Conn, s *Session) {
	sessionsByConn.Store(conn, s)
}

func unregisterConn(conn *websocket.Conn) {
	sessionsByConn.Delete(conn)
}

// Reset clears the store (used for testing)
func Reset() {
	sessionsByToken.Range(func(key, _ any) bool {
		sessionsByToken.Delete(key)
		return true
	})
	sessionsByConn.Range(func(key, _ any) bool {
		sessionsByConn.Delete(key)
		return true
	})
}

// SetLastSeen is for testing - allows setting lastSeen on a session
func (s *Session) SetLastSeen(t time.Time) {
	s.lastSeen.Store(t.UnixNano())
}

// LastSeen returns the last activity time
func (s *Session) LastSeen() time.Time {
	return time.Unix(0, s.lastSeen.Load())
}
