"""Construeix data/schedule.json amb els trens que paren a les dues estacions del config.

Ús: python scripts/build_schedule.py [ruta_zip_gtfs]
Si no es passa cap zip, el baixa de Renfe.
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


def rows(zf, name):
    """Llegeix un CSV del GTFS. Renfe omple els camps amb espais: els treu."""
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
    with urllib.request.urlopen(req, timeout=120) as r:
        while chunk := r.read(1 << 20):
            tmp.write(chunk)
    tmp.close()
    return tmp.name


def main():
    tz = ZoneInfo(CONFIG["timezone"])
    a_id = CONFIG["stations"]["A"]["id"]
    b_id = CONFIG["stations"]["B"]["id"]
    zip_path = sys.argv[1] if len(sys.argv) > 1 else download(CONFIG["gtfs_url"])

    today = dt.datetime.now(tz).date()
    dates = [today + dt.timedelta(days=i) for i in range(CONFIG["days"])]

    with zipfile.ZipFile(zip_path) as zf:
        # Serveis actius per data
        services = {}
        for c in rows(zf, "calendar.txt"):
            start = dt.datetime.strptime(c["start_date"], "%Y%m%d").date()
            end = dt.datetime.strptime(c["end_date"], "%Y%m%d").date()
            for d in dates:
                if start <= d <= end and c[WEEKDAYS[d.weekday()]] == "1":
                    services.setdefault(c["service_id"], []).append(d)

        routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
        trips = {}
        for t in rows(zf, "trips.txt"):
            if t["service_id"] in services:
                trips[t["trip_id"]] = t

        # Passada 1: viatges que passen per A i per B
        seen = {}
        for st in rows(zf, "stop_times.txt"):
            if st["stop_id"] in (a_id, b_id) and st["trip_id"] in trips:
                seen.setdefault(st["trip_id"], {})[st["stop_id"]] = int(st["stop_sequence"])
        keep = {tid for tid, s in seen.items() if a_id in s and b_id in s}

        # Passada 2: totes les parades d'aquests viatges (per al mapa i la parada següent)
        stop_lists = {}
        for st in rows(zf, "stop_times.txt"):
            if st["trip_id"] in keep:
                stop_lists.setdefault(st["trip_id"], []).append(
                    (int(st["stop_sequence"]), st["stop_id"], st["arrival_time"], st["departure_time"])
                )

        used_stops = {s[1] for lst in stop_lists.values() for s in lst}
        stops = {}
        for s in rows(zf, "stops.txt"):
            if s["stop_id"] in used_stops:
                stops[s["stop_id"]] = [s["stop_name"], round(float(s["stop_lat"]), 6), round(float(s["stop_lon"]), 6)]

    out_trips = []
    for tid in keep:
        t = trips[tid]
        route = routes.get(t["route_id"], {})
        lst = sorted(stop_lists[tid])
        seq = seen[tid]
        direction = "AB" if seq[a_id] < seq[b_id] else "BA"
        origin, dest = (a_id, b_id) if direction == "AB" else (b_id, a_id)
        for d in services[t["service_id"]]:
            midnight = dt.datetime(d.year, d.month, d.day, tzinfo=tz)
            base = int(midnight.timestamp())
            stop_rows = [[sid, base + gtfs_seconds(arr), base + gtfs_seconds(dep)] for _, sid, arr, dep in lst]
            dep_ts = next(r[2] for r in stop_rows if r[0] == origin)
            arr_ts = next(r[1] for r in stop_rows if r[0] == dest)
            out_trips.append({
                "id": tid,
                "key": tid[5:],
                "train": "".join(ch for ch in tid[5:] if ch.isdigit())[:5],
                "line": route.get("route_short_name") or tid[-3:],
                "color": "#" + (route.get("route_color") or "666666"),
                "date": d.isoformat(),
                "dir": direction,
                "dep": dep_ts,
                "arr": arr_ts,
                "from": lst[0][1],
                "to": lst[-1][1],
                "stops": stop_rows,
            })

    out_trips.sort(key=lambda x: x["dep"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated": int(dt.datetime.now(tz).timestamp()),
        "dates": [d.isoformat() for d in dates],
        "stations": CONFIG["stations"],
        "stops": stops,
        # Colors oficials de totes les línies de Rodalies de Catalunya (per a l'estat general)
        "line_colors": {r["route_short_name"]: "#" + (r.get("route_color") or "666666")
                        for r in routes.values() if r["route_id"].startswith("51") and r.get("route_short_name")},
        "trips": out_trips,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_ab = sum(1 for t in out_trips if t["dir"] == "AB")
    print(f"schedule.json: {len(out_trips)} trens ({n_ab} A→B, {len(out_trips) - n_ab} B→A)")


if __name__ == "__main__":
    main()
