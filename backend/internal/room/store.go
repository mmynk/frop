package room

import "sync"

var roomStore sync.Map // map[string]*Room

func deleteRoom(code string) {
	roomStore.Delete(code)
}

// Reset clears the store (used for testing)
func Reset() {
	roomStore.Range(func(key, _ any) bool {
		roomStore.Delete(key)
		return true
	})
}
