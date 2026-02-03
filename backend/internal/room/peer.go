package room

import (
	"frop/models"

	"github.com/gorilla/websocket"
)

type Peer struct {
	Conn *websocket.Conn
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

func (p *Peer) send(msg any) error {
	return p.Conn.WriteJSON(msg)
}

func (p *Peer) SendChunk(chunk []byte) error {
	return p.Conn.WriteMessage(websocket.BinaryMessage, chunk)
}

