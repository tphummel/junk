import assert from "node:assert/strict";
import test from "node:test";
import app from "./rps-bot.ts";

test("returns a valid throw and a timestamp", async () => {
  const res = await app.request("/calvin");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(["rock", "paper", "scissors"].includes(body.throw));
  assert.equal(typeof body.timestamp, "number");
  assert.equal(body.id, null);
});

test("echoes cf-ray as X-Request-Id and is not cacheable", async () => {
  const res = await app.request("/calvin", { headers: { "cf-ray": "abc123-SEA" } });
  assert.equal(res.headers.get("x-request-id"), "abc123-SEA");
  assert.equal((await res.json()).id, "abc123-SEA");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("no X-Request-Id header without cf-ray", async () => {
  const res = await app.request("/calvin");
  assert.equal(res.headers.get("x-request-id"), null);
});

test("unknown path under the sub-app is a 404", async () => {
  const res = await app.request("/");
  assert.equal(res.status, 404);
});

test("responds with application/json", async () => {
  const res = await app.request("/calvin");
  assert.match(res.headers.get("content-type"), /^application\/json/);
});
