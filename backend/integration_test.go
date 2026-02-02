package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frop/internal/room"
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
	// TODO(human): Once handler.go sends "connected" messages, uncomment this:
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
	// TODO(human): Implement this check once JoinRoom properly assigns peers
	time.Sleep(100 * time.Millisecond) // Give goroutines time to process
	exists, r := room.GetRoom(code)
	if !exists {
		t.Fatal("Room should exist")
	}
	_ = r // Use room to verify peer count once JoinRoom is wired up
	t.Log("Room exists - test framework working!")
}

// TestJoinNonexistentRoom verifies joining a bad code fails gracefully
func TestJoinNonexistentRoom(t *testing.T) {
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
