package session

import (
	"fmt"
	"frop/internal/metrics"
	"frop/internal/room"
	"frop/models"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Session is created when two peers join a room
type Session struct {
	Token     string
	peerA     atomic.Pointer[room.Peer]
	peerB     atomic.Pointer[room.Peer]
	CreatedAt time.Time
	lastSeen  atomic.Int64 // unix nanoseconds
}

type sessionEvent int

const (
	eventCreated      sessionEvent = iota // new session, both peers joined
	eventReconnected                      // a peer reconnected to an existing session
	eventDisconnected                     // a peer left
)

// trackSessionMetric updates Prometheus counters and gauges on session lifecycle events.
func trackSessionMetric(e sessionEvent) {
	switch e {
	case eventCreated:
		metrics.SessionsCreated.Inc()
		metrics.SessionsActive.Inc()
	case eventReconnected:
		metrics.SessionsActive.Inc()
		metrics.Reconnections.Inc()
	case eventDisconnected:
		metrics.SessionsActive.Dec()
	}
}

func NewSession(peers []*room.Peer) *Session {
	token := uuid.NewString()
	now := time.Now()
	s := &Session{
		Token:     token,
		CreatedAt: now,
	}
	s.peerA.Store(peers[0])
	s.peerB.Store(peers[1])
	s.lastSeen.Store(now.UnixNano())

	sessionsByToken.Store(token, s)
	registerConn(peers[0].Conn, s)
	registerConn(peers[1].Conn, s)
	trackSessionMetric(eventCreated)
	return s
}

func (s *Session) GetPeer(conn *websocket.Conn) (*room.Peer, bool) {
	peerA := s.peerA.Load()
	peerB := s.peerB.Load()

	if peerA != nil && peerA.Is(conn) {
		if peerB != nil {
			return peerB, true
		}
		return nil, false
	}

	if peerB != nil && peerB.Is(conn) {
		if peerA != nil {
			return peerA, true
		}
		return nil, false
	}

	return nil, false
}

func (s *Session) Notify() {
	peerA := s.peerA.Load()
	peerB := s.peerB.Load()

	res := connectedResponse(s.Token)
	if peerA != nil {
		peerA.SendResponse(res)
	}
	if peerB != nil {
		peerB.SendResponse(res)
	}
}

func (s *Session) Reconnect(peer *room.Peer) error {
	// Try to claim an empty slot using CAS
	if s.peerA.CompareAndSwap(nil, peer) {
		registerConn(peer.Conn, s)
		s.Notify()
		trackSessionMetric(eventReconnected)
		return nil
	}
	if s.peerB.CompareAndSwap(nil, peer) {
		registerConn(peer.Conn, s)
		s.Notify()
		trackSessionMetric(eventReconnected)
		return nil
	}
	return fmt.Errorf("Both peers already connected")
}

func (s *Session) Disconnect(conn *websocket.Conn) {
	unregisterConn(conn)

	var peerToNotify *room.Peer
	var logMsg string

	// Try to clear peerA if it matches
	peerA := s.peerA.Load()
	if peerA != nil && peerA.Is(conn) {
		if s.peerA.CompareAndSwap(peerA, nil) {
			peerToNotify = s.peerB.Load()
			logMsg = "PeerA disconnected from the session"
		}
	}

	// Try to clear peerB if it matches
	peerB := s.peerB.Load()
	if peerB != nil && peerB.Is(conn) {
		if s.peerB.CompareAndSwap(peerB, nil) {
			peerToNotify = s.peerA.Load()
			logMsg = "PeerB disconnected from the session"
		}
	}

	if peerToNotify != nil {
		peerToNotify.SendResponse(&models.WsResponse{Type: models.PeerDisconnected})
	}
	if logMsg != "" {
		slog.Info(logMsg)
		trackSessionMetric(eventDisconnected)
	}
}

func connectedResponse(token string) *models.WsResponse {
	return &models.WsResponse{
		Type:         models.Connected,
		SessionToken: token,
	}
}
