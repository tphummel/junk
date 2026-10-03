# bluetooth-sniffer

Passive BLE advertisement logger. Subscribes to BlueZ (system D-Bus), runs LE discovery on one adapter, and writes every sighting to SQLite (`events` append-only, `devices` rolled-up). Pure Go, `CGO_ENABLED=0`, linux/amd64 + linux/arm64 binaries. No Docker: it needs the host's `bluetoothd` and D-Bus, so it runs bare metal.

Based on the BLE Advertising Logger design doc (hardware: TP-Link UB500 Plus, Debian mini PC).

## Usage

```
bluetooth-sniffer [-adapter /org/bluez/hci0] [-db /opt/bluetooth-sniffer/sniffer.db] [-flush-ms 1000] [-flush-rows 500] [-raw-ad]
bluetooth-sniffer purge [-db ...] [-keep-days 14] [-vacuum]
```

SIGTERM/SIGINT stops discovery, flushes, and closes the DB.

```
sqlite3 sniffer.db "SELECT datetime(ts,'unixepoch'),addr,name,rssi FROM events ORDER BY ts DESC LIMIT 20"
sqlite3 sniffer.db "SELECT * FROM devices ORDER BY last_rssi DESC LIMIT 20"
```

## Install

Download a tarball from a GitHub release: `bluetooth-sniffer-<short-sha>` (immutable, one per main commit touching this directory) or `bluetooth-sniffer-latest` (ephemeral, recreated on every such push), then `sudo deploy/install.sh bluetooth-sniffer-linux-amd64`. See `deploy/` for the systemd unit and cron (nightly purge, weekly VACUUM). Set `-adapter` in the unit to match the dongle (`busctl tree org.bluez`).

Dongle tips: use a USB 2.0 port, and disable USB autosuspend (`power/autosuspend` = -1) or the adapter may drop.

## Deviations from the design doc

- Binary/paths are named `bluetooth-sniffer` (`/opt/bluetooth-sniffer/sniffer.db`, unit, cron).
- `InterfacesAdded` is emitted by BlueZ from path `/`, not the adapter path, so the match is by interface/sender and filtered to the adapter in Go.
- Rather than `GetAll` per signal, full properties from `InterfacesAdded` are cached and `PropertiesChanged` deltas merged in (one `GetAll` for devices BlueZ knew before startup). Avoids a D-Bus round trip per advertisement.
- `name` and `alias` are stored separately (`name` is BlueZ `Name` only, no alias fallback; `alias` is BlueZ `Alias`, which BlueZ sets to the MAC when there is no name). Both are on `events` and `devices`; existing databases get the `alias` columns added on open.
- Extra columns beyond the doc: `sensor` (local adapter address), `mfr_id` (lowest manufacturer company ID), `appearance`, `modalias`, `changed` (properties in the update that triggered the row, or `added`), and `raw_ad` (`0xTYPE=hex;...`). `devices` also keeps `mfr_id`, `appearance`, `modalias` (last non-null wins). `raw_ad` is filled only with `-raw-ad` and when `bluetoothd` runs with `--experimental` (`-E`), since BlueZ only exposes `AdvertisingData` then; otherwise it stays empty.
- `addr_type` prefers BlueZ's `AddressType`, falling back to the MAC top-bits rule.
- BlueZ doesn't expose advertising PDU type, so connectability can't be known over D-Bus. `events.connectable` is replaced by `ad_flags` (raw AD Flags byte, e.g. bit 0x02 = LE General Discoverable). Old databases are migrated on open. Real connectability needs the mgmt/HCI monitor socket (phase 2).
- `svc_uuids` are sorted; `mfr_data` is `0xCID=hex;...`, `svc_data` is `uuid=hex;...`.
- `purge` only VACUUMs with `-vacuum`.
- Discovery filter sets `Transport=le`, `DuplicateData=true`.

## Build / test

```
go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" .
```

Go 1.27.1. Not yet validated against real hardware: that's the doc's section 11 checklist.
