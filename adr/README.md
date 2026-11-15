# Architecture decision records

How the site (`web/`) and API (`api/`) are built. Read these before changing either; they exist so parallel sessions make the same choices.

| # | Decision |
| --- | --- |
| [0001](0001-web-styling.md) | Each experiment gets its own random-seed palette, in light and dark mode, with contrast checked per mode |
| [0002](0002-no-web-build-step.md) | No build step for `web/`; what is committed is what is served |
| [0003](0003-web-experiments.md) | How a static experiment is structured, linked and migrated |
| [0004](0004-api-experiments.md) | How an API experiment is structured, validated, tested and given state |

## Adding one

1. Take the next number and write `NNNN-short-name.md` with Status, Date, Context, Decision, Consequences and Alternatives considered.
2. Status is `Proposed`, `Accepted` or `Superseded by NNNN`.
3. Don't change an accepted decision: write a new ADR that supersedes it, and update the old one's status.
4. Add it to the table above.
