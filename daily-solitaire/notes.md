# daily-solitaire — working notes

- Source of truth: `klondike-technical-plan.md` (copied from the attached design doc).
- Followed the layout/Docker/CI conventions of `app-passkey/` and `artifact-cache/`.
- Vendored Turbo 8.0.13 + Stimulus 3.2.2 from npm (jsdelivr is blocked in the sandbox proxy; `npm pack` works).
- modernc.org/sqlite latest (v1.61) needs Go 1.26; pinned v1.56.0 (go 1.25) to match the repo's Go 1.25.

## Log
- Engine first: splitmix64 + Fisher-Yates deck, undo as a recorded move, `Complete()` fills draw/recycle cards so recorded moves self-check on replay.
- Solver: DFS with visited set, safe-foundation forcing; ~60% of seeds solved at 300k nodes (~1s each). 13 solved seeds became golden fixtures.
- Gotchas: virtualwebauthn's signature counter doesn't auto-increment (go-webauthn flags clones); a headless virtual authenticator auto-completes conditional UI, so a /login visit signs in immediately; `pkill -f` matched its own shell.
- Face-down/stock cards use positional DOM ids so ids never leak identity (card ids are only on face-up cards).
- Couldn't build the Docker image (no daemon). Everything else verified with tests + Playwright.
