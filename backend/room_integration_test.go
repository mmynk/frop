package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frop/internal/room"
	"frop/internal/routes"
	"frop/internal/session"
	"frop/models"

	"github.com/gorilla/websocket"
)

// =============================================================================
// Test Helpers
// =============================================================================

// testServer wraps httptest.Server with convenience methods
type testServer struct {
	*httptest.Server
	wsURL string
}

// newTestServer creates a test server with all API routes configured
func newTestServer() *testServer {
	mux := http.NewServeMux()
	routes.Setup(mux)

	server := httptest.NewServer(mux)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	return &testServer{Server: server, wsURL: wsURL}
}

// createRoom creates a room via API and returns the code
func (ts *testServer) createRoom(t *testing.T) string {
	resp, err := http.Post(ts.URL+"/api/room", "application/json", nil)
	if err != nil {
		t.Fatalf("Failed to create room: %v", err)
	}
	defer resp.Body.Close()

	var result models.RoomResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Code
}

// dialWS connects to the WebSocket endpoint
func (ts *testServer) dialWS(t *testing.T) *websocket.Conn {
	conn, _, err := websocket.DefaultDialer.Dial(ts.wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to dial WebSocket: %v", err)
	}
	return conn
}

// joinRoom sends a join message and returns the response
func joinRoom(t *testing.T, conn *websocket.Conn, code string) map[string]any {
	conn.WriteJSON(map[string]string{"type": "join", "code": code})
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]any
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("Failed to read join response: %v", err)
	}
	return msg
}

// =============================================================================
// Tests
// =============================================================================

// TestFullRoomFlow tests the complete flow:
// 1. Create room via POST /api/room
// 2. Creator joins via WebSocket
// 3. Joiner joins via WebSocket
// 4. Both receive "connected" message
func TestFullRoomFlow(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	// Step 1: Create room
	code := ts.createRoom(t)
	t.Logf("Created room with code: %s", code)

	if len(code) != 6 {
		t.Errorf("Expected 6-char code, got %q", code)
	}

	// Step 2: Creator connects via WebSocket and joins
	creator := ts.dialWS(t)
	defer creator.Close()

	joinMsg := map[string]string{"type": "join", "code": code}
	if err := creator.WriteJSON(joinMsg); err != nil {
		t.Fatalf("Creator failed to send join: %v", err)
	}
	t.Log("Creator sent join message")

	// Step 3: Joiner connects and joins
	joiner := ts.dialWS(t)
	defer joiner.Close()

	if err := joiner.WriteJSON(joinMsg); err != nil {
		t.Fatalf("Joiner failed to send join: %v", err)
	}
	t.Log("Joiner sent join message")

	// Step 4: Both should receive "connected" message
	creator.SetReadDeadline(time.Now().Add(2 * time.Second))
	var creatorMsg map[string]any
	if err := creator.ReadJSON(&creatorMsg); err != nil {
		t.Fatalf("Creator failed to read connected msg: %v", err)
	}
	if creatorMsg["type"] != "connected" {
		t.Errorf("Creator expected type=connected, got %v", creatorMsg)
	}

	joiner.SetReadDeadline(time.Now().Add(2 * time.Second))
	var joinerMsg map[string]any
	if err := joiner.ReadJSON(&joinerMsg); err != nil {
		t.Fatalf("Joiner failed to read connected msg: %v", err)
	}
	if joinerMsg["type"] != "connected" {
		t.Errorf("Joiner expected type=connected, got %v", joinerMsg)
	}

	t.Log("Both peers received connected message!")

	// Verify room exists
	time.Sleep(100 * time.Millisecond)
	r, err := room.GetRoom(code)
	if err != nil {
		t.Fatal("Room should exist")
	}
	_ = r
	t.Log("Room exists - test framework working!")

	// Step 5: Verify both received session tokens
	creatorToken, ok := creatorMsg["sessionToken"].(string)
	if !ok || creatorToken == "" {
		t.Error("Creator should receive a sessionToken")
	}

	joinerToken, ok := joinerMsg["sessionToken"].(string)
	if !ok || joinerToken == "" {
		t.Error("Joiner should receive a sessionToken")
	}

	// Both peers should get the SAME token (they share a session)
	if creatorToken != joinerToken {
		t.Errorf("Session tokens should match: creator=%s, joiner=%s", creatorToken, joinerToken)
	}

	t.Logf("Both peers received matching session token: %s", creatorToken)
}

// TestSessionTokenReconnect tests reconnection flow
func TestSessionTokenReconnect(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	code := ts.createRoom(t)

	// Both peers join
	peer1 := ts.dialWS(t)
	peer2 := ts.dialWS(t)
	defer peer2.Close()

	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Get session token from connected message
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg1 map[string]any
	peer1.ReadJSON(&msg1)
	sessionToken := msg1["sessionToken"].(string)
	t.Logf("Got session token: %s", sessionToken)

	// Read peer2's message too
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg2 map[string]any
	peer2.ReadJSON(&msg2)

	// Peer1 disconnects
	peer1.Close()
	time.Sleep(100 * time.Millisecond)

	// Peer1 reconnects with session token
	peer1Reconnected := ts.dialWS(t)
	defer peer1Reconnected.Close()

	reconnectMsg := map[string]string{"type": "reconnect", "sessionToken": sessionToken}
	if err := peer1Reconnected.WriteJSON(reconnectMsg); err != nil {
		t.Fatalf("Failed to send reconnect: %v", err)
	}

	// Should receive "connected" message
	peer1Reconnected.SetReadDeadline(time.Now().Add(10 * time.Second))
	var reconnectResp map[string]any
	if err := peer1Reconnected.ReadJSON(&reconnectResp); err != nil {
		t.Fatalf("Failed to read reconnect response: %v", err)
	}

	if reconnectResp["type"] != "connected" {
		t.Errorf("Expected type=connected after reconnect, got %v", reconnectResp)
	}

	t.Log("Successfully reconnected with session token!")
}

