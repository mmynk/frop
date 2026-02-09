package session

import "errors"

var (
	ErrSessionNotFound  = errors.New("session not found")
	ErrPeerDisconnected = errors.New("peer disconnected")
)
