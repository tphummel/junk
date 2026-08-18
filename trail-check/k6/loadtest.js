// k6 load test for trail-check.
//
// Passkey login can't be scripted headlessly -- WebAuthn ceremonies need a
// real authenticator's private key, which only exists on the device that
// registered it. So this script load-tests what's actually reachable
// without a browser:
//
//   - /healthz                     (baseline liveness)
//   - /tiles/:z/:x/:y.png          (the public, unauthenticated hot path --
//                                    this is the one endpoint the design doc
//                                    expects real concurrent load on)
//
// and, if you provide a session cookie captured from a real logged-in
// browser session (devtools -> Application -> Cookies -> session_jwt), it
// also load-tests the authenticated GPX upload path:
//
//   TRAILCHECK_SESSION_COOKIE=<value> \
//   TRAILCHECK_USER_TRAIL_ID=<uuid>   \
//   k6 run k6/loadtest.js
//
// Usage:
//   k6 run -e BASE_URL=http://localhost:8080 trail-check/k6/loadtest.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SESSION_COOKIE = __ENV.TRAILCHECK_SESSION_COOKIE || '';
const USER_TRAIL_ID = __ENV.TRAILCHECK_USER_TRAIL_ID || '';

const tileErrors = new Counter('tile_errors');
const uploadErrors = new Counter('upload_errors');

export const options = {
  scenarios: {
    healthz: {
      executor: 'constant-vus',
      exec: 'healthz',
      vus: 2,
      duration: '30s',
    },
    tiles: {
      executor: 'ramping-vus',
      exec: 'tiles',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '40s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    tile_errors: ['count==0'],
  },
};

// A handful of real-world-ish tile coordinates around zoom 10-14 so repeat
// runs exercise both cache hits (same set every iteration) and the upstream
// fetch path on a cold cache.
const TILES = [
  [10, 176, 408],
  [11, 353, 816],
  [12, 706, 1633],
  [13, 1412, 3266],
  [14, 2825, 6533],
];

export function healthz() {
  const res = http.get(`${BASE_URL}/healthz`);
  check(res, { 'healthz 200': (r) => r.status === 200 });
  sleep(1);
}

export function tiles() {
  const [z, x, y] = TILES[Math.floor(Math.random() * TILES.length)];
  const res = http.get(`${BASE_URL}/tiles/${z}/${x}/${y}.png`);
  const ok = check(res, { 'tile 200': (r) => r.status === 200 });
  if (!ok) tileErrors.add(1);
  sleep(0.5);
}

const sampleGPX = `<?xml version="1.0"?>
<gpx version="1.1" creator="k6"><trk><name>load-test</name><trkseg>
<trkpt lat="34.0001" lon="-118.500"></trkpt>
<trkpt lat="34.0001" lon="-118.490"></trkpt>
<trkpt lat="34.0001" lon="-118.480"></trkpt>
</trkseg></trk></gpx>`;

// Only registered if credentials are supplied; otherwise this scenario is a
// no-op so the script still runs standalone against a fresh instance.
if (SESSION_COOKIE && USER_TRAIL_ID) {
  options.scenarios.gpxUpload = {
    executor: 'constant-vus',
    exec: 'gpxUpload',
    vus: 3,
    duration: '30s',
  };
}

export function gpxUpload() {
  const payload = {
    user_trail_id: USER_TRAIL_ID,
    name: `k6-run-${__VU}-${__ITER}`,
    file: http.file(sampleGPX, 'run.gpx', 'application/gpx+xml'),
  };
  const res = http.post(`${BASE_URL}/runs`, payload, {
    headers: { Cookie: `session_jwt=${SESSION_COOKIE}` },
    redirects: 0,
  });
  const ok = check(res, { 'upload accepted': (r) => r.status === 302 || r.status === 200 });
  if (!ok) uploadErrors.add(1);
  sleep(1);
}
