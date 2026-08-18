// Trail Check frontend: passkey ceremonies and the Leaflet dashboard map.
// No client-side framework beyond Turbo (loaded from the layout) -- WebAuthn
// ceremonies use the browser's native PublicKeyCredential.parseCreationOptionsFromJSON
// / parseRequestOptionsFromJSON / toJSON() helpers, so no third-party
// encoding library is needed either.
(function () {
  'use strict';

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error || ('request failed: ' + res.status));
    }
    return res.json();
  }

  async function register({ label, token, statusEl }) {
    setStatus(statusEl, 'Requesting registration options...');
    try {
      const options = await postJSON('/auth/register/begin', { label: label, token: token });
      const creationOptions = PublicKeyCredential.parseCreationOptionsFromJSON(options.publicKey || options);

      setStatus(statusEl, 'Follow your browser/device prompt...');
      const credential = await navigator.credentials.create({ publicKey: creationOptions });

      setStatus(statusEl, 'Verifying...');
      const result = await postJSON('/auth/register/finish', credential.toJSON());
      setStatus(statusEl, 'Success! Redirecting...');
      window.location.href = result.redirect || '/dashboard';
    } catch (err) {
      setStatus(statusEl, 'Registration failed: ' + err.message);
    }
  }

  async function login({ statusEl }) {
    setStatus(statusEl, 'Requesting login options...');
    try {
      const options = await postJSON('/auth/login/begin', {});
      const requestOptions = PublicKeyCredential.parseRequestOptionsFromJSON(options.publicKey || options);

      setStatus(statusEl, 'Follow your browser/device prompt...');
      const credential = await navigator.credentials.get({ publicKey: requestOptions });

      setStatus(statusEl, 'Verifying...');
      const result = await postJSON('/auth/login/finish', credential.toJSON());
      setStatus(statusEl, 'Success! Redirecting...');
      window.location.href = result.redirect || '/dashboard';
    } catch (err) {
      setStatus(statusEl, 'Login failed: ' + err.message);
    }
  }

  function setStatus(el, text) {
    if (el) el.textContent = text;
  }

  function wirePasskeyPage() {
    const addButton = document.getElementById('add-passkey-button');
    if (addButton && !addButton.dataset.wired) {
      addButton.dataset.wired = '1';
      addButton.addEventListener('click', async function () {
        const statusEl = document.getElementById('add-passkey-status');
        const label = document.getElementById('new-passkey-label').value;
        setStatus(statusEl, 'Requesting options...');
        try {
          const options = await postJSON('/me/passkeys/begin', { label: label });
          const creationOptions = PublicKeyCredential.parseCreationOptionsFromJSON(options.publicKey || options);
          setStatus(statusEl, 'Follow your browser/device prompt...');
          const credential = await navigator.credentials.create({ publicKey: creationOptions });
          setStatus(statusEl, 'Verifying...');
          const res = await fetch('/me/passkeys/finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(credential.toJSON()),
          });
          if (!res.ok) throw new Error('server rejected the new passkey');
          const html = await res.text();
          document.getElementById('passkey-list').outerHTML = html;
          wirePasskeyPage();
        } catch (err) {
          setStatus(statusEl, 'Could not add passkey: ' + err.message);
        }
      });
    }

    document.querySelectorAll('[data-role="toggle-status"]').forEach(function (btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async function () {
        const id = btn.dataset.passkeyId;
        const nextStatus = btn.dataset.nextStatus;
        const res = await fetch('/me/passkeys/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          alert(detail.error || 'could not update passkey');
          return;
        }
        document.getElementById('passkey-list').outerHTML = await res.text();
        wirePasskeyPage();
      });
    });

    document.querySelectorAll('[data-role="delete-passkey"]').forEach(function (btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async function () {
        if (!confirm('Delete this passkey?')) return;
        const id = btn.dataset.passkeyId;
        const res = await fetch('/me/passkeys/' + id, { method: 'DELETE', credentials: 'same-origin' });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          alert(detail.error || 'could not delete passkey');
          return;
        }
        document.getElementById('passkey-list').outerHTML = await res.text();
        wirePasskeyPage();
      });
    });
  }

  function initDashboardMap(userTrailId) {
    const el = document.getElementById('map');
    if (!el || typeof L === 'undefined') return;

    const map = L.map(el).setView([37.0, -119.4], 6);
    L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    fetch('/dashboard/geo?user_trail_id=' + encodeURIComponent(userTrailId), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        const layers = [];
        if (d.covered_geojson) {
          layers.push(L.geoJSON(JSON.parse(d.covered_geojson), { style: { color: '#ff8800', weight: 4 } }).addTo(map));
        }
        if (d.uncovered_geojson) {
          layers.push(L.geoJSON(JSON.parse(d.uncovered_geojson), { style: { color: '#0066ff', weight: 4, dashArray: '6,6' } }).addTo(map));
        }
        if (layers.length > 0) {
          const group = L.featureGroup(layers);
          map.fitBounds(group.getBounds(), { padding: [20, 20] });
        }
      })
      .catch(function () { /* map still usable without the overlay */ });
  }

  window.TrailCheck = { register: register, login: login, wirePasskeyPage: wirePasskeyPage, initDashboardMap: initDashboardMap };
})();
