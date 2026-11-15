# junk

A place for things without a home: unfinished, out of date, broken things. Inspired by <https://github.com/jessfraz/junk>.

## Layout

| Path | What |
| --- | --- |
| `<project>/` | One experiment or tool per folder, each with its own `README.md`. Some have a workflow in `.github/workflows/`. |
| `web/` | Static webpages, served at `https://junk.tomhummel.com/<name>/`. |
| `api/` | The Worker behind `https://junk.tomhummel.com/api/<name>/`. |
| `adr/` | [Architecture decision records](https://adr.github.io/): short documents that record one decision, its context and consequences. |
| `skill/` | [Agent skills](https://agentskills.io/): instructions an AI agent loads for a specific task. `.claude/skills` links here so Claude Code loads them automatically. |
| `AGENTS.md` | Pointer for agents to this README, `skill/` and `adr/`. |

## Site and API

`web/` and `api/` deploy together as one Cloudflare Worker. Develop locally with:

```sh
npm ci && npm run types        # once per checkout; generates worker-configuration.d.ts
npm run dev                    # http://localhost:8787
npm run typecheck && npm test  # CI runs both on PRs
```

Pages that import ES modules need the dev server; they do not load from `file://`.

## Working here

- Work on a branch and open a PR; don't push to `main`.
- Commit only the files for your change; leave unrelated uncommitted files alone.
- Before changing anything, check [`skill/`](skill/) for a skill that matches the task and read the ADRs that apply. Don't edit an accepted ADR's decision; add a new ADR that supersedes it.
