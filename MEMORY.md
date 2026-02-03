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
