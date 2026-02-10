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
	"time"

	"github.com/gorilla/websocket"
)

// Keepalive timing constants
const (
	pingInterval = 10 * time.Second // How often to send pings
	pongWait     = 7 * time.Second  // How long to wait for pong before considering dead
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Client struct {
	conn     *websocket.Conn
	selfPeer *room.Peer // Our own Peer - used for pings and responses to this connection
	relay    *transfer.Relay
}

func ServeHttp(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade http connection", "error", err)
		return
	}

	// Set up keepalive: read deadline + pong handler
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Create Peer for this connection - used for pings/responses AND passed to JoinRoom
	selfPeer := &room.Peer{Conn: conn}

	client := &Client{
		conn:     conn,
		selfPeer: selfPeer,
		relay:    transfer.NewRelay(conn),
	}
	go client.startPinger()
	go client.handle()
}

func (c *Client) handle() {
	ctx, cancel := context.WithCancel(context.Background())

	defer func() {
		c.conn.Close()
		cancel()
		if s, err := session.LookupSessionForConn(c.conn); err == nil {
			s.Disconnect(c.conn)
		}
	}()

	for {
		msgType, msg, err := c.conn.ReadMessage()
		if err != nil {
			// Don't log or send response for normal close errors
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				slog.Error("Failed to read msg", "error", err)
			}
			return
		}

		if msgType == websocket.BinaryMessage {
			err := c.sendBinary(ctx, msg)
			slog.Error("Failed to send chunk", "error", err)
			continue
		}

		slog.Info("Read message", "size", len(msg))
		slog.Debug("Message content", "message", string(msg))
		var req models.WsRequest
		err = json.Unmarshal(msg, &req)
		if err != nil {
			slog.Error("Failed to decode msg", "error", err)
			c.sendFailureResponse(err)
			continue
		}

		err = c.processRequest(cancel, &req)
		if err != nil {
			slog.Error("Failed to process request", "error", err)
			c.sendFailureResponse(err)
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
	peers, err := room.JoinRoom(req.Code, c.selfPeer)
	if err != nil {
		return err
	}

	if peers != nil {
		// both peers have joined, create a new session
		s := session.NewSession(peers)
		s.Notify()
	}

	return nil
}

func (c *Client) handleReconnect(req *models.WsRequest) error {
	token := req.SessionToken
	s, err := session.GetSession(token)
	if err != nil {
		slog.Error("No session found", "token", token)
		return err
	}
	return s.Reconnect(c.selfPeer)
}

func (c *Client) handleFraming(req *models.WsRequest) error {
	return c.forwardToPeer(req)
}

func (c *Client) handleCancel(cancel context.CancelFunc, req *models.WsRequest) error {
	cancel()
	return c.forwardToPeer(req)
}

func (c *Client) handleClipboard(req *models.WsRequest) error {
	return c.forwardToPeer(req)
}

func (c *Client) sendFailureResponse(err error) {
	res := &models.WsResponse{
		Type:  models.Failed,
		Error: err.Error(),
	}
	c.sendResponse(res)
}

func (c *Client) forwardToPeer(req *models.WsRequest) error {
	peer, err := session.GetRemotePeer(c.conn)
	if err != nil {
		return err
	}
	slog.Debug("Forwarding message to peer", "type", req.Type)
	return c.forwardRequest(req, peer)
}

func (c *Client) forwardRequest(req *models.WsRequest, peer *room.Peer) error {
	// Mutex is inside peer.SendRequest
	return peer.SendRequest(req)
}

func (c *Client) sendResponse(res *models.WsResponse) error {
	// Use selfPeer to write to our own connection (mutex protected)
	return c.selfPeer.SendResponse(res)
}

func (c *Client) sendBinary(ctx context.Context, msg []byte) error {
	// Mutex is inside peer.SendChunk (called by relay)
	return c.relay.RelayFile(ctx, msg)
}

func (c *Client) startPinger() {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for range ticker.C {
		if err := c.selfPeer.SendPing(); err != nil {
			return
		}
	}
}
