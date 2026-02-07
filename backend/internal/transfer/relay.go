package transfer

import (
	"context"
	"frop/internal/session"
	"log/slog"

	"github.com/gorilla/websocket"
)

type Relay struct {
	conn *websocket.Conn
}

func NewRelay(conn *websocket.Conn) *Relay {
	return &Relay{conn}
}

func (r *Relay) RelayFile(ctx context.Context, chunk []byte) error {
	// Check if already cancelled before attempting send
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	return r.relay(chunk)
}

func (r *Relay) relay(chunk []byte) error {
	peer, err := session.GetRemotePeer(r.conn)
	if err != nil {
		return err
	}
	slog.Debug("Sending chunk to peer", "size", len(chunk))
	return peer.SendChunk(chunk)
}
