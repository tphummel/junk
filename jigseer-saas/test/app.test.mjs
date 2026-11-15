import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/app.ts";
import { BASE, url } from "../src/url.ts";
import { brokenDb, createDb } from "./sqlite-d1.mjs";

test("/status is ok and not cacheable", async () => {
  const res = await app.request("/status", {}, { JIGSEER_DB: createDb() });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("/health reports a healthy database", async () => {
  const res = await app.request("/health", {}, { JIGSEER_DB: createDb() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.deepEqual(body.database, { healthy: true });
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("/health is a 500 when the database fails", async () => {
  const res = await app.request("/health", {}, { JIGSEER_DB: brokenDb() });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.status, "error");
  assert.deepEqual(body.database, { healthy: false });
});

test("url() adds the mount prefix and rejects relative paths", () => {
  assert.equal(BASE, "/jigseer");
  assert.equal(url("/"), "/jigseer/");
  assert.equal(url("/p/ABC234/play"), "/jigseer/p/ABC234/play");
  assert.throws(() => url("p/ABC234"));
});
