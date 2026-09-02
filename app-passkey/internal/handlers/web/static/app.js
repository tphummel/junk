// Vanilla JS client for the passkey ceremonies. One shared file: each page
// only has the DOM elements its own section needs, so the setup functions
// below are no-ops on pages that don't have them.

function base64urlToBuffer(base64url) {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);
  return buffer.buffer;
}

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Converts the server's PublicKeyCredentialCreationOptions JSON (challenge
// and user.id as base64url strings) into the ArrayBuffer form
// navigator.credentials.create expects.
function decodeCreationOptions(options) {
  const publicKey = { ...options.publicKey };
  publicKey.challenge = base64urlToBuffer(publicKey.challenge);
  publicKey.user = { ...publicKey.user, id: base64urlToBuffer(publicKey.user.id) };
  if (publicKey.excludeCredentials) {
    publicKey.excludeCredentials = publicKey.excludeCredentials.map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    }));
  }
  return publicKey;
}

// Converts the server's PublicKeyCredentialRequestOptions JSON into the
// ArrayBuffer form navigator.credentials.get expects.
function decodeRequestOptions(options) {
  const publicKey = { ...options.publicKey };
  publicKey.challenge = base64urlToBuffer(publicKey.challenge);
  if (publicKey.allowCredentials) {
    publicKey.allowCredentials = publicKey.allowCredentials.map((c) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    }));
  }
  return publicKey;
}

// Converts a browser PublicKeyCredential (from create() or get()) into the
// JSON body the server expects.
function encodeCredential(credential) {
  const response = credential.response;
  const base = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
  };
  if (response.attestationObject) {
    base.response = {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      attestationObject: bufferToBase64url(response.attestationObject),
    };
  } else {
    base.response = {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      authenticatorData: bufferToBase64url(response.authenticatorData),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : undefined,
    };
  }
  return base;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res;
}

async function readError(res, fallback) {
  try {
    const data = await res.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

// --- Logout (present in the nav on every authenticated page) ---
document.getElementById("logout-btn")?.addEventListener("click", async () => {
  const res = await postJSON("/api/logout");
  const data = await res.json();
  window.location.href = data.redirect || "/";
});

// --- Signup page ---
(function setupSignup() {
  const signupBtn = document.getElementById("signup-btn");
  if (!signupBtn) return;

  const usernameInput = document.getElementById("username");
  const errorEl = document.getElementById("signup-error");
  const formEl = document.getElementById("signup-form");
  const codesSection = document.getElementById("recovery-codes");
  const codesList = document.getElementById("recovery-codes-list");
  const savedCheckbox = document.getElementById("codes-saved-checkbox");
  const confirmBtn = document.getElementById("confirm-btn");
  let confirmToken = null;

  savedCheckbox.addEventListener("change", () => {
    confirmBtn.disabled = !savedCheckbox.checked;
  });

  signupBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    const username = usernameInput.value.trim();
    if (!username) {
      showError(errorEl, "Enter a username.");
      return;
    }

    try {
      const beginRes = await postJSON("/api/signup/begin", { username });
      if (!beginRes.ok) {
        showError(errorEl, await readError(beginRes, "Could not start signup."));
        return;
      }
      const options = await beginRes.json();
      const publicKey = decodeCreationOptions(options);
      const credential = await navigator.credentials.create({ publicKey });

      const finishRes = await fetch("/api/signup/finish?nickname=" + encodeURIComponent(navigator.userAgent.slice(0, 60)), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeCredential(credential)),
      });
      if (!finishRes.ok) {
        showError(errorEl, await readError(finishRes, "Could not finish signup."));
        return;
      }
      const result = await finishRes.json();
      confirmToken = result.confirm_token;
      codesList.textContent = result.recovery_codes.join("\n");
      formEl.hidden = true;
      codesSection.hidden = false;
    } catch (err) {
      showError(errorEl, "Passkey creation was cancelled or failed: " + err.message);
    }
  });

  confirmBtn.addEventListener("click", async () => {
    const res = await postJSON("/api/signup/confirm", { confirm_token: confirmToken });
    if (!res.ok) {
      showError(errorEl, await readError(res, "Could not confirm signup."));
      return;
    }
    const data = await res.json();
    window.location.href = data.redirect || "/home";
  });
})();

