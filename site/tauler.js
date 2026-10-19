// Tauler principal (index.html): resum, trens en moviment en temps real, sortides,
// estat general de la xarxa i avisos. La lògica de dades comuna és a core.js.
(() => {
  "use strict";
  const R = window.Rod;
  const { el, hm, fmtDelay, nowS } = R;
  const REFRESH_MS = window.ROD_LIVE_URL ? 30_000 : 60_000; // amb el Worker, dades noves cada 30 s
  const MAX_ROWS = 8;

  const state = { schedule: null, live: null };
  const fmtD = new Intl.DateTimeFormat("ca-ES", { timeZone: R.TZ, day: "numeric", month: "short" });

  // ---------- capçalera i resum ----------
  function renderHeader() {
    const f = R.freshness(state.live);
    const snap = document.getElementById("snap");
    document.getElementById("snap-text").textContent = state.live
      ? (state.live.source === "worker" ? `En directe · ${hm(state.live.generated)}` : `Dades de les ${hm(state.live.generated)}`)
      : "Només horaris";
    snap.classList.toggle("stale", f.stale);
    snap.title = f.text;
  }

  function lineColor(line) {
    return state.schedule.line_colors?.[line] || state.schedule.trips.find((t) => t.line === line)?.color || "#666";
  }

  function renderSummary(nextBy) {
    // Trens al tram: els mateixos que es veuen al diagrama
    const items = state.lastRes?.items || [];
    const onLine = items.map((i) => ({ trip: i.trip, st: { delay: i.known ? i.delay : null } }));
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

  // Enllaç a la posició GPS real, només si Renfe dona la posició del tren
  function gpsLink(trip) {
    const v = state.live?.vehicles?.[trip.id];
    if (!v) return null;
    return [" · ", el("a", { class: "gps", href: `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lon}`, target: "_blank", rel: "noopener", title: `Posició GPS de les ${hm(v.ts || state.live.generated)}` }, "Posició GPS ↗")];
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
          el("span", { class: "sub" }, "Arriba ", el("b", {}, hm(st.estArr)), ` · tren ${trip.train}` + (cd ? ` · ${cd}` : ""), gpsLink(trip))));
      });
    }
    return nextBy;
  }

  // ---------- diagrama i rellotge en temps real ----------
  let diagram = null;
  const fmtClock = new Intl.DateTimeFormat("ca-ES", { timeZone: R.TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const statusOf = (trip) => {
    const st = R.trainStatus(state.schedule, state.live, trip);
    return { delay: st.delay, known: st.delay != null || st.running, canceled: st.canceled };
  };
  function setupDiagram() {
    const s = state.schedule;
    diagram = window.RodDiagram(document.getElementById("diagram"), { A: s.stations.A, B: s.stations.B, name: (sid) => s.stops[sid]?.[0] || sid,
      gpsOf: (trip) => state.live?.vehicles?.[trip.id] || null });
  }
  function tick() {
    if (!diagram) return;
    const t = Date.now() / 1000;
    const res = diagram.render(state.schedule.trips, statusOf, t);
    state.lastRes = res;
    document.getElementById("clock").textContent = fmtClock.format(new Date());
    const s = state.schedule.stations;
    document.getElementById("arrivals").replaceChildren(...["A", "B"].map((k) => {
      const n = res.next[k];
      return el("div", { class: "arr" },
        el("span", { class: "where" }, "Proper tren a " + s[k].short),
        el("span", { class: "eta" }, n ? diagram.mmss(n.eta - t) : "—"),
        el("span", { class: "what" }, n ? `${n.trip.line} ${n.trip.train} · ${hm(n.eta)}` + (n.delay > 60 ? ` (${fmtDelay(n.delay)})` : "") + (n.known ? "" : " · segons horari") : "Cap més avui"));
    }));
    document.getElementById("diag-aside").textContent = `${res.count} trens al tram · a dalt, cap a Barcelona; a sota, cap al sud. Translúcids: sense dades en directe.`;
    const f = R.freshness(state.live);
    document.getElementById("live-dot").classList.toggle("stale", f.stale);
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
  }

  // ---------- càrrega ----------
  function renderAll() {
    renderHeader();
    const nextBy = renderBoards();
    tick();
    renderSummary(nextBy);
    renderNetwork();
    renderAlerts();
  }

  async function refresh() {
    try {
      const d = await R.loadAll();
      const newDay = !state.schedule || d.schedule.generated !== state.schedule.generated;
      state.schedule = d.schedule; state.live = d.live;
      if (newDay) { setupDiagram(); renderLegend(); }
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
    // El rellotge, els comptes enrere i la posició dels trens s'actualitzen cada segon
    tick();
    setInterval(() => { if (state.schedule && !document.hidden) tick(); }, 1000);
    setInterval(refresh, REFRESH_MS);
    setInterval(() => { if (state.schedule) renderAll(); }, 30_000); // comptes enrere i sortides
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  });
})();
