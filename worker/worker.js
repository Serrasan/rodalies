// Cloudflare Worker: dades en temps real de Rodalies de Catalunya, al moment i amb CORS.
// Publica'l a Cloudflare (Workers → Create → enganxa aquest fitxer → Deploy) i posa la seva
// adreça a site/live-config.js. L'app el consulta cada 30 segons.
const FEEDS = {
  tu: "https://gtfsrt.renfe.com/trip_updates.json",
  vp: "https://gtfsrt.renfe.com/vehicle_positions.json",
  al: "https://gtfsrt.renfe.com/alerts.json",
};
const CACHE_S = 20;          // Renfe actualitza cada ~30 s; una còpia de 20 s evita peticions repetides
const LATE_S = 5 * 60;       // a partir de 5 minuts es compta com a tren amb retard
const LINE_RE = /(R[A-Z]?\d+[NS]?)$/;
const CAT = (id) => typeof id === "string" && id.startsWith("51"); // trens de Rodalies de Catalunya

async function feed(url) {
  const r = await fetch(url, { cf: { cacheTtl: CACHE_S, cacheEverything: true }, headers: { "User-Agent": "rodalies-app/1.0" } });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function text(o) {
  const tr = (o && o.translation) || [];
  const pick = tr.find((t) => /^ca/i.test(t.language || "")) || tr.find((t) => /^es/i.test(t.language || "")) || tr[0];
  return ((pick && pick.text) || "").trim();
}

async function build() {
  const now = Math.floor(Date.now() / 1000);
  const out = { generated: now, source: "worker", feeds: {}, trips: {}, vehicles: {}, alerts: [], network: {}, errors: [] };
  const [tu, vp, al] = await Promise.allSettled([feed(FEEDS.tu), feed(FEEDS.vp), feed(FEEDS.al)]);

  if (tu.status === "fulfilled") {
    out.feeds.trip_updates = Number(tu.value.header?.timestamp || 0);
    const net = {};
    for (const e of tu.value.entity || []) {
      const u = e.tripUpdate || {}, trip = u.trip || {}, id = trip.tripId || "";
      if (!CAT(id)) continue;
      const info = { delay: null, canceled: trip.scheduleRelationship === "CANCELED", skipped: [], next: null };
      for (const s of u.stopTimeUpdate || []) {
        if (s.scheduleRelationship === "SKIPPED") { info.skipped.push(s.stopId); continue; }
        const ev = s.arrival || s.departure || {};
        if (!info.next && s.stopId) info.next = { stop: s.stopId, time: ev.time ? Number(ev.time) : null };
        if (info.delay == null && ev.delay != null) info.delay = Number(ev.delay);
      }
      if (info.delay == null && u.delay != null) info.delay = Number(u.delay);
      out.trips[id] = info;
      const m = id.match(LINE_RE);
      if (m) {
        const a = (net[m[1]] ??= { trains: 0, late: 0, canceled: 0, sum: 0, max: 0 });
        if (info.canceled) a.canceled++;
        else { const d = Math.max(info.delay || 0, 0); a.trains++; a.sum += d; a.max = Math.max(a.max, d); if (d > LATE_S) a.late++; }
      }
    }
    for (const [ln, a] of Object.entries(net)) out.network[ln] = { trains: a.trains, late: a.late, canceled: a.canceled, avg: a.trains ? Math.round(a.sum / a.trains) : 0, max: a.max };
  } else out.errors.push("retards: " + tu.reason);

  if (vp.status === "fulfilled") {
    out.feeds.vehicle_positions = Number(vp.value.header?.timestamp || 0);
    for (const e of vp.value.entity || []) {
      const v = e.vehicle || {}, id = v.trip?.tripId || "", p = v.position || {};
      if (!CAT(id) || p.latitude == null) continue;
      out.vehicles[id] = { lat: +(+p.latitude).toFixed(6), lon: +(+p.longitude).toFixed(6), stop: v.stopId, status: v.currentStatus, ts: Number(v.timestamp || 0) };
    }
  } else out.errors.push("posicions: " + vp.reason);

  if (al.status === "fulfilled") {
    out.feeds.alerts = Number(al.value.header?.timestamp || 0);
    for (const e of al.value.entity || []) {
      const a = e.alert || {}, ents = a.informedEntity || [];
      const routes = ents.map((x) => (x.routeId || "").trim()).filter(CAT);
      const stops = ents.map((x) => (x.stopId || "").trim()).filter(Boolean);
      if (!routes.length && !stops.some((s) => /^7\d{4}$|^65\d{3}$/.test(s))) continue;
      const periods = a.activePeriod || [{}];
      if (!periods.some((p) => Number(p.start || 0) <= now && now <= Number(p.end || 4102444800))) continue;
      out.alerts.push({
        id: e.id, lines: [...new Set(routes.map((r) => (r.match(LINE_RE) || [])[1]).filter(Boolean))], stops,
        header: text(a.headerText), text: text(a.descriptionText),
        start: Number(periods[0].start || 0), end: Number(periods[0].end || 0) || null,
      });
    }
  } else out.errors.push("incidències: " + al.reason);
  return out;
}

export default {
  async fetch(request) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    try {
      const body = JSON.stringify(await build());
      return new Response(body, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${CACHE_S}` } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }
  },
};
