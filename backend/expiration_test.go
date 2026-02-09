package main

import (
	"testing"
	"time"

	"frop/internal/room"
	"frop/internal/session"
)

// =============================================================================
// Room Expiration Tests
// =============================================================================

// TestRoomExpiration verifies that old empty rooms are rejected on access
// Lazy cleanup: GetRoom checks expiration and deletes if too old
func TestRoomExpiration(t *testing.T) {
	defer cleanup()

	// Create a room
	code := room.CreateRoom()

	// Verify it exists
	_, err := room.GetRoom(code)
	if err != nil {
		t.Fatal("Room should exist after creation")
	}

	// Manually set CreatedAt to 30 minutes ago (simulating an old room)
	r, err := room.GetRoom(code)
	if err != nil {
		t.Fatal("Room not found")
	}
	r.SetCreatedAt(time.Now().Add(-30 * time.Minute))

	// Try to access the room - should be expired and deleted
	// GetRoom should check expiration (10 min default) and return error
	_, err = room.GetRoom(code)
	if err == nil {
		t.Fatal("Expired room should return error on access")
	}

	t.Log("Room expiration (lazy cleanup) works correctly!")
}

// TestRoomExpirationKeepsActive verifies rooms with peers don't expire
func TestRoomExpirationKeepsActive(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	// Create room and have peers join
	code := ts.createRoom(t)

	peer1 := ts.dialWS(t)
	peer2 := ts.dialWS(t)
	defer peer1.Close()
	defer peer2.Close()

	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Read connected messages
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]any
	peer1.ReadJSON(&msg)
	peer2.ReadJSON(&msg)

	// Set room as old
	r, err := room.GetRoom(code)
	if err != nil {
		t.Fatal("Room not found")
	}
	r.SetCreatedAt(time.Now().Add(-15 * time.Minute))

	// Room should still be accessible (has active peers)
	_, err = room.GetRoom(code)
	if err != nil {
		t.Fatal("Room with active peers should NOT expire")
	}

	t.Log("Active rooms correctly preserved!")
}

// =============================================================================
// Session Expiration Tests
// =============================================================================

// TestSessionExpiration verifies stale sessions are rejected on access
// Lazy cleanup: GetSession checks LastSeen and deletes if too old
func TestSessionExpiration(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	// Create room and establish session
	code := ts.createRoom(t)

	peer1 := ts.dialWS(t)
	peer2 := ts.dialWS(t)

	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Get session token
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]any
	peer1.ReadJSON(&msg)
	token := msg["sessionToken"].(string)

	// Close both peers (session remains for reconnection)
	peer1.Close()
	peer2.Close()
	time.Sleep(100 * time.Millisecond)

	// Verify session exists
	_, err := session.GetSession(token)
	if err != nil {
		t.Fatal("Session should exist after peers disconnect")
	}

	// Set LastSeen to 15 minutes ago
	s, err := session.GetSession(token)
	if err != nil {
		t.Fatalf("Session not found")
	}
	s.SetLastSeen(time.Now().Add(-15 * time.Minute))

	// Try to access session - should be expired (30 min default)
	_, err = session.GetSession(token)
	if err == nil {
		t.Fatal("Expired session should not be returned")
	}

	t.Log("Session expiration (lazy cleanup) works correctly!")
}

// TestSessionLastSeenUpdated verifies activity updates LastSeen
func TestSessionLastSeenUpdated(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	// Create room and establish session
	code := ts.createRoom(t)

	peer1 := ts.dialWS(t)
	peer2 := ts.dialWS(t)
	defer peer1.Close()
	defer peer2.Close()

	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Get session
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]any
	peer1.ReadJSON(&msg)
	peer2.ReadJSON(&msg)
	token := msg["sessionToken"].(string)

	// Get initial LastSeen
	sess, _ := session.GetSession(token)
	initialLastSeen := sess.LastSeen

	// Wait a bit
	time.Sleep(100 * time.Millisecond)

	// Send clipboard (activity that should update LastSeen)
	peer1.WriteJSON(map[string]string{"type": "clipboard", "content": "test"})

	// Read the relayed message
	var clipMsg map[string]any
	peer2.ReadJSON(&clipMsg)

	// LastSeen should be updated
	sess, _ = session.GetSession(token)
	if !sess.LastSeen.After(initialLastSeen) {
		t.Fatal("LastSeen should be updated after activity")
	}

	t.Log("LastSeen correctly updated on activity!")
}
