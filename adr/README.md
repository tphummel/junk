# Architecture decision records

How the site (`web/`), API (`api/`) and Docker image projects are built and shipped. Read these before changing them; they exist so parallel sessions make the same choices.

| # | Decision |
| --- | --- |
| [0001](0001-web-styling.md) | Each webpage gets its own random-seed palette, in light and dark mode, with contrast checked per mode |
| [0002](0002-no-web-build-step.md) | No build step for `web/`; what is committed is what is served |
| [0003](0003-webpages.md) | How a static webpage is structured, linked and migrated |
| [0004](0004-apis.md) | How an API is structured, validated, tested and given state |
| [0005](0005-cloudflare-workers-deployment.md) | `web/` and `api/` deploy to Cloudflare as one Worker through Workers Builds; previews per branch; config in `wrangler.jsonc` |
| [0006](0006-docker-image-projects.md) | Docker image projects: one folder and workflow each, tested then built, tagged by metadata-action, pushed to GHCR; no deploy from the repo |
| [0007](0007-web-icons-and-offline.md) | Every webpage ships icons, a manifest and a service worker (own files only, network first), so it installs and works offline |
| [0008](0008-worker-storage.md) | _Proposed._ Worker projects store data in D1 (default), Durable Objects, KV or R2 with dedicated project-prefixed bindings, preview twins, migrations run by the deploy command, and account-wide limits rules |
| [0009](0009-server-rendered-apps.md) | _Proposed._ Server-rendered apps are Hono apps (`html` templates) in a project folder, mounted at `/<name>` on the junk Worker, with static files in `web/<name>/static/` |

## Adding one

1. Take the next number and write `NNNN-short-name.md` with Status, Date, Context, Decision, Consequences and Alternatives considered.
2. Status is `Proposed`, `Accepted` or `Superseded by NNNN`.
3. Don't change an accepted decision: write a new ADR that supersedes it, and update the old one's status.
4. Add it to the table above.
