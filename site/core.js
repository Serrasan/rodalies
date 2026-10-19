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

  let scheduleCache = null, scheduleAt = 0;

  // Dades en directe: primer el Worker (cada 30 s), si no hi és o falla, el fitxer de GitHub (cada ~5 min)
  async function loadAll() {
    if (!scheduleCache || Date.now() - scheduleAt > 10 * 60_000) {
      scheduleCache = await getJSON("data/schedule.json");
      scheduleAt = Date.now();
    }
    const schedule = scheduleCache;
    let live = null;
    if (window.ROD_LIVE_URL) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(window.ROD_LIVE_URL, { signal: ctl.signal, cache: "no-store" });
        clearTimeout(timer);
        if (r.ok) live = normalizeLive(schedule, await r.json());
      } catch { /* es prova amb GitHub */ }
    }
    if (!live) {
      try { live = normalizeLive(schedule, await getJSON("data/live.json")); } catch { /* només horaris */ }
    }
    return { schedule, live };
  }

  // Les dues fonts fan servir els codis de tren de Renfe; aquí s'enllacen amb els trens de l'horari
  // (pel codi exacte o, si el servei del dia té un altre prefix, pel número de tren + línia).
  function normalizeLive(schedule, raw) {
    if (!raw || raw.error) return null;
    const today = dayKey(nowS());
    const byId = new Map(schedule.trips.map((t) => [t.id, t]));
    const byKey = new Map();
    for (const t of schedule.trips) if (t.date === today || !byKey.has(t.key)) byKey.set(t.key, t);
    // Canal de mitja distància (Regional Exprés): codi "LD:<número de tren>", s'enllaça pel número de tren d'avui
    const byTrain = new Map();
    for (const t of schedule.trips) if (t.date === today || !byTrain.has(t.train)) byTrain.set(t.train, t);
    // L'horari ja ha emparellat cada Regional Exprés amb el seu tren de Rodalies per hora (camp "ld")
    for (const t of schedule.trips) for (const n of t.ld || []) if (t.date === today || !byTrain.has(n)) byTrain.set(n, t);
    const match = (id) => String(id).startsWith("LD:") ? byTrain.get(String(id).slice(3)) : (byId.get(id) || byKey.get(String(id).slice(5)));
    const remap = (obj) => {
      const out = {};
      // primer Rodalies; el canal de mitja distància només omple els trens que hi falten
      const entries = Object.entries(obj || {}).sort(([a], [b]) => (a.startsWith("LD:") - b.startsWith("LD:")));
      for (const [id, v] of entries) { const t = match(id); if (t && !(t.id in out)) out[t.id] = v; }
      return out;
    };
    const lines = new Set(schedule.trips.map((t) => t.line));
    const stations = new Set([schedule.stations.A.id, schedule.stations.B.id]);
    const alerts = (raw.alerts || []).filter((a) => (a.lines || []).some((l) => lines.has(l)) || (a.stops || []).some((s) => stations.has(s)))
      .map((a) => ({ ...a, lines: (a.lines || []).filter((l) => lines.has(l)) }));
    return { ...raw, trips: remap(raw.trips), vehicles: remap(raw.vehicles), alerts };
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

    // Retard: el que publica Renfe o, si és més gran, el que es dedueix de la posició del tren
    // (si encara és aturat en una estació de la qual ja havia de sortir, o no hi ha arribat a l'hora)
    const reported = info && info.delay != null ? Math.max(info.delay, 0) : null; // un tren no surt abans d'hora
    const inferred = inferDelay(trip, veh);
    const delay = inferred != null && inferred > (reported ?? 0) + 60 ? inferred : reported;
    if (delay != null) {
      st.delay = delay;
      st.inferred = delay !== reported;
      st.est = trip.dep + delay;
      st.estArr = trip.arr + delay;
      const m = Math.round(delay / 60);
      if (m <= 1) { st.kind = "ok"; st.label = m < 0 ? "Avançat" : "A l'hora"; }
      else { st.kind = m >= 10 ? "bad" : "warn"; st.label = fmtDelay(delay); }
    } else if (veh) {
      st.kind = "ok"; st.label = "En circulació";
    } else if (nowS() > trip.dep + PAST_GRACE_S) {
      // Ja hauria d'haver passat per la teva estació i Renfe no en diu res: pot ser que no hagi sortit
      st.kind = "warn"; st.label = "Sense notícies"; st.noNews = true;
    }

    // Si la propera parada (o on és el tren) ja és després de l'origen, el tren ja ha passat
    if (oIdx >= 0 && [info?.next?.stop, veh?.stop].filter(Boolean).some((sid) => idx(sid) > oIdx)) st.passed = true;
    // Encara no ha arribat a la teva estació (la propera parada és abans o és la teva): segueix a la llista
    const nIdx = info?.next?.stop ? idx(info.next.stop) : -1;
    if (!st.passed && nIdx >= 0 && nIdx <= oIdx) {
      st.waiting = true;
      const now = nowS();
      if (st.est < now) { st.est = now; st.estArr = Math.max(st.estArr, now + (trip.arr - trip.dep)); }
    }
    return st;
  }

  // Retard mínim que es dedueix de l'última posició: aturat a una estació després de l'hora de sortida,
  // o encara de camí a una estació després de l'hora d'arribada
  // Només quan el tren és ATURAT en una estació: si ja n'hauria d'haver sortit, aquest és el retard mínim.
  // (En marxa no es fa servir: segons el canal de Renfe, l'estació que dona és l'anterior o la següent.)
  function inferDelay(trip, veh) {
    if (!veh || !veh.stop || !veh.ts || veh.status !== "STOPPED_AT") return null;
    const s = trip.stops.find((x) => x[0] === veh.stop);
    if (!s) return null;
    const d = veh.ts - s[2];
    return d > 60 ? d : null;
  }

  const NO_NEWS_KEEP_S = 60 * 60; // un tren "sense notícies" es manté a la llista fins a 1 hora

  function upcoming(schedule, live, dir, max) {
    const t0 = nowS();
    return schedule.trips
      .filter((t) => t.dir === dir)
      .map((trip) => ({ trip, st: trainStatus(schedule, live, trip) }))
      .filter(({ st }) => !st.passed && (st.est >= t0 - PAST_GRACE_S || st.waiting || (st.noNews && st.est >= t0 - NO_NEWS_KEEP_S)))
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
    // En marxa, l'estació que dona Renfe és l'última per on ha passat
    const verb = veh.status === "STOPPED_AT" ? "Aturat a" : "Ha passat per";
    return where ? `${verb} ${where}` : "Posició del tren";
  }

  return { TZ, fmtDelay, hm, dayLabel, dayKey, nowS, getJSON, loadAll, stationsFor, trainStatus, upcoming, countdown, freshness, el, alertNode, makeMap, dotIcon, stationMarkers, vehicleText };
})();
