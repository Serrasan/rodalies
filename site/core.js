// Lògica compartida entre l'app mòbil (index.html) i la vista de mapa (mapa.html).
// Si vols canviar com es calcula un retard o quins trens es mostren, és aquí.
window.Rod = (() => {
  "use strict";

  const TZ = "Europe/Madrid";
  const PAST_GRACE_S = 120; // un tren que ha sortit fa < 2 min encara es mostra

  const fmtTime = new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const fmtDay = new Intl.DateTimeFormat("ca-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
  const hm = (ts) => fmtTime.format(new Date(ts * 1000));
  const dayLabel = (ts) => fmtDay.format(new Date(ts * 1000));
  const dayKey = (ts) => fmtKey.format(new Date(ts * 1000));
  const nowS = () => Math.floor(Date.now() / 1000);
  // Retard en hores i minuts: +7 min, +1 h 57 min
  const fmtDelay = (sec) => { const m = Math.round(sec / 60); return m < 60 ? `+${m} min` : `+${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`; };

  async function getJSON(path) {
    const r = await fetch(path + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }

  async function loadAll() {
    const schedule = await getJSON("data/schedule.json");
    let live = null;
    try { live = await getJSON("data/live.json"); } catch { /* només horaris */ }
    return { schedule, live };
  }

  function stationsFor(schedule, dir) {
    const s = schedule.stations;
    return dir === "AB" ? [s.A, s.B] : [s.B, s.A];
  }

  // Estat d'un tren respecte a l'estació d'origen del sentit triat
  function trainStatus(schedule, live, trip) {
    const [o, d] = stationsFor(schedule, trip.dir);
    const info = live?.trips?.[trip.id];
    const veh = live?.vehicles?.[trip.id];
    const idx = (sid) => trip.stops.findIndex((s) => s[0] === sid);
    const oIdx = idx(o.id);

    const st = { delay: null, est: trip.dep, estArr: trip.arr, kind: "idle", label: "Programat", passed: false, running: !!veh, canceled: false };

    if (info?.canceled) return { ...st, kind: "bad", label: "Cancel·lat", canceled: true };
    if (info?.skipped?.includes(o.id)) return { ...st, kind: "bad", label: "No para aquí", canceled: true };
    if (info?.skipped?.includes(d.id)) return { ...st, kind: "bad", label: "No para al destí", canceled: true };

    if (info && info.delay != null) {
      st.delay = info.delay;
      st.est = trip.dep + info.delay;
      st.estArr = trip.arr + info.delay;
      const m = Math.round(info.delay / 60);
      if (m <= 1) { st.kind = "ok"; st.label = m < 0 ? "Avançat" : "A l'hora"; }
      else { st.kind = m >= 10 ? "bad" : "warn"; st.label = fmtDelay(info.delay); }
    } else if (veh) {
      st.kind = "ok"; st.label = "En circulació";
    }

    // Si la propera parada (o on és el tren) ja és després de l'origen, el tren ja ha passat
    if (oIdx >= 0 && [info?.next?.stop, veh?.stop].filter(Boolean).some((sid) => idx(sid) > oIdx)) st.passed = true;
    return st;
  }

  function upcoming(schedule, live, dir, max) {
    const t0 = nowS();
    return schedule.trips
      .filter((t) => t.dir === dir)
      .map((trip) => ({ trip, st: trainStatus(schedule, live, trip) }))
      .filter(({ st }) => !st.passed && st.est >= t0 - PAST_GRACE_S)
      .sort((a, b) => a.st.est - b.st.est)
      .slice(0, max);
  }

  function countdown(ts) {
    const m = Math.round((ts - nowS()) / 60);
    if (m <= 0) return "ara";
    if (m < 60) return "en " + m + " min";
    if (m >= 12 * 60) return null;
    return "en " + Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0");
  }

  function freshness(live) {
    if (!live) return { text: "Només horaris programats (sense dades en temps real)", stale: true };
    const age = Math.round((nowS() - live.generated) / 60);
    const ageTxt = age <= 0 ? "fa menys d'1 min" : `fa ${age} min`;
    const errs = live.errors?.length ? " · algunes dades no s'han pogut baixar" : "";
    return { text: `Dades en temps real de les ${hm(live.generated)} (${ageTxt})${errs}`, stale: age > 15 || !!live.errors?.length };
  }

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid);
    return n;
  }

  function alertNode(a) {
    return el("details", { class: "alert" },
      el("summary", {}, el("span", { class: "tag" }, a.lines.join(" ") || "Avís"), a.header || "Incidència al servei"),
      a.text ? el("p", {}, a.text) : null);
  }

  // Mapa: capa base que segueix el tema clar/fosc
  function makeMap(id, view) {
    if (!window.L) return null;
    const tiles = () => `https://{s}.basemaps.cartocdn.com/${matchMedia("(prefers-color-scheme: dark)").matches ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`;
    const map = L.map(id).setView(view || [41.25, 1.65], 9);
    const layer = L.tileLayer(tiles(), {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => layer.setUrl(tiles()));
    return map;
  }

  const dotIcon = (cls, size) => L.divIcon({ className: "", html: `<div class="${cls}"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

  function stationMarkers(schedule, group) {
    const s = schedule.stations;
    for (const sid of [s.A.id, s.B.id]) {
      const st = schedule.stops[sid];
      if (st) L.marker([st[1], st[2]], { icon: dotIcon("station-marker", 12), title: st[0] }).addTo(group);
    }
  }

  function vehicleText(schedule, veh) {
    const where = schedule.stops[veh.stop]?.[0];
    const verb = veh.status === "STOPPED_AT" ? "Aturat a" : veh.status === "INCOMING_AT" ? "Arribant a" : "Cap a";
    return where ? `${verb} ${where}` : "Posició del tren";
  }

  return { TZ, fmtDelay, hm, dayLabel, dayKey, nowS, getJSON, loadAll, stationsFor, trainStatus, upcoming, countdown, freshness, el, alertNode, makeMap, dotIcon, stationMarkers, vehicleText };
})();
