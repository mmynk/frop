package session

import "github.com/gorilla/websocket"

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

// Reset deletes the store (used for testing)
func Reset() {
	sessionStore = newStore()
}
