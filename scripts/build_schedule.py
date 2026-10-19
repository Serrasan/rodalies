"""Construeix data/schedule.json amb els trens que paren a les dues estacions del config.

Combina dos horaris de Renfe:
  - Rodalies (R14, R15, R16...): fitxer de Cercanías/Rodalies.
  - Regional Exprés: fitxer de mitja i llarga distància. Són els mateixos trens però de vegades amb un
    altre número, i n'hi ha que no surten a l'horari de Rodalies. S'emparellen per sentit i hora de
    sortida (±3 min); els que no tenen parella s'afegeixen com a línia "RE".

Ús: python scripts/build_schedule.py [zip_rodalies] [zip_regional_expres]
Si no es passen els zips, es baixen de Renfe.
"""
import csv
import datetime as dt
import io
import json
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "schedule.json"
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
RE_COLOR = "#4F5B66"   # Regional Exprés sense línia de Rodalies
MATCH_S = 180          # marge per considerar que dos trens són el mateix (mateix sentit i hora de sortida)


def rows(zf, name):
    """Llegeix un CSV del GTFS. Renfe omple els camps amb espais: els treu."""
    if name not in zf.namelist():
        return
    with zf.open(name) as fh:
        reader = csv.reader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""))
        header = [h.strip() for h in next(reader)]
        for r in reader:
            if r:
                yield dict(zip(header, (c.strip() for c in r)))


def gtfs_seconds(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 3600 + m * 60 + s


def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "rodalies-app/1.0"})
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    with urllib.request.urlopen(req, timeout=180) as r:
        while chunk := r.read(1 << 20):
            tmp.write(chunk)
    tmp.close()
    return tmp.name


def read_trips(zip_path, dates, a_id, b_id):
    """Viatges d'un GTFS que passen per A i per B en alguna de les dates. Retorna (viatges, estacions, línies)."""
    with zipfile.ZipFile(zip_path) as zf:
        services = {}
        for c in rows(zf, "calendar.txt"):
            start = dt.datetime.strptime(c["start_date"], "%Y%m%d").date()
            end = dt.datetime.strptime(c["end_date"], "%Y%m%d").date()
            for d in dates:
                if start <= d <= end and c[WEEKDAYS[d.weekday()]] == "1":
                    services.setdefault(c["service_id"], set()).add(d)
        for c in rows(zf, "calendar_dates.txt") or []:  # excepcions (només al fitxer de mitja distància)
            d = dt.datetime.strptime(c["date"], "%Y%m%d").date()
            if d in dates:
                if c["exception_type"] == "1":
                    services.setdefault(c["service_id"], set()).add(d)
                else:
                    services.get(c["service_id"], set()).discard(d)

        routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
        trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if services.get(t["service_id"])}

        seen = {}
        for st in rows(zf, "stop_times.txt"):
            if st["stop_id"] in (a_id, b_id) and st["trip_id"] in trips:
                seen.setdefault(st["trip_id"], {})[st["stop_id"]] = int(st["stop_sequence"])
        keep = {tid for tid, s in seen.items() if a_id in s and b_id in s}

        stop_lists = {}
        for st in rows(zf, "stop_times.txt"):
            if st["trip_id"] in keep:
                stop_lists.setdefault(st["trip_id"], []).append(
                    (int(st["stop_sequence"]), st["stop_id"], st["arrival_time"], st["departure_time"]))

        used = {s[1] for lst in stop_lists.values() for s in lst}
        stops = {s["stop_id"]: [s["stop_name"], round(float(s["stop_lat"]), 6), round(float(s["stop_lon"]), 6)]
                 for s in rows(zf, "stops.txt") if s["stop_id"] in used}

    out = []
    for tid in keep:
        t = trips[tid]
        lst = sorted(stop_lists[tid])
        direction = "AB" if seen[tid][a_id] < seen[tid][b_id] else "BA"
        out.append({"tid": tid, "route": routes.get(t["route_id"], {}), "dir": direction,
                    "stops": lst, "dates": sorted(services[t["service_id"]])})
    return out, stops, routes


