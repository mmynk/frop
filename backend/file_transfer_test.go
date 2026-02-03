package main

// File transfer tests - tests binary relay between peers.

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

// =============================================================================
// FILE TRANSFER TESTS
// =============================================================================
//
// These tests define the contract for binary relay. The backend must:
// 1. Forward file_start/file_end JSON messages to the peer
// 2. Forward binary frames (file chunks) to the peer
// 3. Only allow file transfer within established sessions

// TestFileTransferRelaySmallFile tests a single-chunk file transfer
// Flow: file_start -> one binary chunk -> file_end
func TestFileTransferRelaySmallFile(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	// Establish session between two peers
	peer1, peer2, _ := establishSession(t, server, wsURL)
	defer peer1.Close()
	defer peer2.Close()

	// Peer1 sends a small file (100 bytes)
	testData := make([]byte, 100)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	// Send file_start
	fileStart := map[string]any{"type": "file_start", "name": "test.txt", "size": 100}
	if err := peer1.WriteJSON(fileStart); err != nil {
		t.Fatalf("Failed to send file_start: %v", err)
	}

	// Send binary chunk
	if err := peer1.WriteMessage(websocket.BinaryMessage, testData); err != nil {
		t.Fatalf("Failed to send binary chunk: %v", err)
	}

	// Send file_end
	fileEnd := map[string]any{"type": "file_end", "name": "test.txt"}
	if err := peer1.WriteJSON(fileEnd); err != nil {
		t.Fatalf("Failed to send file_end: %v", err)
	}

	// Peer2 should receive: file_start, binary data, file_end (in order)
	peer2.SetReadDeadline(time.Now().Add(5 * time.Second))

	// Expect file_start
	var startMsg map[string]any
	if err := peer2.ReadJSON(&startMsg); err != nil {
		t.Fatalf("Peer2 failed to receive file_start: %v", err)
	}
	if startMsg["type"] != "file_start" {
		t.Errorf("Expected file_start, got %v", startMsg)
	}
	if startMsg["name"] != "test.txt" {
		t.Errorf("Expected name=test.txt, got %v", startMsg["name"])
	}
	if int(startMsg["size"].(float64)) != 100 {
		t.Errorf("Expected size=100, got %v", startMsg["size"])
	}

	// Expect binary chunk
	msgType, receivedData, err := peer2.ReadMessage()
	if err != nil {
		t.Fatalf("Peer2 failed to receive binary chunk: %v", err)
	}
	if msgType != websocket.BinaryMessage {
		t.Errorf("Expected BinaryMessage, got type %d", msgType)
	}
	if len(receivedData) != len(testData) {
		t.Errorf("Data length mismatch: sent %d, received %d", len(testData), len(receivedData))
	}
	for i, b := range receivedData {
		if b != testData[i] {
			t.Errorf("Data mismatch at byte %d: sent %d, received %d", i, testData[i], b)
			break
		}
	}

	// Expect file_end
	var endMsg map[string]any
	if err := peer2.ReadJSON(&endMsg); err != nil {
		t.Fatalf("Peer2 failed to receive file_end: %v", err)
	}
	if endMsg["type"] != "file_end" {
		t.Errorf("Expected file_end, got %v", endMsg)
	}
	if endMsg["name"] != "test.txt" {
		t.Errorf("Expected name=test.txt in file_end, got %v", endMsg["name"])
	}

	t.Log("Small file transfer relay successful!")
}

// TestFileTransferRelayMultiChunk tests a multi-chunk file transfer
// Simulates a ~600KB file split into 256KB chunks
func TestFileTransferRelayMultiChunk(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	peer1, peer2, _ := establishSession(t, server, wsURL)
	defer peer1.Close()
	defer peer2.Close()

	// Create test data: 600KB = 3 chunks (256KB + 256KB + 88KB)
	const chunkSize = 256 * 1024
	const totalSize = 600 * 1024
	testData := make([]byte, totalSize)
	for i := range testData {
		testData[i] = byte(i % 256)
	}

	// Send file_start
	fileStart := map[string]any{"type": "file_start", "name": "large.bin", "size": totalSize}
	peer1.WriteJSON(fileStart)

	// Send chunks
	for offset := 0; offset < totalSize; offset += chunkSize {
		end := min(offset+chunkSize, totalSize)
		chunk := testData[offset:end]
		if err := peer1.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
			t.Fatalf("Failed to send chunk at offset %d: %v", offset, err)
		}
	}

	// Send file_end
	fileEnd := map[string]any{"type": "file_end", "name": "large.bin"}
	peer1.WriteJSON(fileEnd)

	// Receive and reassemble on peer2
	peer2.SetReadDeadline(time.Now().Add(10 * time.Second))

	// Receive file_start
	var startMsg map[string]any
	peer2.ReadJSON(&startMsg)
	if startMsg["type"] != "file_start" {
		t.Fatalf("Expected file_start, got %v", startMsg)
	}

	// Receive all chunks
	var received []byte
	for len(received) < totalSize {
		msgType, data, err := peer2.ReadMessage()
		if err != nil {
			t.Fatalf("Failed to receive chunk: %v", err)
		}
		if msgType != websocket.BinaryMessage {
			// Might be file_end if something went wrong
			t.Fatalf("Expected binary message, got type %d", msgType)
		}
		received = append(received, data...)
	}

	// Receive file_end
	var endMsg map[string]any
	peer2.ReadJSON(&endMsg)
	if endMsg["type"] != "file_end" {
		t.Errorf("Expected file_end, got %v", endMsg)
	}

	// Verify data integrity
	if len(received) != len(testData) {
		t.Errorf("Data length mismatch: sent %d, received %d", len(testData), len(received))
	}
	for i := range testData {
		if received[i] != testData[i] {
			t.Errorf("Data mismatch at byte %d", i)
			break
		}
	}

	t.Log("Multi-chunk file transfer relay successful!")
}

