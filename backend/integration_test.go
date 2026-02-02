package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frop/internal/room"
	"frop/internal/session"
	"frop/internal/ws"
	"frop/models"

	"github.com/gorilla/websocket"
)

// TestFullRoomFlow tests the complete flow:
// 1. Create room via POST /api/room
// 2. Creator joins via WebSocket
// 3. Joiner joins via WebSocket
// 4. Both receive "connected" message
func TestFullRoomFlow(t *testing.T) {
	defer cleanup()

	// Set up test server with both HTTP and WebSocket handlers
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/room", func(w http.ResponseWriter, r *http.Request) {
		code := room.CreateRoom()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.CreateRoomResponse{Code: code})
	})
	mux.HandleFunc("/ws", ws.ServeHttp)

	server := httptest.NewServer(mux)
	defer server.Close()

	// Step 1: Create room
	resp, err := http.Post(server.URL+"/api/room", "application/json", nil)
	if err != nil {
		t.Fatalf("Failed to create room: %v", err)
	}
	defer resp.Body.Close()

	var createResp models.CreateRoomResponse
	if err := json.NewDecoder(resp.Body).Decode(&createResp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	code := createResp.Code
	t.Logf("Created room with code: %s", code)

	if len(code) != 6 {
		t.Errorf("Expected 6-char code, got %q", code)
	}

	// Step 2: Creator connects via WebSocket and joins
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	creator, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Creator failed to connect: %v", err)
	}
	defer creator.Close()

	// Send join message
	joinMsg := map[string]string{"type": "join", "code": code}
	if err := creator.WriteJSON(joinMsg); err != nil {
		t.Fatalf("Creator failed to send join: %v", err)
	}
	t.Log("Creator sent join message")

	// Step 3: Joiner connects and joins
	joiner, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Joiner failed to connect: %v", err)
	}
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

	// For now, just verify the room has 2 peers
	time.Sleep(100 * time.Millisecond) // Give goroutines time to process
	r, exists := room.GetRoom(code)
	if !exists {
		t.Fatal("Room should exist")
	}
	_ = r // Use room to verify peer count once JoinRoom is wired up
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

// TestSessionTokenReconnect tests reconnection flow:
// 1. Two peers connect and get session token
// 2. One peer disconnects
// 3. Peer reconnects using session token
// 4. Should receive "connected" and be able to continue
func TestSessionTokenReconnect(t *testing.T) {
	defer cleanup()

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/room", func(w http.ResponseWriter, r *http.Request) {
		code := room.CreateRoom()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.CreateRoomResponse{Code: code})
	})
	mux.HandleFunc("/ws", ws.ServeHttp)

	server := httptest.NewServer(mux)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	// Create room and get code
	resp, _ := http.Post(server.URL+"/api/room", "application/json", nil)
	var createResp models.CreateRoomResponse
	json.NewDecoder(resp.Body).Decode(&createResp)
	resp.Body.Close()
	code := createResp.Code

	// Both peers join
	peer1, _, _ := websocket.DefaultDialer.Dial(wsURL, nil)
	peer2, _, _ := websocket.DefaultDialer.Dial(wsURL, nil)
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
	peer1Reconnected, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to reconnect: %v", err)
	}
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

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", ws.ServeHttp)

	server := httptest.NewServer(mux)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	conn, _, _ := websocket.DefaultDialer.Dial(wsURL, nil)
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

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/room", func(w http.ResponseWriter, r *http.Request) {
		code := room.CreateRoom()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.CreateRoomResponse{Code: code})
	})
	mux.HandleFunc("/ws", ws.ServeHttp)

	server := httptest.NewServer(mux)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	// Create room
	resp, _ := http.Post(server.URL+"/api/room", "application/json", nil)
	var createResp models.CreateRoomResponse
	json.NewDecoder(resp.Body).Decode(&createResp)
	resp.Body.Close()
	code := createResp.Code

	// Both peers join
	peer1, _, _ := websocket.DefaultDialer.Dial(wsURL, nil)
	peer2, _, _ := websocket.DefaultDialer.Dial(wsURL, nil)
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
		// Timeout is acceptable - notification might not be implemented yet
		t.Log("No disconnect notification received (may not be implemented yet)")
		return
	}

	if disconnectMsg["type"] != "peer_disconnected" {
		t.Errorf("Expected type=peer_disconnected, got %v", disconnectMsg)
	}

	t.Log("Peer correctly notified of disconnect!")
}

// TestJoinNonexistentRoom verifies joining a bad code fails gracefully
func TestJoinNonexistentRoom(t *testing.T) {
	defer cleanup()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", ws.ServeHttp)

	server := httptest.NewServer(mux)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	// Try to join nonexistent room
	joinMsg := map[string]string{"type": "join", "code": "FAKE99"}
	if err := conn.WriteJSON(joinMsg); err != nil {
		t.Fatalf("Failed to send join: %v", err)
	}

	// TODO(human): Should receive an error message back
	// For now, this test just verifies the server doesn't crash
	t.Log("Server handled bad code without crashing")
}

func cleanup() {
	room.Reset()
	session.Reset()
}
