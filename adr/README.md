# Architecture decision records

How the site (`web/`), API (`api/`) and Docker image projects are built and shipped. Read these before changing them; they exist so parallel sessions make the same choices.

| # | Decision |
| --- | --- |
| [0001](0001-web-styling.md) | Each webpage gets its own random-seed palette, in light and dark mode, with contrast checked per mode |
| [0002](0002-no-web-build-step.md) | No build step for `web/`; what is committed is what is served |
| [0003](0003-webpages.md) | How a static webpage is structured, linked and migrated |
| [0004](0004-apis.md) | How an API is structured, validated, tested and given state |
| [0005](0005-web-api-deployment.md) | `web/` and `api/` deploy as one Worker through Workers Builds; previews per branch; config in `wrangler.jsonc` |
| [0006](0006-docker-image-projects.md) | Docker image projects: one folder and workflow each, tested then built, tagged by metadata-action, pushed to GHCR; no deploy from the repo |

## Adding one

1. Take the next number and write `NNNN-short-name.md` with Status, Date, Context, Decision, Consequences and Alternatives considered.
2. Status is `Proposed`, `Accepted` or `Superseded by NNNN`.
3. Don't change an accepted decision: write a new ADR that supersedes it, and update the old one's status.
4. Add it to the table above.
