// Vista mòbil (index.html). La lògica de dades és a core.js.
(() => {
  "use strict";
  const R = window.Rod;
  const REFRESH_MS = 60_000;
  const MAX_ROWS = 12;

  const state = { schedule: null, live: null, dir: load("dir") || "AB", selected: null, map: null, layers: null };

  function load(k) { try { return localStorage.getItem("rod_" + k); } catch { return null; } }
  function save(k, v) { try { localStorage.setItem("rod_" + k, v); } catch { /* sense emmagatzematge */ } }

  function renderList() {
    const list = document.getElementById("list");
    const rows = R.upcoming(state.schedule, state.live, state.dir, MAX_ROWS);
    list.replaceChildren();
    document.getElementById("empty").hidden = rows.length > 0;
    const today = R.dayKey(R.nowS());
    let lastDay = today;
    const stops = state.schedule.stops;
    const el = R.el;

    for (const { trip, st } of rows) {
      const d = R.dayKey(trip.dep);
      if (d !== lastDay) {
        list.append(el("li", { class: "day-sep" }, d === today ? "Avui" : "Demà · " + R.dayLabel(trip.dep)));
        lastDay = d;
      }
      const late = st.delay != null && st.delay > 60;
      const dur = Math.round((trip.arr - trip.dep) / 60);
      const dest = stops[trip.to]?.[0] || "";
      list.append(el("li", { class: "train" + (state.selected === trip.id ? " sel" : "") + (st.canceled ? " gone" : "") },
        el("button", { type: "button", "aria-label": `Tren ${trip.line} de les ${R.hm(trip.dep)}, ${st.label}`, onclick: () => select(trip.id) },
          el("span", { class: "time" + (late ? " late" : "") }, R.hm(st.est), late ? el("span", { class: "sched" }, R.hm(trip.dep)) : null),
          el("span", { class: "meta" },
            el("span", { class: "badge", style: `background:${trip.color}` }, trip.line),
            el("span", { class: "num" }, trip.train),
            el("span", { class: "countdown" }, R.countdown(st.est))),
          el("span", { class: "pill " + st.kind }, st.label),
          el("span", { class: "sub" }, "Arriba ", el("b", {}, R.hm(st.estArr)), ` · ${dur} min · dir. ${dest}`))));
    }

    if ((!state.selected || !rows.some((r) => r.trip.id === state.selected)) && rows.length) {
      state.selected = rows[0].trip.id;
      list.querySelector(".train")?.classList.add("sel");
    }
    renderMap();
  }

  function select(id) {
    state.selected = id;
    renderList();
    document.getElementById("map").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  function renderHeader() {
    for (const dir of ["AB", "BA"]) {
      const [o, d] = R.stationsFor(state.schedule, dir);
      const b = document.getElementById("dir-" + dir);
      b.replaceChildren(R.el("small", {}, "Des de " + o.short), R.el("span", {}, "→ " + d.short));
      b.setAttribute("aria-selected", String(state.dir === dir));
    }
    document.getElementById("board-sub").textContent = "Sortides de " + R.stationsFor(state.schedule, state.dir)[0].short;
  }

  function renderFresh() {
    const p = document.getElementById("fresh");
    const f = R.freshness(state.live);
    p.textContent = f.text;
    p.classList.toggle("stale", f.stale);
  }

  function renderAlerts() {
    const box = document.getElementById("alerts");
    const alerts = state.live?.alerts || [];
    box.hidden = alerts.length === 0;
    box.replaceChildren(...alerts.map(R.alertNode));
  }

  function renderMap() {
    const note = document.getElementById("map-note");
    const sub = document.getElementById("map-sub");
    if (!state.map) { note.textContent = "No s'ha pogut carregar el mapa."; return; }
    state.layers.clearLayers();
    const trip = state.schedule.trips.find((t) => t.id === state.selected);
    if (!trip) { sub.textContent = "Toca un tren de la llista"; note.textContent = ""; return; }

    const stops = state.schedule.stops;
    const coords = trip.stops.map((s) => stops[s[0]]).filter(Boolean).map((s) => [s[1], s[2]]);
    L.polyline(coords, { color: trip.color, weight: 4, opacity: 0.85 }).addTo(state.layers);
    R.stationMarkers(state.schedule, state.layers);

    sub.textContent = `${trip.line} · tren ${trip.train} · ${R.hm(trip.dep)}`;
    const veh = state.live?.vehicles?.[trip.id];
    if (veh) {
      const txt = R.vehicleText(state.schedule, veh);
      L.marker([veh.lat, veh.lon], { icon: R.dotIcon("train-marker", 18), zIndexOffset: 1000 }).bindTooltip(txt).addTo(state.layers);
      note.textContent = `${txt} (posició de les ${R.hm(veh.ts || state.live.generated)}).`;
      state.map.setView([veh.lat, veh.lon], 11);
    } else {
      note.textContent = state.live?.trips?.[trip.id]
        ? "Renfe no dona la posició d'aquest tren ara mateix."
        : `Encara no ha sortit. Surt de ${stops[trip.from]?.[0] || "l'origen"} a les ${R.hm(trip.stops[0][2])}.`;
      if (coords.length) state.map.fitBounds(coords, { padding: [20, 20] });
    }
  }

  async function refresh() {
    try { const d = await R.loadAll(); state.schedule = d.schedule; state.live = d.live; }
    catch { /* es manté l'última lectura */ }
    renderFresh(); renderAlerts(); renderList();
  }

  async function boot() {
    try { state.schedule = (await R.loadAll()).schedule; }
    catch {
      document.getElementById("fresh").textContent = "No s'han pogut carregar els horaris. Torna-ho a provar en uns minuts.";
      return;
    }
    if (!["AB", "BA"].includes(state.dir)) state.dir = "AB";
    document.querySelectorAll(".dir button").forEach((b) => b.addEventListener("click", () => {
      state.dir = b.dataset.dir; save("dir", state.dir); state.selected = null;
      renderHeader(); renderList();
    }));
    renderHeader();
    state.map = R.makeMap("map");
    if (state.map) state.layers = L.layerGroup().addTo(state.map);
    await refresh();
    setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  boot();
})();
