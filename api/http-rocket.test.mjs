// Tests for the pure logic of web/http-rocket/model.js (config sanitizing, import/export, variables,
// request building). The UI and storage are browser-only and not covered here. Run with `npm test`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequest, deleteFolder, duplicateRequest, exportConfig, interpolate, mergeConfig, newFolder, newRequest,
  parseImport, pushAudit, redactHeaders, sanitizeConfig, truncate, variablesOf,
} from "../web/http-rocket/model.js";

const sample = () => {
  const folder = newFolder("Users API");
  folder.variables.push({ key: "baseUrl", value: "https://api.test", enabled: true }, { key: "off", value: "x", enabled: false });
  const req = newRequest(folder.id);
  req.name = "List";
  req.url = "{{baseUrl}}/users";
  return { folders: [folder], requests: [req] };
};

test("interpolate: replaces known variables, reports and keeps unknown ones", () => {
  assert.deepEqual(interpolate("{{a}}/{{ b }}/{{c}}", { a: "1", b: "2" }), { text: "1/2/{{c}}", missing: ["c"] });
  assert.deepEqual(interpolate("no vars", {}), { text: "no vars", missing: [] });
  assert.equal(interpolate("{{toString}}", {}).missing[0], "toString"); // not inherited from Object.prototype
});

test("variablesOf: only enabled, named variables", () => {
  assert.deepEqual(variablesOf(sample().folders[0]), { baseUrl: "https://api.test" });
  assert.deepEqual(variablesOf(undefined), {});
});

test("buildRequest: variables, params, existing query and hash", () => {
  const { requests, folders } = sample();
  const r = requests[0];
  r.url = "{{baseUrl}}/users?x=1#top";
  r.params = [{ key: "q", value: "a b&c", enabled: true }, { key: "skip", value: "1", enabled: false }, { key: "", value: "1", enabled: true }];
  const b = buildRequest(r, variablesOf(folders[0]));
  assert.equal(b.url, "https://api.test/users?x=1&q=a%20b%26c#top");
  assert.deepEqual(b.missing, []);
});

test("buildRequest: auth headers, content-type and no body on GET", () => {
  const r = newRequest();
  r.url = "https://x.test";
  r.method = "POST";
  r.auth = { type: "basic", username: "user", password: "päss", token: "" };
  r.body = { type: "json", text: '{"a":1}' };
  const b = buildRequest(r, {});
  assert.equal(b.body, '{"a":1}');
  assert.deepEqual(b.headers.find(([k]) => k === "Content-Type"), ["Content-Type", "application/json"]);
  const basic = b.headers.find(([k]) => k === "Authorization")[1];
  assert.equal(Buffer.from(basic.replace("Basic ", ""), "base64").toString("utf8"), "user:päss");

  r.method = "GET";
  assert.equal(buildRequest(r, {}).body, undefined);
});

test("buildRequest: explicit Authorization and Content-Type headers win; bearer; missing variables", () => {
  const r = newRequest();
  r.url = "{{host}}/a";
  r.method = "PUT";
  r.headers = [{ key: "authorization", value: "Token abc", enabled: true }, { key: "content-type", value: "text/csv", enabled: true }];
  r.auth = { type: "bearer", username: "", password: "", token: "zzz" };
  r.body = { type: "text", text: "a,b" };
  const b = buildRequest(r, {});
  assert.equal(b.headers.filter(([k]) => k.toLowerCase() === "authorization").length, 1);
  assert.equal(b.headers.filter(([k]) => k.toLowerCase() === "content-type").length, 1);
  assert.deepEqual(b.missing, ["host"]);

  r.headers = [];
  assert.deepEqual(buildRequest(r, { host: "h" }).headers.find(([k]) => k === "Authorization"), ["Authorization", "Bearer zzz"]);
});

test("export then import round-trips", () => {
  const config = sample();
  const doc = exportConfig(config, new Date("2026-01-02T03:04:05Z"));
  assert.equal(doc.format, "http-rocket");
  assert.equal(doc.exportedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(parseImport(JSON.stringify(doc)), config);
});

test("parseImport: readable errors", () => {
  assert.throws(() => parseImport("{nope"), /not valid JSON/);
  assert.throws(() => parseImport("[]"), /Not an HTTP Rocket config/);
  assert.throws(() => parseImport('{"format":"postman","folders":[],"requests":[]}'), /Unknown format/);
  assert.throws(() => parseImport('{"version":99,"folders":[],"requests":[]}'), /newer/);
});

test("sanitizeConfig: coerces bad fields, drops junk, fixes orphans and duplicate ids", () => {
  const c = sanitizeConfig({
    folders: [{ id: "f", name: "" }, { id: "f", name: "dup" }, null],
    requests: [
      { id: "r", folderId: "missing", method: "bogus", url: 5, params: [{ key: 1 }, "x"], auth: { type: "evil" }, body: { type: "json", text: "{}" }, extra: 1 },
      { id: "r", method: "post", folderId: "f" },
    ],
  });
  assert.equal(c.folders.length, 2);
  assert.equal(c.folders[0].name, "Folder");
  assert.notEqual(c.folders[0].id, c.folders[1].id);
  assert.deepEqual([c.requests[0].folderId, c.requests[0].method, c.requests[0].url, c.requests[0].auth.type], [null, "GET", "", "none"]);
  assert.deepEqual(c.requests[0].params, [{ key: "", value: "", enabled: true }]);
  assert.equal("extra" in c.requests[0], false);
  assert.equal(c.requests[1].method, "POST");
  assert.notEqual(c.requests[0].id, c.requests[1].id);
  assert.equal(c.requests[1].folderId, c.folders[0].id);
});

test("mergeConfig: fresh ids, folder links preserved, current config untouched", () => {
  const current = sample();
  const incoming = sample();
  const merged = mergeConfig(current, incoming);
  assert.equal(merged.folders.length, 2);
  assert.equal(merged.requests.length, 2);
  const [, f2] = merged.folders;
  assert.notEqual(f2.id, incoming.folders[0].id);
  assert.equal(merged.requests[1].folderId, f2.id);
  assert.equal(new Set([...merged.folders, ...merged.requests].map((x) => x.id)).size, 4);
  assert.equal(current.folders.length, 1);
});

test("deleteFolder: removes its requests, or moves them to the top level", () => {
  const c = sample();
  assert.deepEqual(deleteFolder(c, c.folders[0].id), { folders: [], requests: [] });
  const kept = deleteFolder(c, c.folders[0].id, true);
  assert.equal(kept.requests.length, 1);
  assert.equal(kept.requests[0].folderId, null);
});

test("duplicateRequest: deep copy with new id", () => {
  const r = sample().requests[0];
  const d = duplicateRequest(r);
  d.params.push({ key: "a", value: "b", enabled: true });
  assert.notEqual(d.id, r.id);
  assert.equal(d.name, "List copy");
  assert.equal(r.params.length, 0);
});

test("audit helpers: cap, redaction, truncation", () => {
  assert.deepEqual(pushAudit([1, 2, 3], 0, 3), [0, 1, 2]);
  assert.deepEqual(
    redactHeaders([["Authorization", "Bearer s"], ["Cookie", "a=b"], ["Accept", "*/*"]]),
    [["Authorization", "[redacted]"], ["Cookie", "[redacted]"], ["Accept", "*/*"]],
  );
  assert.equal(truncate("abc", 5), "abc");
  assert.match(truncate("abcdef", 3), /^abc\n… \[3 more/);
});
