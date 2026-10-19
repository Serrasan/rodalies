// Tauler principal (index.html): resum, trens en moviment en temps real, sortides,
// estat general de la xarxa i avisos. La lògica de dades comuna és a core.js.
(() => {
  "use strict";
  const R = window.Rod;
  const { el, hm, fmtDelay, nowS } = R;
  const REFRESH_MS = 60_000;
  const MAX_ROWS = 8;

  // Tram dibuixat al diagrama, de sud a nord. Qualsevol altra estació queda "al sud".
  const CORRIDOR = ["71400", "71401", "71500", "71502", "71503", "71600", "71700", "71801", "71802", "79400"];
  const SHORT = { "71400": "Reus", "71401": "Vila-seca", "71500": "Tarragona", "71502": "Altafulla", "71503": "Torredembarra", "71600": "St. Vicenç", "71700": "Vilanova", "71801": "Sants", "71802": "Pg. de Gràcia", "79400": "França" };
  const SOUTH = -0.8;

  const state = { schedule: null, live: null };
  const fmtD = new Intl.DateTimeFormat("ca-ES", { timeZone: R.TZ, day: "numeric", month: "short" });

  // ---------- capçalera i resum ----------
  function renderHeader() {
    const f = R.freshness(state.live);
    const snap = document.getElementById("snap");
    document.getElementById("snap-text").textContent = state.live ? `Dades de les ${hm(state.live.generated)}` : "Només horaris";
    snap.classList.toggle("stale", f.stale);
    snap.title = f.text;
  }

  function lineColor(line) {
    return state.schedule.line_colors?.[line] || state.schedule.trips.find((t) => t.line === line)?.color || "#666";
  }

  function renderSummary(nextBy, onLine) {
    const late = onLine.filter((o) => o.st.delay > 60);
    const worst = [...late].sort((a, b) => b.st.delay - a.st.delay)[0];
    const stat = (k, v, d, cls) => el("div", { class: "stat" + (cls ? " " + cls : "") }, el("span", { class: "k" }, k), el("span", { class: "v" }, v), el("span", { class: "d" }, d));
    const nx = (dir) => nextBy[dir] ? [hm(nextBy[dir].st.est), `${nextBy[dir].trip.line} · ${nextBy[dir].st.label}`] : ["—", "Cap tren"];
    document.getElementById("summary").replaceChildren(
      stat("Propera des de Vila-seca", ...nx("AB")),
      stat("Propera des de Pg. de Gràcia", ...nx("BA")),
      stat("Trens al tram", String(onLine.length), late.length ? `${late.length} amb retard` : "Tots a l'hora", late.length ? "alert-stat" : null),
      stat("Retard més gran", worst ? fmtDelay(worst.st.delay) : "0 min", worst ? `${worst.trip.line} ${worst.trip.train} · cap a ${state.schedule.stops[worst.trip.to]?.[0] || ""}` : "Cap retard ara"));
  }

  // ---------- sortides ----------
  function renderBoards() {
    const nextBy = {};
    const today = R.dayKey(nowS());
    for (const dir of ["AB", "BA"]) {
      const list = document.getElementById("rows-" + dir);
      const rows = R.upcoming(state.schedule, state.live, dir, MAX_ROWS);
      nextBy[dir] = rows.find((r) => !r.st.canceled);
      list.replaceChildren();
      if (!rows.length) list.append(el("li", { class: "empty-row" }, "No hi ha més trens programats avui ni demà."));
      let lastDay = today;
      rows.forEach(({ trip, st }, i) => {
        const d = R.dayKey(trip.dep);
        if (d !== lastDay) { list.append(el("li", { class: "day" }, (d === today ? "Avui" : "Demà") + " · " + R.dayLabel(trip.dep))); lastDay = d; }
        const late = st.delay != null && st.delay > 60;
        const cd = R.countdown(st.est);
        list.append(el("li", { class: "row" + (i === 0 ? " next" : "") + (st.canceled ? " gone" : "") },
          el("span", { class: "t" + (late ? " late" : "") }, hm(st.est), late ? el("small", {}, hm(trip.dep)) : null),
          el("span", { class: "info" }, el("span", { class: "badge", style: `background:${trip.color}` }, trip.line), el("span", { class: "dest" }, state.schedule.stops[trip.to]?.[0] || "")),
          el("span", { class: "pill " + st.kind }, st.label),
          el("span", { class: "sub" }, "Arriba ", el("b", {}, hm(st.estArr)), ` · tren ${trip.train}` + (cd ? ` · ${cd}` : ""))));
      });
    }
    return nextBy;
  }

  // ---------- diagrama en temps real ----------
  const NS = "http://www.w3.org/2000/svg";
  const W = 1100, H = 300, X0 = 120, X1 = W - 70, Y = 150;
  const pos = (sid) => { const i = CORRIDOR.indexOf(sid); return i < 0 ? SOUTH : i; };
  const xOf = (i) => X0 + (i * (X1 - X0)) / (CORRIDOR.length - 1);
  const mk = (parent, tag, attrs, text) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; parent.append(n); return n; };
  let layer = null;

  function drawTrack() {
    const svg = document.getElementById("diagram");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    const { A, B } = state.schedule.stations;
    mk(svg, "line", { x1: xOf(SOUTH), y1: Y, x2: X1 + 30, y2: Y, stroke: "var(--track)", "stroke-width": 6, "stroke-linecap": "round" });
    mk(svg, "text", { x: xOf(SOUTH) - 8, y: Y + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 12 }, "Sud");
    CORRIDOR.forEach((sid, i) => {
      const mine = sid === A.id || sid === B.id;
      mk(svg, "circle", { cx: xOf(i), cy: Y, r: mine ? 10 : 6, fill: mine ? "var(--brand)" : "var(--surface)", stroke: mine ? "var(--surface)" : "var(--track)", "stroke-width": 3 });
      mk(svg, "text", { x: xOf(i), y: Y + (i % 2 ? 34 : -24) + (mine ? (i % 2 ? 4 : -4) : 0), "text-anchor": "middle", fill: mine ? "var(--ink)" : "var(--muted)", "font-size": mine ? 15 : 13, "font-weight": mine ? 700 : 500 }, SHORT[sid] || state.schedule.stops[sid]?.[0] || sid);
    });
    layer = mk(svg, "g", {});
  }

  // Posició (en "estacions") a l'instant `time` segons l'horari desplaçat pel retard, o null si no és al tram
  function where(trip, delay, time) {
    const tt = time - delay, S = trip.stops;
    if (tt < S[0][2] || tt > S[S.length - 1][1]) return null;
    for (let i = 0; i < S.length; i++) {
      if (tt >= S[i][1] && tt <= S[i][2]) return pos(S[i][0]) === SOUTH ? null : { p: pos(S[i][0]), stopped: true, at: S[i][0] };
      if (i < S.length - 1 && tt > S[i][2] && tt < S[i + 1][1]) {
        const a = pos(S[i][0]), b = pos(S[i + 1][0]);
        if (a === SOUTH && b === SOUTH) return null;
        const f = (tt - S[i][2]) / (S[i + 1][1] - S[i][2]);
        return { p: a + (b - a) * f, stopped: false, to: S[i + 1][0] };
      }
    }
    return null;
  }

  function trainsAt(time) {
    const items = [];
    for (const trip of state.schedule.trips) {
      const st = R.trainStatus(state.schedule, state.live, trip);
      if (st.canceled) continue;
      const delay = st.delay || 0;
      const w = where(trip, delay, time);
      if (w) items.push({ trip, st, w, x: xOf(w.p), delay, known: st.delay != null || st.running, up: trip.dir === "AB" });
    }
    return items;
  }

  function drawTrains(time) {
    if (!layer) return [];
    const stops = state.schedule.stops;
    const items = trainsAt(time);
    layer.replaceChildren();
    for (const up of [true, false]) {
      const side = items.filter((i) => i.up === up).sort((a, b) => a.x - b.x);
      const lanesEnd = [];
      for (const it of side) {
        const lbl = `${it.trip.line} ${it.trip.train}`;
        const dl = it.delay > 60 ? fmtDelay(it.delay) : "";
        const wbox = (lbl.length + dl.length) * 8 + (dl ? 46 : 36);
        const bx = Math.min(Math.max(it.x - wbox / 2, 6), W - wbox - 6);
        let lane = lanesEnd.findIndex((end) => end < bx - 6);
        if (lane < 0) lane = lanesEnd.length;
        lanesEnd[lane] = bx + wbox;
        const y = up ? Y - 62 - lane * 32 : Y + 62 + lane * 32;
        const g = mk(layer, "g", { opacity: it.known ? 1 : 0.55 });
        mk(g, "line", { x1: it.x, y1: Y, x2: it.x, y2: y, stroke: it.trip.color, "stroke-width": 2, "stroke-dasharray": "3 3" });
        mk(g, "circle", { cx: it.x, cy: Y, r: it.w.stopped ? 8 : 7, fill: it.trip.color, stroke: "var(--surface)", "stroke-width": 2.5 });
        mk(g, "rect", { x: bx, y: y - 13, width: wbox, height: 26, rx: 7, fill: it.trip.color });
        mk(g, "text", { x: bx + 9, y: y + 5, fill: "#fff", "font-size": 13.5, "font-weight": 700 }, (up ? "" : "← ") + lbl + (up ? " →" : ""));
        if (dl) mk(g, "text", { x: bx + wbox - 9, y: y + 5, "text-anchor": "end", fill: "#fff", "font-size": 12.5, "font-weight": 700 }, dl);
        mk(g, "title", {}, `${lbl} cap a ${stops[it.trip.to]?.[0] || ""}` +
          (it.w.stopped ? ` · aturat a ${stops[it.w.at]?.[0] || ""}` : ` · cap a ${stops[it.w.to]?.[0] || ""}`) +
          (it.known ? (it.delay > 60 ? ` · ${fmtDelay(it.delay)}` : " · a l'hora") : " · sense dades en temps real"));
      }
    }
    return items;
  }

  function tick() {
    const t = Date.now() / 1000;
    const items = drawTrains(t);
    document.getElementById("sim-clock").textContent = new Intl.DateTimeFormat("ca-ES", { timeZone: R.TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
    document.getElementById("sim-count").textContent = `${items.length} trens al tram ara mateix`;
  }

  // ---------- estat general ----------
  function renderNetwork() {
    const box = document.getElementById("net");
    const note = document.getElementById("net-note");
    const net = state.live?.network || {};
    const lines = Object.entries(net).filter(([, a]) => a.trains + a.canceled > 0);
    if (!lines.length) {
      box.replaceChildren(el("p", { class: "empty-row" }, "Encara no hi ha dades de l'estat general. Apareixeran amb la propera actualització."));
      note.textContent = "";
      return;
    }
    const mine = new Set(state.schedule.trips.map((t) => t.line));
    const tot = lines.reduce((s, [, a]) => ({ trains: s.trains + a.trains, late: s.late + a.late, canceled: s.canceled + a.canceled }), { trains: 0, late: 0, canceled: 0 });
    const pct = tot.trains ? Math.round((tot.late / tot.trains) * 100) : 0;
    const level = pct >= 40 || tot.canceled >= 10 ? "bad" : pct >= 15 || tot.canceled > 0 ? "warn" : "ok";
    const verdict = { ok: "La xarxa va bé", warn: "Hi ha retards a la xarxa", bad: "La xarxa va malament" }[level];
    const order = (l) => { const m = l.match(/^R([A-Z]?)(\d+)/); return m ? (m[1] ? 100 : 0) + Number(m[2]) : 999; };
    lines.sort(([a], [b]) => (mine.has(b) - mine.has(a)) || order(a) - order(b) || a.localeCompare(b));
    const maxAvg = Math.max(600, ...lines.map(([, a]) => a.avg));

    box.replaceChildren(
      el("div", { class: "net-verdict" },
        el("span", { class: "verdict-dot " + level, "aria-hidden": "true" }),
        el("div", {}, el("div", { class: "big" }, verdict),
          el("div", { class: "why" }, `${tot.trains} trens circulant · ${pct}% amb més de 5 min de retard` + (tot.canceled ? ` · ${tot.canceled} cancel·lats` : "")))),
      el("div", { class: "net-wrap" },
        el("table", { class: "net-table" },
          el("thead", {}, el("tr", {}, el("th", {}, "Línia"), el("th", { class: "num" }, "Trens"), el("th", { class: "num" }, "Amb retard"), el("th", {}, "Retard mitjà"), el("th", { class: "num" }, "Màxim"), el("th", { class: "num" }, "Cancel·lats"))),
          el("tbody", {}, ...lines.map(([ln, a]) => {
            const lvl = a.avg >= 600 ? "var(--bad)" : a.avg >= 180 ? "var(--warn)" : "var(--ok)";
            return el("tr", { class: mine.has(ln) ? "mine" : null },
              el("td", {}, el("span", { class: "badge", style: `background:${lineColor(ln)}` }, ln)),
              el("td", { class: "num" }, String(a.trains)),
              el("td", { class: "num" }, a.late ? String(a.late) : "—"),
              el("td", {}, el("span", { class: "bar", "aria-hidden": "true" }, el("i", { style: `width:${Math.max(4, Math.round((a.avg / maxAvg) * 100))}%;background:${lvl}` })), " ", a.avg > 30 ? fmtDelay(a.avg) : "a l'hora"),
              el("td", { class: "num" }, a.max > 60 ? fmtDelay(a.max) : "—"),
              el("td", { class: "num" }, a.canceled ? String(a.canceled) : "—"));
          })))));
    note.textContent = `Segons les dades de Renfe de les ${hm(state.live.generated)}. Les teves línies, ressaltades a dalt.`;
  }

  // ---------- avisos ----------
  function renderAlerts() {
    const box = document.getElementById("alerts");
    const alerts = state.live?.alerts || [];
    box.replaceChildren(...alerts.map((a) => el("div", { class: "alert" },
      el("span", { class: "icon", "aria-hidden": "true" }, "!"),
      el("span", { class: "meta" }, ...a.lines.map((l) => el("span", { class: "badge", style: `background:${lineColor(l)}` }, l)), a.start ? ` · des del ${fmtD.format(new Date(a.start * 1000))}` : ""),
      el("p", {}, [a.header, a.text].filter(Boolean).join(". ")))));
    if (!alerts.length) box.append(el("p", { class: "empty-row" }, "Cap avís actiu a les teves línies."));
    document.getElementById("al-aside").textContent = alerts.length ? `${alerts.length} actius` : "";
    const fts = state.live?.feeds?.alerts;
    const age = fts ? Math.round((nowS() - fts) / 86400) : 0;
    document.getElementById("al-note").textContent = age > 1
      ? `Renfe no actualitza el canal d'avisos des del ${fmtD.format(new Date(fts * 1000))} (fa ${age} dies): aquests avisos poden estar desfasats. Per a l'estat actual, consulta els comptes de cada línia a X.`
      : "";
  }

  function renderLegend() {
    const lines = [...new Set(state.schedule.trips.map((t) => t.line))].sort();
    document.getElementById("legend").replaceChildren(
      ...lines.map((l) => el("span", {}, el("i", { style: `background:${lineColor(l)}` }), l)),
      el("span", {}, el("i", { style: "background:var(--brand)" }), "Les teves estacions"));
    document.getElementById("diag-aside").textContent = "En temps real · a dalt, cap a Barcelona; a sota, cap al sud. Translúcids: sense dades en directe.";
  }

  // ---------- càrrega ----------
  function renderAll() {
    renderHeader();
    const nextBy = renderBoards();
    const onLine = trainsAt(Date.now() / 1000);
    renderSummary(nextBy, onLine);
    renderNetwork();
    renderAlerts();
  }

  async function refresh() {
    try {
      const d = await R.loadAll();
      const newDay = !state.schedule || d.schedule.generated !== state.schedule.generated;
      state.schedule = d.schedule; state.live = d.live;
      if (newDay) { drawTrack(); renderLegend(); }
      renderAll();
    } catch {
      if (!state.schedule) document.getElementById("snap-text").textContent = "No s'han pogut carregar les dades";
    }
  }

  // Sentit a mòbil
  const boards = document.getElementById("boards");
  for (const dir of ["AB", "BA"]) {
    document.getElementById("t-" + dir).addEventListener("click", () => {
      boards.dataset.show = dir;
      for (const d of ["AB", "BA"]) document.getElementById("t-" + d).setAttribute("aria-pressed", String(d === dir));
    });
  }

  refresh().then(() => {
    // Els trens avancen cada segon; si l'usuari prefereix menys moviment, cada 15 s
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    tick();
    setInterval(() => { if (state.schedule && !document.hidden) tick(); }, reduced ? 15_000 : 1000);
    setInterval(refresh, REFRESH_MS);
    setInterval(() => { if (state.schedule) renderAll(); }, 30_000); // comptes enrere i sortides
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  });
})();
