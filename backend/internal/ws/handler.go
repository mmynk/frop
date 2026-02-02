package ws

import (
	"encoding/json"
	"frop/internal/room"
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

func NewClient() *Client {
	return &Client{
		conn: nil,
	}
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
	defer c.conn.Close()

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			slog.Error("Failed to read msg", "error", err)
			return
		}

		slog.Info("Read message", "message", string(msg))
		var req models.WsRequest
		err = json.Unmarshal(msg, &req)
		if err != nil {
			slog.Error("Failed to decode msg", "error", err)
		}

		err = c.processRequest(&req)
		if err != nil {
			slog.Error("Failed to process request", "error", err)
		}

		res := &models.WsResponse{Type: "connected"}
		c.conn.WriteJSON(res)
		slog.Info("Request processed successfully", "response", res)
	}
}

func (c *Client) processRequest(req *models.WsRequest) error {
	slog.Info("Processing request", "type", req.Type)
	// Only one type of request as of now
	if req.Type == string(Join) {
		err := room.JoinRoom(req.Code, c.conn)
		if err != nil {
			return err
		}
		slog.Info("Successfully joined room", "code", req.Code)
	}
	return nil
}

func (c *Client) Close() error {
	if c.conn == nil {
		slog.Info("Connection already closed")
		return nil
	}
	return c.conn.Close()
}
