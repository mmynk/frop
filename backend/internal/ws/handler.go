package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"frop/internal/room"
	"frop/internal/session"
	"frop/internal/transfer"
	"frop/models"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Client struct {
	conn  *websocket.Conn
	relay *transfer.Relay
}

func ServeHttp(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade http connection", "error", err)
		return
	}

	client := &Client{
		conn:  conn,
		relay: transfer.NewRelay(conn),
	}
	go client.handle()
}

func (c *Client) handle() {
	ctx, cancel := context.WithCancel(context.Background())

	defer func() {
		c.conn.Close()
		cancel()
		if s, exists := session.LookupSessionForConn(c.conn); exists {
			s.Disconnect(c.conn)
		}
	}()

	for {
		msgType, msg, err := c.conn.ReadMessage()
		if err != nil {
			slog.Error("Failed to read msg", "error", err)
			c.sendFailureResponse()
			return
		}

		if msgType == websocket.BinaryMessage {
			c.relay.RelayFile(ctx, msg)
			continue
		}

		slog.Info("Read message", "size", len(msg))
		slog.Debug("Message content", "message", string(msg))
		var req models.WsRequest
		err = json.Unmarshal(msg, &req)
		if err != nil {
			slog.Error("Failed to decode msg", "error", err)
			c.sendFailureResponse()
			continue
		}

		err = c.processRequest(cancel, &req)
		if err != nil {
			slog.Error("Failed to process request", "error", err)
			c.sendFailureResponse()
			continue
		}
	}
}

func (c *Client) processRequest(cancel context.CancelFunc, req *models.WsRequest) error {
	slog.Info("Processing request", "type", req.Type)
	switch req.Type {
	case models.Join:
		return c.handleJoin(req)
	case models.Reconnect:
		return c.handleReconnect(req)
	case models.TransferStart, models.TransferEnd:
		return c.handleFraming(req)
	case models.TransferCancel:
		return c.handleCancel(cancel, req)
	case models.Clipboard:
		return c.handleClipboard(req)
	}

	return fmt.Errorf("Request type did not match any operation %s", req.Type)
}

func (c *Client) handleJoin(req *models.WsRequest) error {
	r, err := room.JoinRoom(req.Code, c.conn)
	if err != nil {
		return err
	}

	if len(r.Peers) == 2 {
		// both peers have joined, create a new session
		s := session.NewSession(r.Peers)
		s.Notify()
	}

	return nil
}

func (c *Client) handleReconnect(req *models.WsRequest) error {
	token := req.SessionToken
	s, exists := session.GetSession(token)
	if !exists {
		return fmt.Errorf("No session found with token=%s", token)
	}
	peer := &room.Peer{Conn: c.conn}
	return s.Reconnect(peer)
}

func (c *Client) handleFraming(req *models.WsRequest) error {
	s, exists := session.LookupSessionForConn(c.conn)
	if !exists {
		return fmt.Errorf("No session found")
	}
	peer, exists := s.GetPeer(c.conn)
	if !exists {
		return fmt.Errorf("Other peer is disconnected, cannot send framing message")
	}
	slog.Debug("Forwarding framing message to peer", "type", req.Type, "name", req.Name)
	return peer.SendRequest(req)
}

func (c *Client) handleCancel(cancel context.CancelFunc, req *models.WsRequest) error {
	cancel()
	return c.handleFraming(req)
}

func (c *Client) handleClipboard(req *models.WsRequest) error {
	s, exists := session.LookupSessionForConn(c.conn)
	if !exists {
		return fmt.Errorf("No session found")
	}
	peer, exists := s.GetPeer(c.conn)
	if !exists {
		return fmt.Errorf("Other peer is disconnected, cannot send framing message")
	}
	slog.Debug("Forwarding clipboard to peer", "type", req.Type, "name", req.Name)
	return peer.SendRequest(req)
}

func (c *Client) sendFailureResponse() {
	c.conn.WriteJSON(&models.WsResponse{Type: models.Failed})
}

func (c *Client) Close() error {
	if c.conn == nil {
		slog.Info("Connection already closed")
		return nil
	}
	return c.conn.Close()
}
