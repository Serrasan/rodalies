// Diagrama de la línia amb els trens en moviment (compartit entre l'app i l'artifact).
// Ús: const d = RodDiagram(svg, { A, B, name }); d.render(trips, statusOf, ara)
//   trips:    [{ id, line, color, train, dir, to, stops: [[estació, arribada, sortida], ...] }]
//   statusOf: (trip) => { delay: segons o null, known: bool, canceled: bool }
//   ara:      segons UNIX. Retorna { count, next: { A: {...}, B: {...} }, items }
//   opts.gpsOf (opcional): (trip) => { lat, lon, ts } amb la posició GPS real del tren, o null
// A pantalla ampla la via és horitzontal; al mòbil (menys de 640 px) és vertical, de nord (dalt) a sud.
window.RodDiagram = function (svg, opts) {
  "use strict";
  const { A, B, name } = opts;
  // Tram dibuixat: des de Reus o, si la teva estació és Cambrils, des de Cambrils (són branques diferents cap a Vila-seca)
  const CAMBRILS = "65422";
  const CORRIDOR = [A.id === CAMBRILS ? CAMBRILS : "71400", "71401", "71500", "71502", "71503", "71600", "71700", "71801", "71802", "79400"];
  const SHORT = { "65422": "Cambrils", "71400": "Reus", "71401": "Vila-seca", "71500": "Tarragona", "71502": "Altafulla", "71503": "Torredembarra", "71600": "St. Vicenç", "71700": "Vilanova", "71801": "Sants", "71802": "Pg. de Gràcia", "79400": "França" };
  const SOUTH = -0.8; // estacions fora del tram (Cambrils o Reus, Tortosa, Móra, la Plana...): entren pel sud
  const NS = "http://www.w3.org/2000/svg";

  // Horitzontal
  const W = 1100, H = 330, X0 = 120, X1 = W - 70, Y = 165;
  // Vertical (mòbil)
  const VW = 380, TX = 134, VY0 = 34, SP = 66, BOXX = 152, BOXW = VW - BOXX - 4;

  const pos = (sid) => { const i = CORRIDOR.indexOf(sid); return i < 0 ? SOUTH : i; };
  const xOf = (i) => X0 + (i * (X1 - X0)) / (CORRIDOR.length - 1);
  const yOf = (i) => VY0 + (CORRIDOR.length - 1 - i) * SP; // França a dalt, el sud a baix
  const mk = (parent, tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    parent.append(n);
    return n;
  };
  const mmss = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m}:${String(s % 60).padStart(2, "0")}`; };
  const shortName = (sid) => SHORT[sid] || name(sid);
  const hhmm = new Intl.DateTimeFormat("ca-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  const fmtDl = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `+${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `+${m} min`; };
  // Enllaç a Google Maps amb la posició GPS real (al mòbil obre l'app de mapes)
  const gpsUrl = (g) => `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lon}`;

  let layer = null, vertical = null;

  function drawTrack(vert) {
    vertical = vert;
    svg.classList.toggle("vertical", vert);
    svg.replaceChildren();
    const defs = mk(svg, "defs", {});
    mk(defs, "style", {}).textContent = `
      .rd-pulse { transform-box: fill-box; transform-origin: center; animation: rd-pulse 1.6s ease-out infinite; }
      @keyframes rd-pulse { from { transform: scale(1); opacity: .55 } to { transform: scale(2.6); opacity: 0 } }
      @media (prefers-reduced-motion: reduce) { .rd-pulse { animation: none; opacity: 0; } }
      .rd-link { cursor: pointer; } .rd-link:hover rect { filter: brightness(1.12); } .rd-link:focus-visible rect { stroke: var(--ink); stroke-width: 2; }`;
    if (!vert) {
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      mk(svg, "line", { x1: xOf(SOUTH), y1: Y, x2: X1 + 30, y2: Y, stroke: "var(--track)", "stroke-width": 6, "stroke-linecap": "round" });
      mk(svg, "text", { x: xOf(SOUTH) - 8, y: Y + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 12 }, "Sud");
      CORRIDOR.forEach((sid, i) => {
        const mine = sid === A.id || sid === B.id;
        mk(svg, "circle", { cx: xOf(i), cy: Y, r: mine ? 10 : 6, fill: mine ? "var(--brand)" : "var(--surface)", stroke: mine ? "var(--surface)" : "var(--track)", "stroke-width": 3 });
        mk(svg, "text", { x: xOf(i), y: Y + (i % 2 ? 34 : -24) + (mine ? (i % 2 ? 4 : -4) : 0), "text-anchor": "middle", fill: mine ? "var(--ink)" : "var(--muted)", "font-size": mine ? 15 : 13, "font-weight": mine ? 700 : 500 }, shortName(sid));
      });
    } else {
      const ySouth = yOf(SOUTH);
      mk(svg, "line", { x1: TX, y1: yOf(CORRIDOR.length - 1) - 18, x2: TX, y2: ySouth, stroke: "var(--track)", "stroke-width": 6, "stroke-linecap": "round" });
      mk(svg, "text", { x: TX - 14, y: ySouth + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": 13 }, "Sud ↓");
      mk(svg, "text", { x: TX - 14, y: yOf(CORRIDOR.length - 1) - 22, "text-anchor": "end", fill: "var(--muted)", "font-size": 13 }, "Barcelona ↑");
      CORRIDOR.forEach((sid, i) => {
        const mine = sid === A.id || sid === B.id;
        mk(svg, "circle", { cx: TX, cy: yOf(i), r: mine ? 10 : 6, fill: mine ? "var(--brand)" : "var(--surface)", stroke: mine ? "var(--surface)" : "var(--track)", "stroke-width": 3 });
        mk(svg, "text", { x: TX - 16, y: yOf(i) + 5, "text-anchor": "end", fill: mine ? "var(--ink)" : "var(--muted)", "font-size": mine ? 15 : 13.5, "font-weight": mine ? 700 : 500 }, shortName(sid));
      });
    }
    layer = mk(svg, "g", {});
  }

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

  // Textos de l'etiqueta d'un tren
  function texts(it, time, compact) {
    const { trip, w } = it;
    const dl = it.delay > 60 ? fmtDl(it.delay) : "";
    const dest = trip.dir === "AB" ? B : A;
    const ds = trip.stops.find((x) => x[0] === dest.id);
    const etaDest = ds ? ds[1] + it.delay : null;
    const lateTxt = it.delay > 60 ? ` (${dl})` : (it.known ? " (a l'hora)" : "");
    return {
      head: `${trip.line} ${trip.train}`, dl,
      sub: w.stopped ? `Aturat a ${shortName(w.at)} · surt en ${mmss(w.left)}` : `→ ${shortName(w.to)} en ${mmss(w.left)}`,
      arrive: etaDest && etaDest >= time ? `Arriba${compact ? "" : " a " + dest.short} ${hhmm.format(new Date(etaDest * 1000))}${lateTxt}` : "",
      title: `${trip.line} ${trip.train} cap a ${name(trip.to)}` + (it.known ? (dl ? ` · ${dl}` : " · a l'hora") : " · sense dades en directe (segons horari)") + (it.gps ? " · toca per veure la posició GPS real" : ""),
    };
  }

  function drawLabel(parent, it, tx, x, y, w, bh, arrowLeft, compact) {
    const { trip } = it;
    mk(parent, "rect", { x, y, width: w, height: bh, rx: 8, fill: trip.color });
    mk(parent, "text", { x: x + 9, y: y + 16, fill: "#fff", "font-size": 13.5, "font-weight": 700 }, arrowLeft + tx.head);
    if (tx.dl) mk(parent, "text", { x: x + w - 9, y: y + 16, "text-anchor": "end", fill: "#fff", "font-size": 12.5, "font-weight": 700 }, tx.dl);
    mk(parent, "text", { x: x + 9, y: y + 32, fill: "#fff", "fill-opacity": 0.9, "font-size": compact ? 10.5 : 11.5, "font-weight": 500, "font-family": "var(--font-mono)" }, tx.sub);
    if (it.gps && !compact) mk(parent, "text", { x: x + w - 9, y: y + 32, "text-anchor": "end", fill: "#fff", "font-size": 10.5, "font-weight": 700, "letter-spacing": "0.04em" }, "GPS ↗");
    if (tx.arrive) mk(parent, "text", { x: x + 9, y: y + 48, fill: "#fff", "font-size": 12, "font-weight": 700 }, tx.arrive);
    mk(parent, "title", {}, tx.title);
  }

  function render(trips, statusOf, time) {
    const narrow = (svg.parentElement?.clientWidth || 1000) < 640;
    if (vertical !== narrow) drawTrack(narrow);

    const items = [];
    const next = { A: null, B: null };
    for (const trip of trips) {
      const st = statusOf(trip);
      if (st.canceled) continue;
      const delay = st.delay || 0;
      // Propera sortida que pots agafar: de la teva estació cap a Barcelona (A) i de Barcelona cap a casa (B)
      const key = trip.dir === "AB" ? "A" : "B";
      const s = trip.stops.find((x) => x[0] === opts[key].id);
      if (s) {
        const eta = s[2] + delay;
        if (eta >= time && (!next[key] || eta < next[key].eta)) next[key] = { trip, eta, delay, known: st.known };
      }
      const w = where(trip, delay, time);
      if (w) items.push({ trip, w, p: w.p, delay, known: st.known, up: trip.dir === "AB", gps: opts.gpsOf ? opts.gpsOf(trip) : null });
    }

    layer.replaceChildren();
    const wrap = (it) => {
      const parent = it.gps ? mk(layer, "a", { href: gpsUrl(it.gps), target: "_blank", rel: "noopener", class: "rd-link" }) : layer;
      return mk(parent, "g", { opacity: it.known ? 1 : 0.5 });
    };
    const dot = (g, it, cx, cy) => {
      if (!it.w.stopped && it.known) mk(g, "circle", { class: "rd-pulse", cx, cy, r: 8, fill: it.trip.color });
      mk(g, "circle", { cx, cy, r: 8, fill: it.w.stopped ? "var(--surface)" : it.trip.color, stroke: it.trip.color, "stroke-width": it.w.stopped ? 4 : 2.5 });
    };

    if (!vertical) {
      let minY = 0, maxY = H;
      for (const up of [true, false]) {
        const side = items.filter((i) => i.up === up).sort((a, b) => a.p - b.p);
        const lanesEnd = [];
        for (const it of side) {
          const tx = texts(it, time);
          const x = xOf(it.p);
          const wbox = Math.max((tx.head.length + tx.dl.length) * 8 + (tx.dl ? 44 : 34), tx.sub.length * 6.4 + 22 + (it.gps ? 44 : 0), tx.arrive.length * 6.6 + 22);
          const bh = tx.arrive ? 54 : 38;
          const bx = Math.min(Math.max(x - wbox / 2, 6), W - wbox - 6);
          let lane = lanesEnd.findIndex((end) => end < bx - 6);
          if (lane < 0) lane = lanesEnd.length;
          lanesEnd[lane] = bx + wbox;
          const by = up ? Y - 52 - bh - lane * 62 : Y + 55 + lane * 62;
          minY = Math.min(minY, by - 15); maxY = Math.max(maxY, by + bh + 15);
          const g = wrap(it);
          mk(g, "line", { x1: x, y1: Y, x2: x, y2: up ? by + bh : by, stroke: it.trip.color, "stroke-width": 2, "stroke-dasharray": "3 3" });
          dot(g, it, x, Y);
          drawLabel(g, it, tx, bx, by, wbox, bh, up ? "" : "← ");
          if (up) g.querySelector("text").textContent += " →";
        }
      }
      svg.setAttribute("viewBox", `0 ${minY} ${W} ${maxY - minY}`);
    } else {
      // Vertical: etiquetes a la dreta de la via, ordenades de dalt a baix sense solapar-se
      const sorted = [...items].sort((a, b) => yOf(a.p) - yOf(b.p));
      let nextFree = 0, maxY = yOf(SOUTH) + 30;
      for (const it of sorted) {
        const tx = texts(it, time, true); // al mòbil, el sentit ja el diu la fletxa
        const cy = yOf(it.p);
        const bh = tx.arrive ? 54 : 38;
        const by = Math.max(cy - bh / 2, nextFree);
        nextFree = by + bh + 6;
        maxY = Math.max(maxY, by + bh + 10);
        const g = wrap(it);
        mk(g, "path", { d: `M ${TX} ${cy} L ${BOXX - 8} ${cy} L ${BOXX} ${by + bh / 2}`, fill: "none", stroke: it.trip.color, "stroke-width": 2, "stroke-dasharray": "3 3" });
        dot(g, it, TX, cy);
        drawLabel(g, it, tx, BOXX, by, BOXW, bh, it.up ? "↑ " : "↓ ", true);
      }
      svg.setAttribute("viewBox", `0 0 ${VW} ${maxY}`);
    }
    return { count: items.length, next, items };
  }

  drawTrack((svg.parentElement?.clientWidth || 1000) < 640);
  return { render, mmss, gpsUrl };
};
