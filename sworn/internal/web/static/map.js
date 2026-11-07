// Leaflet map: static raster tiles from /tiles/, user's check-ins and shared venues from /api/map.
const TILE_URL = "/tiles/{z}/{x}/{y}.png";
L.Icon.Default.imagePath = "/static/leaflet/images/";

function tileLayer() {
  return L.tileLayer(TILE_URL, { minZoom: 1, maxZoom: 18, attribution: "© OpenStreetMap contributors" });
}

const mini = document.getElementById("venue-map");
if (mini) {
  const ll = [parseFloat(mini.dataset.lat), parseFloat(mini.dataset.lon)];
  const m = L.map(mini).setView(ll, 16);
  tileLayer().addTo(m);
  L.marker(ll).addTo(m).bindPopup(Object.assign(document.createElement("span"), { textContent: mini.dataset.name }));
}

const big = document.getElementById("map");
if (big) {
  const map = L.map(big).setView([20, 0], 2);
  tileLayer().addTo(map);
  const venueLayer = L.layerGroup().addTo(map);
  const mineLayer = L.layerGroup().addTo(map);

  function popup(name, id, extra) {
    const d = document.createElement("div");
    const a = document.createElement("a");
    a.href = "/venues/" + id;
    a.textContent = name;
    d.append(a);
    if (extra) d.append(document.createElement("br"), document.createTextNode(extra));
    return d;
  }

  let timer = null;
  async function load() {
    const b = map.getBounds();
    const qs = new URLSearchParams({ minLat: b.getSouth(), minLon: b.getWest(), maxLat: b.getNorth(), maxLon: b.getEast() });
    const res = await fetch("/api/map?" + qs, { credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    venueLayer.clearLayers();
    mineLayer.clearLayers();
    for (const v of data.venues) L.marker([v.lat, v.lon]).bindPopup(popup(v.name, v.id)).addTo(venueLayer);
    for (const c of data.checkins)
      L.circleMarker([c.lat, c.lon], { radius: 8, color: "#b3261e", fillColor: "#e8554e", fillOpacity: 0.85 })
        .bindPopup(popup(c.name, c.id, c.count + " check-in" + (c.count === 1 ? "" : "s")))
        .addTo(mineLayer);
  }
  map.on("moveend", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  load();

  document.getElementById("near-me").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => map.flyTo([p.coords.latitude, p.coords.longitude], 15));
  });
}
