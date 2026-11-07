// Check-in search: debounced 300 ms, local + OSM merged server-side. Also fills geo fields on the confirm page.
let here = null;
function locate(cb) {
  if (!navigator.geolocation) return cb && cb(null);
  navigator.geolocation.getCurrentPosition(
    (p) => { here = { lat: p.coords.latitude, lon: p.coords.longitude }; cb && cb(here); },
    () => cb && cb(null),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

// Confirm page: copy position into hidden/blank geo inputs.
if (document.querySelector("[data-geo]")) {
  locate((p) => {
    if (!p) return;
    document.querySelectorAll("[data-geo]").forEach((el) => {
      if (!el.value) el.value = el.dataset.geo === "lat" ? p.lat : p.lon;
    });
  });
}

const q = document.getElementById("q");
if (q) {
  const results = document.getElementById("results");
  const status = document.getElementById("status");
  let timer = null, seq = 0;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const geo = () => (here ? "&lat=" + here.lat + "&lon=" + here.lon : "");

  function card(href, title, sub, badge) {
    const a = el("a", "result");
    a.href = href;
    a.append(el("strong", "", title));
    if (badge) a.append(el("span", "badge tracked", badge));
    if (sub) a.append(el("span", "muted", sub));
    return a;
  }

  function render(data) {
    results.replaceChildren();
    for (const v of data.local || []) {
      const badge = v.visits ? "📍 Tracked · " + v.visits + " visit" + (v.visits === 1 ? "" : "s") + " · Last: " + v.last : "📍 Known venue";
      const a = card("/checkin/new?venue_id=" + v.venue_id + geo(), v.name, [v.address, v.city, v.category].filter(Boolean).join(" · "), badge);
      if (v.osm_updated) a.append(el("span", "muted", "updated from OSM"));
      results.append(a);
    }
    for (const o of data.osm || []) {
      const dist = o.distance_m ? o.distance_m + " m" : "";
      results.append(card("/checkin/new?osm_type=" + o.osm_type + "&osm_id=" + o.osm_id + geo(), o.name, [o.address, o.category, dist].filter(Boolean).join(" · ")));
    }
    status.textContent = data.osm_error || ((data.local || []).length + (data.osm || []).length ? "" : "No matches. You can create a local venue.");
  }

  async function search() {
    const my = ++seq;
    status.textContent = "Searching…";
    try {
      const res = await fetch("/api/search?q=" + encodeURIComponent(q.value) + geo(), { credentials: "same-origin" });
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      if (my === seq) render(data);
    } catch (e) {
      if (my === seq) status.textContent = "Search failed.";
    }
  }

  q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 300); });
  locate((p) => {
    const link = document.getElementById("create-local");
    if (p && link) link.href += "&lat=" + p.lat + "&lon=" + p.lon;
    if (p && !q.value) search(); // nearby places before typing
  });
}