// --- Login page ---
(function setupLogin() {
  const loginBtn = document.getElementById("login-btn");
  if (!loginBtn) return;

  const usernameInput = document.getElementById("username");
  const errorEl = document.getElementById("login-error");

  loginBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    const username = usernameInput.value.trim();
    if (!username) {
      showError(errorEl, "Enter a username.");
      return;
    }

    try {
      const beginRes = await postJSON("/api/login/begin", { username });
      if (!beginRes.ok) {
        showError(errorEl, await readError(beginRes, "Login failed."));
        return;
      }
      const options = await beginRes.json();
      const publicKey = decodeRequestOptions(options);
      const credential = await navigator.credentials.get({ publicKey });

      const res = await fetch("/api/login/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeCredential(credential)),
      });
      if (!res.ok) {
        showError(errorEl, await readError(res, "Login failed."));
        return;
      }
      const data = await res.json();
      window.location.href = data.redirect || "/home";
    } catch (err) {
      showError(errorEl, "Login was cancelled or failed: " + err.message);
    }
  });
})();

// --- Recovery page ---
(function setupRecovery() {
  const recoverBtn = document.getElementById("recover-btn");
  if (!recoverBtn) return;

  const codeInput = document.getElementById("code");
  const nicknameInput = document.getElementById("nickname");
  const errorEl = document.getElementById("recovery-error");

  recoverBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    const code = codeInput.value.trim();
    if (!code) {
      showError(errorEl, "Enter a recovery code.");
      return;
    }

    try {
      const beginRes = await postJSON("/api/recovery/begin", { code, nickname: nicknameInput.value.trim() });
      if (!beginRes.ok) {
        showError(errorEl, await readError(beginRes, "Recovery failed."));
        return;
      }
      const options = await beginRes.json();
      const publicKey = decodeCreationOptions(options);
      const credential = await navigator.credentials.create({ publicKey });

      const res = await fetch("/api/recovery/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeCredential(credential)),
      });
      if (!res.ok) {
        showError(errorEl, await readError(res, "Recovery failed."));
        return;
      }
      const data = await res.json();
      window.location.href = data.redirect || "/home";
    } catch (err) {
      showError(errorEl, "Recovery was cancelled or failed: " + err.message);
    }
  });
})();

// --- Keys (security dashboard) page ---
(function setupKeys() {
  const table = document.getElementById("keys-table");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  const addBtn = document.getElementById("add-key-btn");
  const nicknameInput = document.getElementById("new-key-nickname");
  const errorEl = document.getElementById("keys-error");

  async function loadKeys() {
    const res = await fetch("/api/keys");
    if (!res.ok) {
      showError(errorEl, "Could not load keys.");
      return;
    }
    const keys = await res.json();
    tbody.innerHTML = "";
    for (const key of keys) {
      const row = document.createElement("tr");

      const nicknameCell = document.createElement("td");
      const nicknameField = document.createElement("input");
      nicknameField.type = "text";
      nicknameField.value = key.nickname;
      nicknameField.addEventListener("change", async () => {
        await fetch(`/api/keys/${key.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: nicknameField.value }),
        });
      });
      nicknameCell.appendChild(nicknameField);

      const createdCell = document.createElement("td");
      createdCell.textContent = key.created_at;

      const lastUsedCell = document.createElement("td");
      lastUsedCell.textContent = key.last_used_at || "never";

      const actionCell = document.createElement("td");
      const revokeBtn = document.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.textContent = "Revoke";
      revokeBtn.addEventListener("click", async () => {
        await fetch(`/api/keys/${key.id}`, { method: "DELETE" });
        loadKeys();
      });
      actionCell.appendChild(revokeBtn);

      row.append(nicknameCell, createdCell, lastUsedCell, actionCell);
      tbody.appendChild(row);
    }
  }

  addBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    try {
      const beginRes = await postJSON("/api/keys/begin", { nickname: nicknameInput.value.trim() });
      if (!beginRes.ok) {
        showError(errorEl, await readError(beginRes, "Could not start add-key ceremony."));
        return;
      }
      const options = await beginRes.json();
      const publicKey = decodeCreationOptions(options);
      const credential = await navigator.credentials.create({ publicKey });

      const res = await fetch("/api/keys/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(encodeCredential(credential)),
      });
      if (!res.ok) {
        showError(errorEl, await readError(res, "Could not add key."));
        return;
      }
      nicknameInput.value = "";
      loadKeys();
    } catch (err) {
      showError(errorEl, "Adding a key was cancelled or failed: " + err.message);
    }
  });

  loadKeys();
})();
