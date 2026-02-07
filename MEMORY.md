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
