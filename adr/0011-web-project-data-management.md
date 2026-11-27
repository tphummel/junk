# 0011: Web project data lives in the browser, with export, import and a weekly backup reminder

- Status: Proposed
- Date: 2026-11-25

## Context

Some `web/` pages keep data the user cares about: logs, scores, trackers, notes. With no backend ([ADR 0003](0003-webpages.md), [ADR 0002](0002-no-web-build-step.md)) that data sits in `localStorage` or IndexedDB on one device. Browsers can clear it (storage pressure, "clear site data", Safari's idle eviction for sites not added to the home screen), and it does not move to a new phone or browser. Each `*.junk.tomhummel.com` preview branch is also its own origin, so data there is separate from production. Today each page decides for itself how, or whether, to get data out, and nothing reminds the user to do it.

Where a record was made can also matter (a trail check, a trip, a game night), but location is personal data and many pages have no use for it.

Pages that call an API ([ADR 0004](0004-apis.md)) and keep their state there are out of scope; this covers data that lives in the browser.

## Decision

Any webpage that stores user data in the browser follows this. Pages that store nothing, or only disposable UI state such as a remembered tab, are exempt.

1. **Storage.** Use IndexedDB for logs and anything over a few hundred KB, and `localStorage` for small settings. Keys and database names are prefixed with the page name (`<name>:`), because pages share an origin. Call `navigator.storage.persist()` once the page holds real data, and ignore a refusal. Every storage call is wrapped so the page still loads when storage is blocked.
2. **One export format.** The page exports a single JSON file, `<name>-backup-YYYY-MM-DD.json`:
   ```json
   {
     "app": "<name>",
     "schema": 1,
     "exportedAt": "2026-11-25T14:03:11.250Z",
     "settings": {},
     "players": [],
     "sessions": []
   }
   ```
   - `app`, `schema`, `exportedAt` and `settings` are fixed. The page's own data sits beside them under top-level keys it documents (a list of records, or related lists such as `players` and `sessions`).
   - `schema` is an integer the page bumps when the shape changes. Pages keep a function that upgrades older schemas, so old backups always import.
   - `exportedAt` and `lastBackupAt` are ISO 8601 UTC strings; record times follow item 5. No page-specific binary formats.
   - Export is a button that builds a `Blob` and downloads it via an `<a download>`. Where `navigator.share` accepts files (phones), offer that too so the file can go to Files or cloud storage.
   - A page may also offer a CSV export of records for use in a spreadsheet. JSON stays the backup of record.
3. **Import** is a file picker (and drop target) that reads JSON locally.
   - Reject files whose `app` does not match, or whose `schema` is newer than the page knows, with a plain message. Validate before writing anything; a bad file changes nothing.
   - Ask whether to **merge** or **replace**. Merge is the default and is safe to repeat: records are keyed by `id`, so importing the same file twice adds nothing. Where records can be edited after saving, they carry `updatedAt` and merge keeps the later copy. Replace says what it will delete and offers to export the current data first.
   - Nothing is uploaded; import and export are entirely client side.
4. **Weekly backup reminder.**
   - The page stores `<name>:lastBackupAt` (ISO timestamp), set only when an export completes (the download was started, or the share sheet reported success). It is also set on import with replace, since the data now matches a file the user holds.
   - Whenever the page holds data and `lastBackupAt` is missing or more than **7 days** old, it shows a non-blocking banner on load: "Last backup: 9 days ago (or never). Export now." The banner has an Export button and a "Remind me tomorrow" dismissal, stored as `<name>:remindAfter`. It comes back after that time, not on the next reload.
   - The page always shows the last backup time (absolute and relative) next to the export button, so the user can see it without waiting for a reminder.
   - There are no push notifications, background sync or periodic tasks: the pages have no backend and a reminder only needs to reach someone who opens the page. A page used less often than weekly shows the reminder when next opened.
   - Exporting only part of the data (one session, a CSV, a report) does not set `lastBackupAt`; only the full backup file does.
   - Reminder state is device-local and is not part of the export. Importing a backup does not carry another device's `lastBackupAt`.
5. **Records have an identity and a time.**
   - Every saved record (a game, a log entry) has a unique `id`, so merges are idempotent, and a time in epoch milliseconds for when it happened.
   - A record also stores `offset`, the UTC offset in minutes (east positive) where the user was at that moment, so the local calendar day can be recomputed correctly after travel.
   - A record that can be edited after saving gets `updatedAt` (epoch milliseconds) when it changes.
   - Whether a page keeps an append-only event log or a snapshot of nested records is the page's choice. This ADR does not require raw events.
   - Imports drop malformed records and normalize the rest.
6. **Location is opt-in through the browser's permission prompt.**
   - A page records location only if knowing where a record was made is part of what the page is for. Decide that when writing the page, and say so in its page text. Most pages should not.
   - **The opt-in is the browser's own prompt, not a setting in the page.** The page looks up location when the record is created by a user action (starting a game, logging an entry), never on load. It skips the lookup if `navigator.permissions` reports `denied`; otherwise it calls `navigator.geolocation.getCurrentPosition`, which shows the prompt the first time. A refusal ends it quietly, and the user changes their mind in the browser's or device's site settings. The page has no toggle.
   - `lat` and `lon` are decimal degrees rounded to 6 places and `acc` is the reported accuracy in whole meters. A page that does not need that precision may round coarser.
   - **Fields are omitted when location is not available** (denied, unsupported, out of range, timed out). A good `lat` and `lon` with no usable accuracy keeps only those two. Pages that already store `null` (`toothup`) may keep doing so.
   - Location is captured at the moment of the record, so a record never gets a position from later. The lookup uses a short timeout, runs in the background and never blocks recording.
   - Location is stored locally and leaves the device only in an export file the user chose to save. It is never sent to an API, analytics service or third-party map or geocoding service. A page that wants a map or address lookup must say so and link a plain URL the user opens, rather than sending coordinates itself.
   - The export includes the location fields. Reporting or displaying location is not required.
7. **Backup files are the user's.** Pages never send them anywhere, and nothing in the repo stores real backups. Fixtures for tests use made-up data.
8. **Pages that predate this ADR** are exempt until next modified, as in [ADR 0001](0001-web-styling.md) and [ADR 0008](0008-pwa-for-all-offline-for-self-contained.md), and then add what is missing. Migrated pages (ADR 0003) are treated the same.
9. **Shared code.** Each page carries its own copy of the export, import and reminder code, in line with ADR 0003. A page that wants to share it follows the rules for shared files in ADR 0003 rather than inventing a loader or build step.

## Consequences

- A user can move a page's data between devices, recover from cleared site data, and keep their own copy, with no server.
- Backups depend on the user acting. The reminder makes a missed backup visible but does not make it happen, and a user who ignores it can still lose data.
- `lastBackupAt` records that an export was started, not that the file was kept or can be restored. Download dialogs and share sheets cannot confirm that.
- Merge by `id` only deduplicates records, and keeps the later edit of a record that exists on both sides. Settings from a merge take the imported value only if the user chooses, so a page must say which wins.
- Location data is sensitive. Asking through the browser prompt, rounding it, omitting it when unavailable and keeping it on the device limits the exposure, but anyone holding an export file has the coordinates. A user who dismisses the prompt without choosing is asked again on the next record; one who denies it is not asked again.
- Rejecting newer schemas means an old deploy cannot read a backup from a newer one. Rolling a page back needs a downgrade or a fresh start.
- Each preview origin has separate data, so testing import and export on a preview does not touch production data.
- Nothing in CI checks any of this.

## Alternatives considered

- **Server-side storage through an API with KV or D1 ([ADR 0004](0004-apis.md)).** Gives real durability and sync, but needs accounts or a shared secret, and turns small offline-capable pages into network-bound ones, which conflicts with ADR 0008. Still the right choice for a page whose data must be shared between people.
- **Cloud sync through a third-party service (Dropbox, Google Drive, iCloud).** Automatic, but adds OAuth, an external dependency and a privacy trade-off to every page.
- **File System Access API for auto-saving to a chosen file.** Fits the problem, but it is Chromium desktop only, so it cannot be the baseline. A page may add it as an extra.
- **Push or scheduled notifications for the reminder.** Needs a backend or a service worker with permissions, and ADR 0008 only gives service workers to some pages. An in-page banner covers the case at no cost.
- **An in-page "record location" setting.** A second consent on top of the browser's own prompt, plus extra UI and state on every page. The browser prompt already is the consent, and the user can revoke it in site settings.
- **Recording location without asking.** Not possible, since the browser requires a prompt, and most pages have no use for it anyway, so each page decides.
- **Per-page export formats.** Free for each author, but backups would not be recognizable or upgradeable, and parallel sessions would keep reinventing them.
