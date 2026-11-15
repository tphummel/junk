# junk

A place for things without a home: unfinished, out of date, broken things. Inspired by <https://github.com/jessfraz/junk>.

## Layout

| Path | What |
| --- | --- |
| `<project>/` | One experiment or tool per folder, each with its own `README.md`. Some have a workflow in `.github/workflows/`. |
| `web/` | Static webpages, served at `https://junk.tomhummel.com/<name>/`. |
| `api/` | The Worker behind `https://junk.tomhummel.com/api/<name>/`. |
| `adr/` | [Architecture decision records](https://adr.github.io/): short documents that record one decision, its context and consequences. |
| `skill/` | [Agent skills](https://agentskills.io/): instructions an AI agent loads for a specific task. |
| `AGENTS.md` | Instructions for agents (and people) working here. |

## Site and API

`web/` and `api/` deploy together as one Cloudflare Worker. Develop locally with:

```sh
npm install && npm run types   # once; generates worker-configuration.d.ts
npm run dev                    # http://localhost:8787
npm run typecheck && npm test  # CI runs both on PRs
```

Pages that import ES modules need the dev server; they do not load from `file://`.

For how to add or change things, see [AGENTS.md](AGENTS.md).
