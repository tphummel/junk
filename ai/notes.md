# Notes

- Task: build VenueCheck (design doc in `venuecheck-design-doc.md`) as new `ai/` folder in junk repo, with CI to build + publish image.
- Sample conventions studied: `app-passkey` (Go 1.25, mattn/go-sqlite3 CGO, go-webauthn, virtualwebauthn for tests, ghcr.io workflow w/ test + buildx job).
- Leaflet 1.9.4 vendored from the npm tarball (design: bundled, no CDN).
- Decision: FTS5 needs `-tags sqlite_fts5` with mattn/go-sqlite3.
- Layout copied from app-passkey: cmd/ + internal/, Dockerfile w/ CGO, workflow with test job then buildx push to ghcr.
- Found/fixed while building:
  - `go.mod` needs Go 1.25 (toolchain auto-downloaded).
  - WebAuthn user handle must match what login returns — first version used a throwaway handle at registration and
    login failed with "User handle and User ID do not match". Go unit tests with virtualwebauthn did NOT catch it;
    the Playwright + CDP virtual-authenticator run did. Fix: random `users.handle` stored on insert.
  - `±1 day` check-in edit window was relative to the current value (drifts); added `checkins.original_at`.
  - Overpass `regexMeta` replacement string escaping (`\$0`), verified by test.
  - Heredocs containing a literal U+FEFF broke `go vet`; use `string([]byte{0xEF,0xBB,0xBF})` in tests.
- Passkeys need HTTPS + hostname RP ID; the design's plain-HTTP-on-LAN-IP can't work -> documented Caddy setup.
- Sandbox: outbound Overpass is blocked (403), so OSM paths are covered by httptest fakes only; the UI degrades to local results.
- No Docker daemon in sandbox: image build is unverified locally.
- Verification: `go test -tags sqlite_fts5 -race ./...` green; Playwright flow register -> check-in -> search -> logout -> login green.
