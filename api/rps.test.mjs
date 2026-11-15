import assert from "node:assert/strict";
import test from "node:test";
import app from "./rps.ts";

const realNow = Date.now;

test("maps timestamp modulo 3 to rock/paper/scissors", async (t) => {
  t.after(() => {
    Date.now = realNow;
  });
  const cases = [
    [3000, "rock"],
    [3001, "paper"],
    [3002, "scissors"],
  ];
  for (const [ms, expected] of cases) {
    Date.now = () => ms;
    const res = await app.request("/");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { throw: expected });
  }
});

test("echoes cf-ray as X-Request-Id and is not cacheable", async () => {
  const res = await app.request("/", { headers: { "cf-ray": "abc123-SEA" } });
  assert.equal(res.headers.get("x-request-id"), "abc123-SEA");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("no X-Request-Id header without cf-ray", async () => {
  const res = await app.request("/");
  assert.equal(res.headers.get("x-request-id"), null);
});
