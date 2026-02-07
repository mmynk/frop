package models

type Type string

const (
	Join             Type = "join"
	Reconnect        Type = "reconnect"
	Connected        Type = "connected"
	Failed           Type = "failed"
	PeerDisconnected Type = "peer_disconnected"
	TransferStart    Type = "file_start"
	TransferEnd      Type = "file_end"
	TransferCancel   Type = "file_cancel"
	Clipboard        Type = "clipboard"
)

type WsRequest struct {
	Type         Type   `json:"type"`
	Code         string `json:"code,omitempty"`         // for "join"
	SessionToken string `json:"sessionToken,omitempty"` // for "reconnect"

	// transfer

	Name   string `json:"name,omitempty"`
	Size   int    `json:"size,omitempty"`
	Reason string `json:"reason,omitempty"`

	// clipboard

	Content string `json:"content,omitempty"` // for "clipboard"
}

type WsResponse struct {
	Type         Type   `json:"type"`
	SessionToken string `json:"sessionToken,omitempty"` // included in "connected" response
}
