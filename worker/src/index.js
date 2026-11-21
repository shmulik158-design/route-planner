// Cloudflare Worker: holds the Google API key and returns only a travel-time matrix.
// Request:  POST { points: [{lat, lon}, ...], departureTime: "2026-11-23T08:30:00Z" }
// Response: { dur: [[seconds|null]], dist: [[meters|null]] }
// Only coordinates pass through here — no addresses, no names — and nothing is logged.

const MAX_POINTS = 12; // 10 visits + start + end
const ROUTES_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') {
      if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: { ...cors,
        'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    if (!cors['Access-Control-Allow-Origin']) return reply(403, { error: 'origin not allowed' });
    if (request.method !== 'POST') return reply(405, { error: 'POST only' });
    if (!env.GOOGLE_API_KEY) return reply(503, { error: 'no key configured' });

    let body;
    try { body = await request.json(); } catch { return reply(400, { error: 'bad json' }); }
    const pts = body && body.points;
    if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS) return reply(400, { error: 'points: 2-' + MAX_POINTS });
    for (const p of pts) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)
        return reply(400, { error: 'bad point' });
    }
    // Google rejects departure times in the past; clamp to "now + 1 min" and cap at 7 days ahead.
    let dep = Date.parse(body.departureTime);
    const now = Date.now();
    if (!Number.isFinite(dep) || dep < now + 60e3) dep = now + 60e3;
    if (dep > now + 7 * 864e5) return reply(400, { error: 'departureTime too far ahead' });

    const wp = pts.map(p => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lon } } } }));
    const g = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
      },
      body: JSON.stringify({
        origins: wp, destinations: wp, travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE', departureTime: new Date(dep).toISOString(),
      }),
    });
    if (!g.ok) return reply(502, { error: 'google ' + g.status });
    const els = await g.json();
    return reply(200, toMatrix(els, pts.length));
  },
};

// Google omits zero-valued fields (e.g. originIndex 0), hence the `?? 0`.
export function toMatrix(els, n) {
  const dur = [...Array(n)].map(() => Array(n).fill(null));
  const dist = [...Array(n)].map(() => Array(n).fill(null));
  for (const e of els) {
    const i = e.originIndex ?? 0, j = e.destinationIndex ?? 0;
    if (i >= n || j >= n) continue;
    if (i === j) { dur[i][j] = 0; dist[i][j] = 0; continue; }
    if (e.condition !== 'ROUTE_EXISTS') continue;
    dur[i][j] = parseFloat(e.duration || '0s');
    dist[i][j] = e.distanceMeters ?? 0;
  }
  return { dur, dist };
}
