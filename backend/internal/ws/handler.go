package ws

import (
	"fmt"
	"log/slog"
	"math/rand"
	"net/http"
	"time"

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

func (c *Client) ServeHttp(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("Failed to upgrade http connection", "error", err)
		return
	}

	c.conn = conn

	go c.read()
	go c.write()
}

func (c *Client) read() {
	defer c.conn.Close()

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			slog.Error("Failed to read msg", "error", err)
			return
		}
		slog.Info("Read message", "message", string(msg))
	}
}

func (c *Client) write() {
	for {
		msg := fmt.Sprintf("Lucky number %d", rand.Intn(100))
		err := c.conn.WriteMessage(websocket.TextMessage, []byte(msg))
		if err != nil {
			slog.Error("Failed to write msg", "error", err)
			return
		}
		time.Sleep(5 * time.Second)
	}
}

func (c *Client) Close() error {
	if c.conn == nil {
		slog.Info("Connection already closed")
		return nil
	}
	return c.conn.Close()
}