def materialize(raw, d, tz, a_id, b_id):
    """Passa les hores GTFS d'un viatge a segons UNIX per a la data `d`."""
    base = int(dt.datetime(d.year, d.month, d.day, tzinfo=tz).timestamp())
    stop_rows = [[sid, base + gtfs_seconds(arr), base + gtfs_seconds(dep)] for _, sid, arr, dep in raw["stops"]]
    origin, dest = (a_id, b_id) if raw["dir"] == "AB" else (b_id, a_id)
    return stop_rows, next(r[2] for r in stop_rows if r[0] == origin), next(r[1] for r in stop_rows if r[0] == dest)


def main():
    tz = ZoneInfo(CONFIG["timezone"])
    a_id = CONFIG["stations"]["A"]["id"]
    b_id = CONFIG["stations"]["B"]["id"]
    zip_rod = sys.argv[1] if len(sys.argv) > 1 else download(CONFIG["gtfs_url"])
    today = dt.datetime.now(tz).date()
    dates = [today + dt.timedelta(days=i) for i in range(CONFIG["days"])]

    raw_rod, stops, routes = read_trips(zip_rod, dates, a_id, b_id)
    out_trips = []
    for raw in raw_rod:
        tid = raw["tid"]
        for d in raw["dates"]:
            stop_rows, dep_ts, arr_ts = materialize(raw, d, tz, a_id, b_id)
            out_trips.append({
                "id": tid, "key": tid[5:],
                "train": "".join(ch for ch in tid[5:] if ch.isdigit())[:5],
                "line": raw["route"].get("route_short_name") or tid[-3:],
                "color": "#" + (raw["route"].get("route_color") or "666666"),
                "date": d.isoformat(), "dir": raw["dir"], "dep": dep_ts, "arr": arr_ts,
                "from": stop_rows[0][0], "to": stop_rows[-1][0], "stops": stop_rows, "ld": [],
            })

    # Regional Exprés (mitja distància): emparellar per sentit i hora de sortida, afegir els que falten
    added = 0
    ld_url = CONFIG.get("gtfs_ld_url")
    zip_ld = sys.argv[2] if len(sys.argv) > 2 else (download(ld_url) if ld_url else None)
    if zip_ld:
        raw_ld, stops_ld, _ = read_trips(zip_ld, dates, a_id, b_id)
        for sid, v in stops_ld.items():
            stops.setdefault(sid, v)
        for raw in raw_ld:
            train = raw["tid"][:5]
            for d in raw["dates"]:
                stop_rows, dep_ts, arr_ts = materialize(raw, d, tz, a_id, b_id)
                match = next((t for t in out_trips if t["date"] == d.isoformat() and t["dir"] == raw["dir"]
                              and abs(t["dep"] - dep_ts) <= MATCH_S), None)
                if match:
                    if train not in match["ld"]:
                        match["ld"].append(train)
                    continue
                added += 1
                out_trips.append({
                    "id": f"LD{train}-{d.isoformat()}", "key": f"{train}RE", "train": train,
                    "line": "RE", "color": RE_COLOR, "date": d.isoformat(), "dir": raw["dir"],
                    "dep": dep_ts, "arr": arr_ts, "from": stop_rows[0][0], "to": stop_rows[-1][0],
                    "stops": stop_rows, "ld": [train],
                })

    out_trips.sort(key=lambda x: x["dep"])
    line_colors = {r["route_short_name"]: "#" + (r.get("route_color") or "666666")
                   for r in routes.values() if r["route_id"].startswith("51") and r.get("route_short_name")}
    line_colors["RE"] = RE_COLOR
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": int(dt.datetime.now(tz).timestamp()),
        "dates": [d.isoformat() for d in dates],
        "stations": CONFIG["stations"],
        "stops": stops,
        "line_colors": line_colors,
        "trips": out_trips,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_ab = sum(1 for t in out_trips if t["dir"] == "AB")
    print(f"schedule.json: {len(out_trips)} trens ({n_ab} A→B, {len(out_trips) - n_ab} B→A), "
          f"{added} Regional Exprés afegits que no eren a l'horari de Rodalies")


if __name__ == "__main__":
    main()
