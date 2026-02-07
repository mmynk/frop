package main

// Clipboard tests - tests text clipboard relay between peers.
// Uses the same helper functions as file_transfer_test.go.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"frop/internal/ws"

	"github.com/gorilla/websocket"
)

// =============================================================================
// CLIPBOARD TESTS
// =============================================================================
//
// These tests define the contract for clipboard relay. The backend must:
// 1. Forward clipboard JSON messages to the peer
// 2. Only allow clipboard transfer within established sessions

// TestClipboardRelay tests basic clipboard send/receive between peers
func TestClipboardRelay(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	peer1, peer2, _ := establishSession(t, server, wsURL)
	defer peer1.Close()
	defer peer2.Close()

	// Peer1 sends clipboard content
	clipboardContent := "Hello from clipboard!"
	clipboardMsg := map[string]string{
		"type":    "clipboard",
		"content": clipboardContent,
	}
	if err := peer1.WriteJSON(clipboardMsg); err != nil {
		t.Fatalf("Failed to send clipboard: %v", err)
	}
	t.Log("Peer1 sent clipboard message")

	// Peer2 should receive the clipboard content
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var received map[string]any
	if err := peer2.ReadJSON(&received); err != nil {
		t.Fatalf("Peer2 failed to receive clipboard: %v", err)
	}

	if received["type"] != "clipboard" {
		t.Errorf("Expected type=clipboard, got %v", received["type"])
	}
	if received["content"] != clipboardContent {
		t.Errorf("Expected content=%q, got %v", clipboardContent, received["content"])
	}

	t.Log("Clipboard relay successful!")
}

// TestClipboardBidirectional tests that both peers can send clipboard simultaneously
func TestClipboardBidirectional(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	peer1, peer2, _ := establishSession(t, server, wsURL)
	defer peer1.Close()
	defer peer2.Close()

	content1 := "From peer 1"
	content2 := "From peer 2"

	// Both peers send clipboard at roughly the same time
	peer1.WriteJSON(map[string]string{"type": "clipboard", "content": content1})
	peer2.WriteJSON(map[string]string{"type": "clipboard", "content": content2})

	// Each should receive the other's content
	peer1.SetReadDeadline(time.Now().Add(2 * time.Second))
	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))

	var recv1, recv2 map[string]any
	if err := peer1.ReadJSON(&recv1); err != nil {
		t.Fatalf("Peer1 failed to receive: %v", err)
	}
	if err := peer2.ReadJSON(&recv2); err != nil {
		t.Fatalf("Peer2 failed to receive: %v", err)
	}

	// Peer1 should receive content2, Peer2 should receive content1
	if recv1["content"] != content2 {
		t.Errorf("Peer1 expected %q, got %v", content2, recv1["content"])
	}
	if recv2["content"] != content1 {
		t.Errorf("Peer2 expected %q, got %v", content1, recv2["content"])
	}

	t.Log("Bidirectional clipboard works!")
}

// TestClipboardLargeContent tests clipboard with multi-line text and code snippets
func TestClipboardLargeContent(t *testing.T) {
	defer cleanup()

	server, wsURL := setupTestServer()
	defer server.Close()

	peer1, peer2, _ := establishSession(t, server, wsURL)
	defer peer1.Close()
	defer peer2.Close()

	// Multi-line code snippet
	codeSnippet := `func main() {
	fmt.Println("Hello, World!")
	for i := 0; i < 10; i++ {
		fmt.Printf("Count: %d\n", i)
	}
}

// This is a comment with special chars: <>&"'
// And some unicode: 你好世界 🎉`

	clipboardMsg := map[string]string{
		"type":    "clipboard",
		"content": codeSnippet,
	}
	if err := peer1.WriteJSON(clipboardMsg); err != nil {
		t.Fatalf("Failed to send large clipboard: %v", err)
	}

	peer2.SetReadDeadline(time.Now().Add(2 * time.Second))
	var received map[string]any
	if err := peer2.ReadJSON(&received); err != nil {
		t.Fatalf("Failed to receive large clipboard: %v", err)
	}

	if received["content"] != codeSnippet {
		t.Errorf("Large content mismatch.\nExpected:\n%s\n\nGot:\n%s", codeSnippet, received["content"])
	}

	t.Log("Large clipboard content relayed correctly!")
}

// TestClipboardNoSession tests that clipboard is rejected without an established session
func TestClipboardNoSession(t *testing.T) {
	defer cleanup()

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", ws.ServeHttp)
	server := httptest.NewServer(mux)
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	// Connect without joining a room (no session)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("Failed to connect: %v", err)
	}
	defer conn.Close()

	// Try to send clipboard without session
	clipboardMsg := map[string]string{
		"type":    "clipboard",
		"content": "sneaky content",
	}
	if err := conn.WriteJSON(clipboardMsg); err != nil {
		t.Fatalf("Failed to send clipboard: %v", err)
	}

	// Should receive a failure response
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var resp map[string]any
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	if resp["type"] != "failed" {
		t.Errorf("Expected type=failed for no-session clipboard, got %v", resp["type"])
	}

	t.Log("Clipboard correctly rejected without session!")
}