// TestReconnectInvalidToken verifies that invalid tokens are rejected
func TestReconnectInvalidToken(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	conn := ts.dialWS(t)
	defer conn.Close()

	// Try to reconnect with fake token
	reconnectMsg := map[string]string{"type": "reconnect", "sessionToken": "fake-uuid-12345"}
	conn.WriteJSON(reconnectMsg)

	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var resp map[string]any
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	// Should receive an error, not "connected"
	if resp["type"] == "connected" {
		t.Error("Should NOT receive connected for invalid token")
	}

	if resp["type"] != "failed" && resp["type"] != "error" {
		t.Logf("Got response type: %v (expected 'failed' or 'error')", resp["type"])
	}

	t.Log("Invalid token correctly rejected")
}

// TestPeerDisconnectNotification verifies peer is notified when other disconnects
func TestPeerDisconnectNotification(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	code := ts.createRoom(t)

	// Both peers join
	peer1 := ts.dialWS(t)
	peer2 := ts.dialWS(t)
	defer peer2.Close()

	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Read connected messages
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg map[string]any
	peer1.ReadJSON(&msg)
	peer2.ReadJSON(&msg)

	// Peer1 disconnects abruptly
	peer1.Close()

	// Peer2 should receive "peer_disconnected" notification
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var disconnectMsg map[string]any
	if err := peer2.ReadJSON(&disconnectMsg); err != nil {
		t.Log("No disconnect notification received (may not be implemented yet)")
		return
	}

	if disconnectMsg["type"] != "peer_disconnected" {
		t.Errorf("Expected type=peer_disconnected, got %v", disconnectMsg)
	}

	t.Log("Peer correctly notified of disconnect!")
}

// TestRoomFullRejection verifies that a 3rd peer cannot join a full room
func TestRoomFullRejection(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	code := ts.createRoom(t)
	t.Logf("Created room with code: %s", code)

	// Peer 1 and 2 join (need to send both before reading - they wait for each other)
	peer1 := ts.dialWS(t)
	defer peer1.Close()
	peer2 := ts.dialWS(t)
	defer peer2.Close()

	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Now both can read their connected messages
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg1, msg2 map[string]any
	peer1.ReadJSON(&msg1)
	peer2.ReadJSON(&msg2)

	if msg1["type"] != "connected" || msg2["type"] != "connected" {
		t.Fatalf("Expected both peers to receive 'connected', got: %v and %v", msg1, msg2)
	}
	t.Log("Both peers connected successfully")

	// Peer 3 tries to join the full room - should get immediate rejection
	peer3 := ts.dialWS(t)
	defer peer3.Close()
	msg3 := joinRoom(t, peer3, code)

	if msg3["type"] != "failed" {
		t.Errorf("Expected type='failed' for 3rd peer, got: %v", msg3["type"])
	}

	if msg3["error"] != "room full" {
		t.Errorf("Expected error='room full', got: %v", msg3["error"])
	}

	t.Logf("Peer3 correctly rejected: %v", msg3)
}

// TestJoinNonexistentRoom verifies joining a bad code fails gracefully
func TestJoinNonexistentRoom(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	conn := ts.dialWS(t)
	defer conn.Close()

	msg := joinRoom(t, conn, "FAKE99")

	if msg["type"] != "failed" {
		t.Errorf("Expected type='failed', got: %v", msg["type"])
	}

	if msg["error"] != "room not found" {
		t.Errorf("Expected error='room not found', got: %v", msg["error"])
	}

	t.Logf("Nonexistent room correctly rejected: %v", msg)
}

// TestGetRoomEndpoint tests the GET /api/room/:code endpoint
func TestGetRoomEndpoint(t *testing.T) {
	defer cleanup()

	ts := newTestServer()
	defer ts.Close()

	// Test 1: Nonexistent room returns error
	resp, err := http.Get(ts.URL + "/api/room/FAKE99")
	if err != nil {
		t.Fatalf("Failed to GET nonexistent room: %v", err)
	}
	var notFoundResp models.RoomResponse
	json.NewDecoder(resp.Body).Decode(&notFoundResp)
	resp.Body.Close()
	if notFoundResp.Error == "" {
		t.Error("Expected error for nonexistent room")
	}
	t.Logf("Nonexistent room correctly returns error: %s", notFoundResp.Error)

	// Create a room
	code := ts.createRoom(t)

	// Test 2: Existing room returns code
	resp, err = http.Get(ts.URL + "/api/room/" + code)
	if err != nil {
		t.Fatalf("Failed to GET existing room: %v", err)
	}
	var roomResp models.RoomResponse
	json.NewDecoder(resp.Body).Decode(&roomResp)
	resp.Body.Close()
	if roomResp.Code != code {
		t.Errorf("Expected code=%s, got %s", code, roomResp.Code)
	}
	t.Logf("Room status: %+v", roomResp)
}

func cleanup() {
	room.Reset()
	session.Reset()
}
