package models

type Type string

const (
	Join             Type = "join"
	Reconnect        Type = "reconnect"
	Connected        Type = "connected"
	Failed           Type = "failed"
	PeerDisconnected Type = "peer_disconnected"
)

type WsRequest struct {
	Type         Type   `json:"type"`
	Code         string `json:"code,omitempty"`         // for "join"
	SessionToken string `json:"sessionToken,omitempty"` // for "reconnect"
}

type WsResponse struct {
	Type         Type   `json:"type"`
	SessionToken string `json:"sessionToken,omitempty"` // included in "connected" response
}
