// Cloudflare Worker: serves the static site (ASSETS) plus one tiny API:
// GET /api/whereami -> approximate visitor location from Cloudflare's edge
// (request.cf). Used as the fallback when browser geolocation is denied or
// unavailable (common on desktops). City-level accuracy — good enough to
// rank shops by corridor; the UI labels it "approximate".
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/whereami') {
      const cf = request.cf || {};
      const lat = cf.latitude != null ? Number(cf.latitude) : null;
      const lng = cf.longitude != null ? Number(cf.longitude) : null;
      return new Response(JSON.stringify({
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        city: cf.city || null,
        source: 'ip',
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
