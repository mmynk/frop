package session

import "errors"

var (
	ErrSessionNotFound  = errors.New("session not found")
	ErrSessionExpired   = errors.New("session expired")
	ErrPeerDisconnected = errors.New("peer disconnected")
)
