// Shared helpers + passkey ceremonies. Plain JS, no build step.
const csrf = document.body.dataset.csrf || "";

function b64uToBuf(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}
function bufToB64u(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeOpts(o) {
  const pk = { ...o.publicKey };
  pk.challenge = b64uToBuf(pk.challenge);
  if (pk.user) pk.user = { ...pk.user, id: b64uToBuf(pk.user.id) };
  for (const k of ["excludeCredentials", "allowCredentials"])
    if (pk[k]) pk[k] = pk[k].map((c) => ({ ...c, id: b64uToBuf(c.id) }));
  return pk;
}
function encodeCred(c) {
  const r = c.response;
  const out = { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults() };
  if (r.attestationObject) {
    out.response = { clientDataJSON: bufToB64u(r.clientDataJSON), attestationObject: bufToB64u(r.attestationObject) };
    if (r.getTransports) out.response.transports = r.getTransports();
  } else {
    out.response = {
      clientDataJSON: bufToB64u(r.clientDataJSON),
      authenticatorData: bufToB64u(r.authenticatorData),
      signature: bufToB64u(r.signature),
      userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined,
    };
  }
  return out;
}
async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function ceremony(formId, base, mode) {
  const form = document.getElementById(formId);
  if (!form) return;
  const msg = document.getElementById("msg");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    if (!window.PublicKeyCredential) {
      msg.textContent = "This browser does not support passkeys (HTTPS or localhost required).";
      return;
    }
    const f = new FormData(form);
    try {
      const opts = await post(base + "/begin", { username: f.get("username") || "", name: f.get("name") || "" });
      const cred = await (mode === "get"
        ? navigator.credentials.get({ publicKey: decodeOpts(opts) })
        : navigator.credentials.create({ publicKey: decodeOpts(opts) }));
      const res = await post(base + "/finish", encodeCred(cred));
      location.href = res.redirect || location.pathname;
    } catch (err) {
      msg.textContent = err.message || String(err);
    }
  });
}
ceremony("login-form", "/login", "get");
ceremony("register-form", "/register", "create");
ceremony("addkey-form", "/passkeys", "create");

// <form data-confirm="..."> asks before submitting (CSP forbids inline handlers).
document.querySelectorAll("form[data-confirm]").forEach((f) =>
  f.addEventListener("submit", (e) => {
    if (!confirm(f.dataset.confirm)) e.preventDefault();
  })
);
