package room

import (
	"frop/models"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// writeWait is the deadline for write operations
const writeWait = 10 * time.Second

type Peer struct {
	Conn *websocket.Conn
	mu   sync.Mutex
}

func (p *Peer) Is(conn *websocket.Conn) bool {
	return p.Conn == conn
}

func (p *Peer) SendRequest(req *models.WsRequest) error {
	return p.send(req)
}

func (p *Peer) SendResponse(res *models.WsResponse) error {
	return p.send(res)
}

func (p *Peer) SendChunk(chunk []byte) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	return p.Conn.WriteMessage(websocket.BinaryMessage, chunk)
}

func (p *Peer) send(msg any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	return p.Conn.WriteJSON(msg)
}

func (p *Peer) SendPing() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Conn.SetWriteDeadline(time.Now().Add(writeWait))
	return p.Conn.WriteMessage(websocket.PingMessage, nil)
}
