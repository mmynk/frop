# Memory

A living record of our frop journey — the decisions, the moments, the vibes. Written together so we both remember.

---

## 2026-02-01 — Day One

Started building frop: AirDrop but universal. The idea is simple — two people connect with a short code, then send files to each other. No accounts, no cloud storage, no BS.

Split the work: human takes the Go backend (learning Go!), Claude handles the frontend TypeScript. TDD approach — Claude writes integration tests first, human implements until they pass.

Built room creation and WebSocket pairing in one session. By end of day, two browser tabs could find each other through a 6-character code.

## 2026-02-02 — It Works™

Morning: fixed a peer reconnection bug where refreshing one browser left the other stuck on "Connection Lost." Small bug, satisfying fix.

Afternoon: file transfer. Claude wrote the test cases first (single-chunk, multi-chunk, bidirectional), human implemented the Go relay. Hit a `bytes.Buffer` accumulation bug — was holding all chunks in memory instead of streaming through. Fixed it, and suddenly... files were moving between browsers.

**End-to-end file transfer working.** The feeling when you drag a file onto one tab and it downloads on the other — chef's kiss.

## 2026-02-02 (evening) — We're Live 🚀

Deployed to Fly.io. First real deployment.

The journey: considered AWS (human works at Amazon) but decided against using employer resources for personal projects. Went with Fly.io free tier instead — single Go binary, perfect fit.

Hit some bumps:
- Fly's `fly launch` kept generating its own Dockerfile and ignoring ours
- It created duplicate config files in `backend/` instead of project root
- Had to explicitly set `dockerfile = 'Dockerfile'` in fly.toml

But then it worked. **Transferred files between phone and laptop over the internet.** Not localhost. Not two tabs. A real phone and a real laptop, talking through a server running in San Jose.

Set up the custom domain: **frop.mmynk.com**. Added A/AAAA records in Cloudflare (DNS-only mode), Fly provisioned the Let's Encrypt cert automatically. Five minutes later, live on our own domain.

frop is in the wild. 🚀

## 2026-02-03 — The 6GB Test 💥

Time to stress test. Tried sending a 6GB file between devices.

**It crashed.** Hard.

```
panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation]
```

The system rebooted. Not ideal.

### The Investigation

Two problems, one root cause:

**Frontend**: No backpressure. The sender was blasting 24,000 chunks (256KB each) as fast as possible without checking if the WebSocket could keep up. `ws.bufferedAmount` was never checked. For a 6GB file, that's... a lot of RAM being queued up.

**Backend**: Race condition. When the connection timed out from memory bloat, one peer disconnected. But the relay goroutine was still trying to forward chunks. It called `session.GetPeer()`, which tried to dereference a nil pointer (the disconnected peer). SIGSEGV. Game over.

### The Fixes

**Backend**: Added nil checks everywhere. If a peer is nil (disconnected), return an error instead of crashing. Simple defensive programming.

**Frontend**: Three changes:
1. **Backpressure**: Added `waitForBuffer()` that pauses sending when `bufferedAmount` > 8MB. Natural flow control.
2. **Bigger chunks**: 256KB → 4MB. A 6GB file is now 1,500 chunks instead of 24,000. 16x less overhead.
3. **Streaming downloads**: Files > 100MB use the File System Access API to stream directly to disk instead of accumulating in RAM. Browser asks where to save, then writes chunks as they arrive.

### The Insight

The backend relay model is beautiful. Each goroutine:
1. Reads a chunk from sender's WebSocket
2. Immediately forwards to receiver's WebSocket
3. Garbage collects the buffer

Zero accumulation. Zero storage. Just a relay. The TCP stack handles backpressure naturally — if the receiver is slow, `WriteMessage` blocks, which pauses the read loop, which makes the sender's buffer grow, which triggers our frontend `waitForBuffer()`.

Cascading backpressure, zero configuration.

Now we can send 6GB files. Time to test again.

## 2026-02-06 — Cancel & Clipboard

Two features in one session.

**Cancel transfers**: Adding the ability to cancel file transfers mid-stream. Either peer can cancel — sender can stop sending, receiver can reject. The interesting part is handling in-flight chunks gracefully. Context cancellation stops the relay goroutine, and both sides clean up their state.

**Clipboard sharing**: The natural complement to file sharing. Copy text on one device, click "📋 Clipboard" (or Ctrl+V), and it appears on the other device with a "Copy" button. Same relay pattern as files — just JSON instead of binary frames.

Both features followed the TDD approach: Claude writes tests defining the message contract, human implements the backend handler (usually just one line in the switch statement pointing to `handleFraming`), then Claude implements the frontend UI.

The pattern is becoming second nature now. New feature? Add the message type to models, write the tests, implement the relay, build the UI. The WebSocket protocol is flexible enough that most features are just "relay this JSON to the peer."

## 2026-02-07 — Backend Cleanup

Refactoring day. The `handler.go` file had grown repetitive — `handleFraming`, `handleClipboard`, and the relay all had the same "lookup session, get peer, forward message" pattern duplicated.