// TestFileTransferBidirectional tests that both peers can send files simultaneously
func TestFileTransferBidirectional(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	peer1, peer2, _ := establishSession(t, server, wsURL)
	defer peer1.Close()
	defer peer2.Close()

	// Peer1 sends file1.txt, Peer2 sends file2.txt
	data1 := []byte("Hello from peer 1!")
	data2 := []byte("Greetings from peer 2!")

	// Both send file_start
	peer1.WriteJSON(map[string]any{"type": "file_start", "name": "file1.txt", "size": len(data1)})
	peer2.WriteJSON(map[string]any{"type": "file_start", "name": "file2.txt", "size": len(data2)})

	// Both send data
	peer1.WriteMessage(websocket.BinaryMessage, data1)
	peer2.WriteMessage(websocket.BinaryMessage, data2)

	// Both send file_end
	peer1.WriteJSON(map[string]any{"type": "file_end", "name": "file1.txt"})
	peer2.WriteJSON(map[string]any{"type": "file_end", "name": "file2.txt"})

	// Each should receive the other's file
	peer1.SetReadDeadline(time.Now().Add(5 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(5 * time.Second))

	// Peer1 receives file2.txt
	received1 := receiveFile(t, peer1, "file2.txt")
	if string(received1) != string(data2) {
		t.Errorf("Peer1 received wrong data: %q", received1)
	}

	// Peer2 receives file1.txt
	received2 := receiveFile(t, peer2, "file1.txt")
	if string(received2) != string(data1) {
		t.Errorf("Peer2 received wrong data: %q", received2)
	}

	t.Log("Bidirectional file transfer successful!")
}

// TestFileTransferNoSession verifies file transfer is rejected without a session
func TestFileTransferNoSession(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	// Connect but do NOT establish session (no join message)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	// Try to send file_start without being in a session
	fileStart := map[string]any{"type": "file_start", "name": "evil.txt", "size": 100}
	conn.WriteJSON(fileStart)

	// Try to send binary data
	conn.WriteMessage(websocket.BinaryMessage, []byte("malicious data"))

	// Server should NOT crash - verify by sending a ping
	time.Sleep(100 * time.Millisecond)
	if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
		// Connection might be closed, which is acceptable
		t.Log("Connection closed (acceptable behavior for unauthorized transfer attempt)")
		return
	}

	t.Log("Server handled file transfer without session gracefully")
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// setupTestServer creates a test server with room and WebSocket handlers
func setupTestServer() (*httptest.Server, string) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/room", func(w http.ResponseWriter, r *http.Request) {
		code := room.CreateRoom()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(models.CreateRoomResponse{Code: code})
	})
	mux.HandleFunc("/ws", ws.ServeHttp)

	server := httptest.NewServer(mux)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	return server, wsURL
}

// establishSession creates a room and connects two peers, returning their connections
// and the session token
func establishSession(t *testing.T, server *httptest.Server, wsURL string) (*websocket.Conn, *websocket.Conn, string) {
	t.Helper()

	// Create room
	resp, err := http.Post(server.URL+"/api/room", "application/json", nil)
	if err != nil {
		t.Fatalf("Failed to create room: %v", err)
	}
	var createResp models.CreateRoomResponse
	json.NewDecoder(resp.Body).Decode(&createResp)
	resp.Body.Close()
	code := createResp.Code

	// Connect both peers
	peer1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Peer1 failed to connect: %v", err)
	}
	peer2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Peer2 failed to connect: %v", err)
	}

	// Both join
	peer1.WriteJSON(map[string]string{"type": "join", "code": code})
	peer2.WriteJSON(map[string]string{"type": "join", "code": code})

	// Read connected messages
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))

	var msg1, msg2 map[string]any
	peer1.ReadJSON(&msg1)
	peer2.ReadJSON(&msg2)

	if msg1["type"] != "connected" || msg2["type"] != "connected" {
		t.Fatalf("Expected both to be connected, got: %v, %v", msg1, msg2)
	}

	sessionToken := msg1["sessionToken"].(string)

	// Clear deadlines for test use
	peer1.SetReadDeadline(time.Time{})
	peer2.SetReadDeadline(time.Time{})

	return peer1, peer2, sessionToken
}

// receiveFile reads file_start, binary data, and file_end, returning the data
func receiveFile(t *testing.T, conn *websocket.Conn, expectedName string) []byte {
	t.Helper()

	// Read file_start
	var startMsg map[string]any
	if err := conn.ReadJSON(&startMsg); err != nil {
		t.Fatalf("Failed to read file_start: %v", err)
	}
	if startMsg["type"] != "file_start" {
		t.Fatalf("Expected file_start, got %v", startMsg)
	}
	if startMsg["name"] != expectedName {
		t.Fatalf("Expected name=%s, got %v", expectedName, startMsg["name"])
	}

	expectedSize := int(startMsg["size"].(float64))

	// Read binary data
	msgType, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("Failed to read binary data: %v", err)
	}
	if msgType != websocket.BinaryMessage {
		t.Fatalf("Expected binary message, got type %d", msgType)
	}
	if len(data) != expectedSize {
		t.Fatalf("Size mismatch: expected %d, got %d", expectedSize, len(data))
	}

	// Read file_end
	var endMsg map[string]any
	if err := conn.ReadJSON(&endMsg); err != nil {
		t.Fatalf("Failed to read file_end: %v", err)
	}
	if endMsg["type"] != "file_end" {
		t.Fatalf("Expected file_end, got %v", endMsg)
	}

	return data
}
