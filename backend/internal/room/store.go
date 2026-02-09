package room

var roomStore = newStore()

type store struct {
	rooms map[string]*Room
	// TODO: mutex for multiple goroutines
}

func newStore() *store {
	rooms := make(map[string]*Room)
	return &store{rooms}
}

func (s *store) deleteRoom(code string) {
	delete(s.rooms, code)
}

// Reset deletes the store (used for testing)
func Reset() {
	roomStore = newStore()
}
