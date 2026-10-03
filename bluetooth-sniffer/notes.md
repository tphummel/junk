# notes
- Asked clarifying questions: GitHub release for binaries (rolling tag), no Docker (bare metal D-Bus), naming bluetooth-sniffer, scope = scanner+purge, systemd/cron, tests.
- User asked for Go 1.27.1; local asdf only had 1.25.x, used GOTOOLCHAIN=go1.27.1 to download it.
- BlueZ ObjectManager signals come from "/" so doc's adapter-path match would miss InterfacesAdded.
- Tests cover parsing, upsert rollup semantics, purge. No real BlueZ available to test the D-Bus loop.