Extracted `GetRemotePeer(conn)` into the session package. Now both handler and relay just call one function. Added sentinel errors (`ErrSessionNotFound`, `ErrPeerDisconnected`) next to it in `store.go` — keeping the errors with the lookup logic they describe.

Started with a separate `wserrors` package, but that felt wrong. The errors are really about session state, not websocket errors. Moving them to the session package was cleaner — no new package, no awkward naming.

Considered splitting `handler.go` into `handler.go` + `processor.go`, but at 150 lines it's not worth it yet. Good reminder: don't split files preemptively. Wait until there's actual pain.

## 2026-02-07 (evening) — Favicon & Deployment Research

Added a favicon — went with the "droplets" icon from Lucide (MIT licensed). Fits the name (frop ~ drop) and looks clean at small sizes. Blue outline, SVG format. Simple.

Also researched deployment alternatives since Fly.io killed their free tier. Turns out Cloudflare has a new Containers beta that runs Docker containers on their edge. Could keep the Go backend as-is, no rewrite needed. WebSockets supported. $5/mo base + usage-based pricing. Parked the research in `scratch/cloudflare-deployment-research.md` for when we're ready to migrate.

## 2026-02-08 — v1 Complete! 🎉

The final push. Wrapped up all the Milestone 3 polish items.

### Room Full Rejection

If a third person tries to join a room with two connected peers, they now get a proper error message instead of weird behavior. Added `ErrRoomFull` to the room package, and the frontend shows a friendly toast: "Room is full. Only 2 people can connect."

### Toast Notifications

Replaced all the ugly `alert()` calls with a proper toast notification system. Red toasts slide in from the bottom, auto-dismiss after 4 seconds. Added error code mapping so backend errors like `room_not_found` become "Room not found. Check the code and try again."

### GET /api/room/:code

Added a status endpoint so you can check if a room exists before trying to join. Returns `{exists, peerCount, isFull}`. Useful for building on top of the API.

### Lazy Expiration

Rooms expire 30 minutes after creation. Sessions expire 15 minutes after last activity. But instead of background cleanup goroutines (which add complexity and race conditions), we do lazy cleanup: check expiration in `GetRoom()` and `GetSession()`, delete if stale.

Benefits:
- No timers to manage
- No mutex-protected cleanup goroutines
- Cleanup happens exactly when you need the resource
- Simpler code, fewer bugs

### Integration Test Refactor

The integration tests were duplicating route handlers from `main.go`. Extracted `internal/routes/routes.go` with a `Setup(mux)` function. Now both `main.go` and tests use the same handlers — tests verify actual production code paths.

Added a `testServer` helper struct with `createRoom()`, `dialWS()`, `joinRoom()` methods. Much cleaner than raw HTTP calls scattered everywhere.

### Three Bugs

Running all tests together exposed three bugs that didn't show up when running tests individually:

1. **Inverted error check**: `if err != nil` should have been `if err == nil` in the disconnect handler. Was trying to disconnect from sessions that *didn't* exist.

2. **Nil pointer in deleteSession**: When deleting a session, the peers might already be nil (disconnected). Added nil checks before accessing `sess.PeerA.Conn`.

3. **Error response on closed connection**: When a WebSocket closes normally, we were logging an error and trying to send a failure response to... a closed connection. Added check for close errors.

### GitHub Footer

Added a subtle footer link to the source code. Fixed position, bottom-right corner. Ready for HackerNews.

**v1 is shipped.** Time to see what the internet thinks.

## 2026-02-08 (evening) — Folder Drag-and-Drop

Bug report: dragging a folder onto the dropzone doesn't work. Only the "Select Folder" button works.

### The Problem

When you drop a folder, `e.dataTransfer.files` gives you a single `File` object representing the folder itself — not its contents. And that File object is unreadable (size 0, can't slice it). The browser's native `<input webkitdirectory>` works because it triggers special folder traversal code that populates `webkitRelativePath` on each file.

### The Fix

The `webkitGetAsEntry()` API. Each dropped item can be converted to a `FileSystemEntry`, which has `isDirectory` and `isFile` properties. For directories, you call `createReader()` and `readEntries()` to get the contents.

Tricky part: `readEntries()` returns results in batches (browser limitation). You have to call it in a loop until it returns an empty array. Classic callback-based API that needed promisification.

```typescript
do {
  batch = await readBatch();
  // process entries...
} while (batch.length > 0);
```

Also had to attach relative paths manually via a custom `_relativePath` property since `webkitRelativePath` is read-only.

### The Rabbit Hole

Tried to also fix the receiver side — when you receive a folder's files, they should download into a folder structure, not as flat files. Used the File System Access API (`showDirectoryPicker`) to let the user choose a download location, then `getDirectoryHandle` with `{ create: true }` to create nested folders.

It... almost worked. But hit async race conditions — multiple files arriving triggered multiple directory picker prompts despite our Promise-based locking. Something about how WebSocket message handlers queue up.

After a few attempts, called it. The sending side works great. Receiver-side folder structure is a future problem.

### Lesson

Sometimes you fix one bug and discover a bigger one hiding behind it. Know when to ship what works.
