# 0011: Web project data lives in the browser, with export, import and a weekly backup reminder

- Status: Proposed
- Date: 2026-11-25

## Context

Some `web/` pages keep data the user cares about: logs, scores, trackers, notes. With no backend ([ADR 0003](0003-webpages.md), [ADR 0002](0002-no-web-build-step.md)) that data sits in `localStorage` or IndexedDB on one device. Browsers can clear it (storage pressure, "clear site data", Safari's idle eviction for sites not added to the home screen), and it does not move to a new phone or browser. Each `*.junk.tomhummel.com` preview branch is also its own origin, so data there is separate from production. Today each page decides for itself how, or whether, to get data out, and nothing reminds the user to do it.

Pages that record what happened over time are better served by a record of each event than by a single mutable snapshot. A snapshot loses history, cannot be merged with another device's copy, and cannot answer questions the author did not think of in advance. Where an event happened can also matter (a trail check, a trip, a workout), but location is personal data and many pages have no use for it.

Pages that call an API ([ADR 0004](0004-apis.md)) and keep their state there are out of scope; this covers data that lives in the browser.

## Decision

Any webpage that stores user data in the browser follows this. Pages that store nothing, or only disposable UI state such as a remembered tab, are exempt.

1. **Storage.** Use IndexedDB for event logs and anything over a few hundred KB, and `localStorage` for small settings. Keys and database names are prefixed with the page name (`<name>:`), because pages share an origin. Call `navigator.storage.persist()` once the page holds real data, and ignore a refusal. Every storage call is wrapped so the page still loads when storage is blocked.
2. **One export format.** The page exports a single JSON file, `<name>-backup-YYYY-MM-DD.json`:
   ```json
   {
     "app": "<name>",
     "schema": 1,
     "exportedAt": "2026-11-25T14:03:11.250Z",
     "settings": {},
     "events": []
   }
   ```
   - `schema` is an integer the page bumps when the shape changes. Pages keep a function that upgrades older schemas, so old backups always import.
   - `exportedAt` and `lastBackupAt` are ISO 8601 UTC strings; event times follow item 5. No page-specific binary formats.
   - Export is a button that builds a `Blob` and downloads it via an `<a download>`. Where `navigator.share` accepts files (phones), offer that too so the file can go to Files or cloud storage.
   - A page may also offer a CSV export of events for use in a spreadsheet. JSON stays the backup of record.
3. **Import** is a file picker (and drop target) that reads JSON locally.
   - Reject files whose `app` does not match, or whose `schema` is newer than the page knows, with a plain message. Validate before writing anything; a bad file changes nothing.
   - Ask whether to **merge** or **replace**. Merge is the default and is safe to repeat: events are keyed by `id`, so importing the same file twice adds nothing. Replace says what it will delete and offers to export the current data first.
   - Nothing is uploaded; import and export are entirely client side.
4. **Weekly backup reminder.**
   - The page stores `<name>:lastBackupAt` (ISO timestamp), set only when an export completes (the download was started, or the share sheet reported success). It is also set on import with replace, since the data now matches a file the user holds.
   - Whenever the page holds data and `lastBackupAt` is missing or more than **7 days** old, it shows a non-blocking banner on load: "Last backup: 9 days ago (or never). Export now." The banner has an Export button and a "Remind me tomorrow" dismissal, stored as `<name>:remindAfter`. It comes back after that time, not on the next reload.
   - The page always shows the last backup time (absolute and relative) next to the export button, so the user can see it without waiting for a reminder.
   - There are no push notifications, background sync or periodic tasks: the pages have no backend and a reminder only needs to reach someone who opens the page. A page used less often than weekly shows the reminder when next opened.
   - Reminder state is device-local and is not part of the export. Importing a backup does not carry another device's `lastBackupAt`.
5. **Event data, where the use case calls for a history.**
   - Store an append-only log of events rather than only the current state, and derive current state and summaries from it. A page that is a simple setting or a single document keeps a snapshot and is exempt from this item.
   - Record each event at the finest granularity the user actually acts at, not a daily or session rollup. Rollups are computed when displayed. Each event has the shape `toothup` already uses:
     ```json
     {
       "id": "f1700000000000",
       "type": "floss",
       "start": 1700000000000,
       "offset": -480,
       "lat": null,
       "lon": null,
       "acc": null
     }
     ```
     - `id` is unique within the log and derived from the event, so merges are idempotent (`toothup` uses a type prefix plus `start`).
     - `start` is when it happened, epoch milliseconds. `offset` is the UTC offset in minutes (east positive) where the user was at that moment, so the local calendar day can be recomputed correctly after travel.
     - `lat`, `lon` and `acc` are the location (item 6), each `null` when unknown or not recorded. Page-specific fields (for example `seconds`) sit alongside them.
     - Imports normalize every event and drop any that are malformed.
   - Events are not edited in place. A correction is a new event that references the old `id` (for example `type: "void"`), so history stays auditable and merges stay simple. Deleting is allowed, and is the user's explicit action.
6. **Location is opt-in per use case.**
   - A page records location only if knowing where an event happened is part of what the page is for. Decide that when writing the page, and say so in its README or page text. Most pages should not.
   - When it does, the page asks for permission with `navigator.geolocation` only after the user turns on a "record location" setting, never on load, and records nothing if permission is refused. The setting is off by default and can be turned off at any time.
   - `lat` and `lon` are decimal degrees rounded to 6 places and `acc` is the reported accuracy in whole meters, as `toothup` does. All three are `null` when unknown, out of range or not recorded; a good `lat` and `lon` with no usable accuracy keeps `acc` as `null`. A page that does not need that precision may round coarser.
   - Location is captured at the moment of the event, so an event never gets a position from later. A failed or slow lookup (a short timeout) leaves them `null`; it never blocks recording the event.
   - Location is stored locally and leaves the device only in an export file the user chose to save. It is never sent to an API, analytics service or third-party map or geocoding service. A page that wants a map or address lookup must say so and link a plain URL the user opens, rather than sending coordinates itself.
   - The export includes `lat`, `lon` and `acc`, so the page tells the user that backups contain locations. A page may offer "export without locations".
7. **Backup files are the user's.** Pages never send them anywhere, and nothing in the repo stores real backups. Fixtures for tests use made-up data.
8. **Pages that predate this ADR** are exempt until next modified, as in [ADR 0001](0001-web-styling.md) and [ADR 0008](0008-pwa-for-all-offline-for-self-contained.md), and then add what is missing. Migrated pages (ADR 0003) are treated the same.
9. **Shared code.** Each page carries its own copy of the export, import and reminder code, in line with ADR 0003. A page that wants to share it follows the rules for shared files in ADR 0003 rather than inventing a loader or build step.

## Consequences

- A user can move a page's data between devices, recover from cleared site data, and keep their own copy, with no server.
- Backups depend on the user acting. The reminder makes a missed backup visible but does not make it happen, and a user who ignores it can still lose data.
- `lastBackupAt` records that an export was started, not that the file was kept or can be restored. Download dialogs and share sheets cannot confirm that.
- Event logs grow over time. IndexedDB handles that; a page that expects very large logs should offer export-and-trim, which is a later decision.
- Storing every event costs more than a snapshot and needs summary code. In return, history, corrections and merging come for free, and new questions can be answered from old data.
- Merge by `id` only deduplicates events. Settings from a merge take the imported value only if the user chooses, so a page must say which wins.
- Location data is sensitive. Defaulting it off, rounding it, and keeping it on the device limits the exposure, but anyone holding an export file has the coordinates.
- Rejecting newer schemas means an old deploy cannot read a backup from a newer one. Rolling a page back needs a downgrade or a fresh start.
- Each preview origin has separate data, so testing import and export on a preview does not touch production data.
- Nothing in CI checks any of this.

## Alternatives considered

- **Server-side storage through an API with KV or D1 ([ADR 0004](0004-apis.md)).** Gives real durability and sync, but needs accounts or a shared secret, and turns small offline-capable pages into network-bound ones, which conflicts with ADR 0008. Still the right choice for a page whose data must be shared between people.
- **Cloud sync through a third-party service (Dropbox, Google Drive, iCloud).** Automatic, but adds OAuth, an external dependency and a privacy trade-off to every page.
- **File System Access API for auto-saving to a chosen file.** Fits the problem, but it is Chromium desktop only, so it cannot be the baseline. A page may add it as an extra.
- **Push or scheduled notifications for the reminder.** Needs a backend or a service worker with permissions, and ADR 0008 only gives service workers to some pages. An in-page banner covers the case at no cost.
- **Snapshot-only storage.** Simpler to code, but loses history and cannot be merged between devices.
- **Daily or per-session rollups.** Smaller, but they cannot be undone into finer detail later, while fine events can always be rolled up.
- **Always recording location.** Easy, but most pages have no use for it, and it makes every backup file sensitive. Making it a per-page, opt-in decision keeps that cost to pages that need it.
- **Per-page export formats.** Free for each author, but backups would not be recognizable or upgradeable, and parallel sessions would keep reinventing them.
