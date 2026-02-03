package ws

import (
	"encoding/json"
	"fmt"
	"frop/internal/room"
	"frop/internal/session"
	"frop/models"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Client struct {
	conn *websocket.Conn
}

func ServeHttp(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade http connection", "error", err)
		return
	}

	client := &Client{conn: conn}
	go client.handle()
}

func (c *Client) handle() {
	slog.SetLogLoggerLevel(slog.LevelDebug)

	defer func() {
		c.conn.Close()
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
			c.relayFile(msg)
			continue
		}

		slog.Info("Read message", "message", string(msg))
		var req models.WsRequest
		err = json.Unmarshal(msg, &req)
		if err != nil {
			slog.Error("Failed to decode msg", "error", err)
			c.sendFailureResponse()
			continue
		}

		err = c.processRequest(&req)
		if err != nil {
			slog.Error("Failed to process request", "error", err)
			c.sendFailureResponse()
			continue
		}
	}
}

func (c *Client) processRequest(req *models.WsRequest) error {
	slog.Info("Processing request", "type", req.Type)
	switch req.Type {
	case models.Join:
		return c.handleJoin(req)
	case models.Reconnect:
		return c.handleReconnect(req)
	case models.TransferStart:
		return c.handleFraming(req)
	case models.TransferEnd:
		return c.handleFraming(req)
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
	return peer.SendRequest(req)
}

func (c *Client) relayFile(chunk []byte) error {
	s, exists := session.LookupSessionForConn(c.conn)
	if !exists {
		return fmt.Errorf("No session found")
	}
	peer, exists := s.GetPeer(c.conn)
	if !exists {
		return fmt.Errorf("Other peer is disconnected, cannot relay chunk")
	}

	slog.Debug("Sending chunk to peer", "size", len(chunk))
	return peer.SendChunk(chunk)
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
