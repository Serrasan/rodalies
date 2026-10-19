// Diagrama de la línia amb els trens en moviment (compartit entre l'app i l'artifact).
// Ús: const d = RodDiagram(svg, { A, B, name }); d.render(trips, statusOf, ara)
//   trips:    [{ id, line, color, train, dir, to, stops: [[estació, arribada, sortida], ...] }]
//   statusOf: (trip) => { delay: segons o null, known: bool, canceled: bool }
//   ara:      segons UNIX. Retorna { count, next: { A: {...}, B: {...} } }
window.RodDiagram = function (svg, opts) {
  "use strict";
  const CORRIDOR = ["71400", "71401", "71500", "71502", "71503", "71600", "71700", "71801", "71802", "79400"];
  const SHORT = { "71400": "Reus", "71401": "Vila-seca", "71500": "Tarragona", "71502": "Altafulla", "71503": "Torredembarra", "71600": "St. Vicenç", "71700": "Vilanova", "71801": "Sants", "71802": "Pg. de Gràcia", "79400": "França" };
  const SOUTH = -0.8; // estacions fora del tram (Cambrils, Tortosa, Móra, la Plana...): entren pel sud
  const W = 1100, H = 330, X0 = 120, X1 = W - 70, Y = 165;
  const NS = "http://www.w3.org/2000/svg";
  const { A, B, name } = opts;

  const pos = (sid) => { const i = CORRIDOR.indexOf(sid); return i < 0 ? SOUTH : i; };
  const xOf = (i) => X0 + (i * (X1 - X0)) / (CORRIDOR.length - 1);
  const mk = (parent, tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    parent.append(n);
    return n;
  };
  const mmss = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(s % 60).padStart(2, "0")}`; };
  const shortName = (sid) => SHORT[sid] || name(sid);

  // Via i estacions
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const defs = mk(svg, "defs", {});
  const style = mk(defs, "style", {});
  style.textContent = `
    .rd-pulse { transform-box: fill-box; transform-origin: center; animation: rd-pulse 1.6s ease-out infinite; }
    @keyframes rd-pulse { from { transform: scale(1); opacity: .55 } to { transform: scale(2.6); opacity: 0 } }
    @media (prefers-reduced-motion: reduce) { .rd-pulse { animation: none; opacity: 0; } }`;
  mk(svg, "line", { x1: xOf(SOUTH), y1: Y, x2: X1 + 30, y2: Y, stroke: "var(--track)", "stroke-width": 6, "stroke-linecap": "round" });
  mk(svg, "text", { x: xOf(SOUTH) - 8, y: Y + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 12 }, "Sud");
  CORRIDOR.forEach((sid, i) => {
    const mine = sid === A.id || sid === B.id;
    mk(svg, "circle", { cx: xOf(i), cy: Y, r: mine ? 10 : 6, fill: mine ? "var(--brand)" : "var(--surface)", stroke: mine ? "var(--surface)" : "var(--track)", "stroke-width": 3 });
    mk(svg, "text", { x: xOf(i), y: Y + (i % 2 ? 34 : -24) + (mine ? (i % 2 ? 4 : -4) : 0), "text-anchor": "middle", fill: mine ? "var(--ink)" : "var(--muted)", "font-size": mine ? 15 : 13, "font-weight": mine ? 700 : 500 }, shortName(sid));
  });
  const layer = mk(svg, "g", {});

  // On és un tren a l'instant `time` (horari desplaçat pel retard) i quin és el seu proper esdeveniment
  function where(trip, delay, time) {
    const tt = time - delay, S = trip.stops;
    if (tt < S[0][2] || tt > S[S.length - 1][1]) return null;
    for (let i = 0; i < S.length; i++) {
      if (tt >= S[i][1] && tt <= S[i][2]) {
        if (pos(S[i][0]) === SOUTH) return null;
        return { p: pos(S[i][0]), stopped: true, at: S[i][0], left: S[i][2] - tt };
      }
      if (i < S.length - 1 && tt > S[i][2] && tt < S[i + 1][1]) {
        const a = pos(S[i][0]), b = pos(S[i + 1][0]);
        if (a === SOUTH && b === SOUTH) return null;
        const f = (tt - S[i][2]) / (S[i + 1][1] - S[i][2]);
        return { p: a + (b - a) * f, stopped: false, to: S[i + 1][0], left: S[i + 1][1] - tt };
      }
    }
    return null;
  }

  function render(trips, statusOf, time) {
    const items = [];
    const next = { A: null, B: null };
    for (const trip of trips) {
      const st = statusOf(trip);
      if (st.canceled) continue;
      const delay = st.delay || 0;
      // Propera arribada a les teves estacions
      for (const key of ["A", "B"]) {
        const s = trip.stops.find((x) => x[0] === opts[key].id);
        if (!s) continue;
        const eta = s[1] + delay;
        if (eta >= time && (!next[key] || eta < next[key].eta)) next[key] = { trip, eta, delay, known: st.known };
      }
      const w = where(trip, delay, time);
      if (w) items.push({ trip, w, x: xOf(w.p), delay, known: st.known, up: trip.dir === "AB" });
    }

    layer.replaceChildren();
    let minY = 0, maxY = H;
    for (const up of [true, false]) {
      const side = items.filter((i) => i.up === up).sort((a, b) => a.x - b.x);
      const lanesEnd = [];
      for (const it of side) {
        const { trip, w } = it;
        const head = `${trip.line} ${trip.train}`;
        const dl = it.delay > 60 ? `+${Math.round(it.delay / 60) >= 60 ? Math.floor(Math.round(it.delay / 60) / 60) + " h " + (Math.round(it.delay / 60) % 60) + " min" : Math.round(it.delay / 60) + " min"}` : "";
        const sub = w.stopped ? `Aturat a ${shortName(w.at)} · surt en ${mmss(w.left)}` : `→ ${shortName(w.to)} en ${mmss(w.left)}`;
        const wbox = Math.max((head.length + dl.length) * 8 + (dl ? 44 : 34), sub.length * 6.4 + 22);
        const bx = Math.min(Math.max(it.x - wbox / 2, 6), W - wbox - 6);
        let lane = lanesEnd.findIndex((end) => end < bx - 6);
        if (lane < 0) lane = lanesEnd.length;
        lanesEnd[lane] = bx + wbox;
        const y = up ? Y - 66 - lane * 46 : Y + 66 + lane * 46;
        minY = Math.min(minY, y - 26); maxY = Math.max(maxY, y + 26);
        const g = mk(layer, "g", { opacity: it.known ? 1 : 0.5 });
        mk(g, "line", { x1: it.x, y1: Y, x2: it.x, y2: up ? y + 19 : y - 19, stroke: trip.color, "stroke-width": 2, "stroke-dasharray": "3 3" });
        if (!w.stopped && it.known) mk(g, "circle", { class: "rd-pulse", cx: it.x, cy: Y, r: 8, fill: trip.color });
        mk(g, "circle", { cx: it.x, cy: Y, r: 8, fill: w.stopped ? "var(--surface)" : trip.color, stroke: trip.color, "stroke-width": w.stopped ? 4 : 2.5 });
        mk(g, "rect", { x: bx, y: y - 19, width: wbox, height: 38, rx: 8, fill: trip.color });
        mk(g, "text", { x: bx + 9, y: y - 3, fill: "#fff", "font-size": 13.5, "font-weight": 700 }, (up ? "" : "← ") + head + (up ? " →" : ""));
        if (dl) mk(g, "text", { x: bx + wbox - 9, y: y - 3, "text-anchor": "end", fill: "#fff", "font-size": 12.5, "font-weight": 700 }, dl);
        mk(g, "text", { x: bx + 9, y: y + 13, fill: "#fff", "fill-opacity": 0.9, "font-size": 11.5, "font-weight": 500, "font-family": "var(--font-mono)" }, sub);
        mk(g, "title", {}, `${head} cap a ${name(trip.to)}` + (it.known ? (dl ? ` · ${dl}` : " · a l'hora") : " · sense dades en directe (segons horari)"));
      }
    }
    // El dibuix creix si hi ha molts trens junts, perquè cap etiqueta quedi tallada
    svg.setAttribute("viewBox", `0 ${minY} ${W} ${maxY - minY}`);
    return { count: items.length, next, items };
  }

  return { render, mmss };
};
