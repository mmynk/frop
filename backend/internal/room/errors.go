package room

import "errors"

var (
	ErrRoomNotFound = errors.New("room not found")
	ErrRoomFull     = errors.New("room full")
)
