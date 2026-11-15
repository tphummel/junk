---
name: new-api
description: Add a JSON API route to the junk repo's Hono Worker (api/, served at junk.tomhummel.com/api/<name>/), with tests. Use when asked to create an API, endpoint, or Worker route, or to give a webpage a backend, including APIs that need KV, D1, R2, or Durable Objects.
metadata:
  version: "1.0.0"
---

# New API

Rules are in [ADR 0004](../../adr/0004-apis.md); [0002](../../adr/0002-no-web-build-step.md) covers shared code. This is the procedure.

## Steps

1. **Branch** from an up-to-date `main`. In a fresh checkout, do the one-time setup in the [README](../../README.md#site-and-api). `<name>` is lowercase kebab-case, the same as the paired `web/<name>/` if there is one.
2. **Create `api/<name>.ts`:**
   ```ts
   import { Hono } from "hono";
   // import { cors } from "hono/cors";   // only if other origins' browsers should call it

   const app = new Hono();

   // GET /api/<name>/:value
   app.get("/:value", (c) => {
     const value = c.req.param("value");
     if (!/^[a-z]+$/.test(value)) {
       return c.json({ error: "value must be lowercase letters, e.g. /api/<name>/abc" }, 400);
     }
     return c.json({ value });
   });

   export default app;
   ```
   Routes are relative to the mount point.
3. **Register it** in `api/index.ts`: one import and one `app.route("/api/<name>", sub)` line, each in alphabetical order.
4. **Write `api/<name>.test.mjs`** with `node:test` and `app.request()`; no network:
   ```js
   import assert from "node:assert/strict";
   import test from "node:test";
   import app from "./<name>.ts";

   test("happy path", async () => {
     const res = await app.request("/abc");
     assert.equal(res.status, 200);
     assert.deepEqual(await res.json(), { value: "abc" });
   });

   test("bad input is a 400 with an error message", async () => {
     const res = await app.request("/ABC");
     assert.equal(res.status, 400);
     assert.ok((await res.json()).error);
   });
   ```
   Cover the happy path, every validation error, and any header the API promises. Test the sub-app directly (not through `api/index.ts`), so paths start at `/`.
5. **Run the checks** from the repo root: `npm run types && npm run typecheck && npm test`.
6. **Try it:** `npm run dev`, then `curl -s localhost:8787/api/<name>/abc`.
7. **PR.** Check the preview at `https://<branch>.junk.tomhummel.com/api/<name>/...`.

## Conventions

- **Errors:** 400 with `{ "error": "<what to use instead>" }`. Never return stack traces. Unknown paths already get the global JSON 404.
- **Methods:** `GET` for read-only calls.
- **Caching:** add `Cache-Control: public, max-age=...` only when the response is deterministic for the URL.
- **CORS:** off unless wanted; then `app.use("*", cors())`.
- **Auth:** none. Every route is public, including ones that write. Anything needing protection needs its own ADR first.
- **Shared logic with a page:** a plain `.js` ES module in `web/<name>/` with JSDoc types, imported as `../web/<name>/x.js`. Wrangler bundles it for the Worker; the page loads it as-is. Add `web/<name>/x.js` to `include` in `tsconfig.json` so `checkJs` covers it.

## Needs storage or secrets

Storage is **not yet decided** (ADR 0004, Open). Before the first stateful API, stop and propose a new ADR covering which services, shared versus per-API resources, and preview isolation. Then, per binding:

1. Add the binding to `wrangler.jsonc` **and** a matching entry under `previews` pointing at test resources, never production ones. Previews do not inherit production bindings or vars.
2. Run `npm run types`; type the app as `new Hono<{ Bindings: Env }>()`.
3. In tests, pass a stub env as the third argument: `app.request(path, init, { MY_KV: fakeKv })`.
4. D1: add `migrations/` and decide how they are applied (Workers Builds runs only `wrangler deploy`); add `migrations/` to the dashboard watch paths. Durable Objects: the class must be exported from `api/index.ts`, with a `migrations` block in `wrangler.jsonc`.
5. Secrets: never committed. `wrangler secret put` for production, `.dev.vars` (gitignored) locally.
6. The namespace or database must exist before the first deploy. Create it by hand and note the steps in the PR.
7. Two bindings edits in `wrangler.jsonc` can conflict between sessions; keep both.

## Do not

- Add a second Worker or a `wrangler.jsonc` per API.
- Put tests or notes in `web/`, or a project folder or `notes.md` for this work.
- Edit an accepted ADR to change a rule; supersede it.
