package session

import (
	"fmt"
	"frop/internal/room"
	"frop/models"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Session is created when two peers join a room
type Session struct {
	Token     string     // UUID - the "ticket stub"
	PeerA     *room.Peer // current connection (can be nil if disconnected)
	PeerB     *room.Peer // current connection (can be nil if disconnected)
	CreatedAt time.Time
	LastSeen  time.Time // for expiration
}

func NewSession(peers []*room.Peer) *Session {
	token := uuid.NewString()
	now := time.Now()
	s := &Session{
		Token:     token,
		PeerA:     peers[0],
		PeerB:     peers[1],
		CreatedAt: now,
		LastSeen:  now,
	}
	sessionStore.sessionsByToken[token] = s
	sessionStore.sessionsByConn[peers[0].Conn] = s
	sessionStore.sessionsByConn[peers[1].Conn] = s
	return s
}

func (s *Session) Notify() {
	res := connectedResponse(s.Token)
	s.PeerA.SendMessage(res)
	s.PeerB.SendMessage(res)
}

func (s *Session) Reconnect(peer *room.Peer) error {
	if s.PeerA == nil {
		s.PeerA = peer
	} else if s.PeerB == nil {
		s.PeerB = peer
	} else {
		return fmt.Errorf("Both peers already connected")
	}
	sessionStore.sessionsByConn[peer.Conn] = s
	peer.SendMessage(connectedResponse(s.Token))

	return nil
}

func (s *Session) Disconnect(conn *websocket.Conn) {
	delete(sessionStore.sessionsByConn, conn)
	if s.PeerA != nil && s.PeerA.Is(conn) {
		s.PeerA = nil
		if s.PeerB != nil {
			s.PeerB.SendMessage(&models.WsResponse{Type: models.PeerDisconnected})
		}
	} else if s.PeerB != nil && s.PeerB.Is(conn) {
		s.PeerB = nil
		if s.PeerA != nil {
			s.PeerA.SendMessage(&models.WsResponse{Type: models.PeerDisconnected})
		}
	}
}

func connectedResponse(token string) *models.WsResponse {
	return &models.WsResponse{
		Type:         models.Connected,
		SessionToken: token,
	}
}
