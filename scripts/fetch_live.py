"""Baixa els feeds en temps real de Renfe i escriu data/live.json
només amb el que afecta els trens de data/schedule.json."""
import datetime as dt
import json
import re
import time
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
SCHEDULE = json.loads((ROOT / "data" / "schedule.json").read_text(encoding="utf-8"))
OUT = ROOT / "data" / "live.json"
LINE_RE = re.compile(r"(R[A-Z]?\d+[NS]?)$")  # línia al final del codi del tren: R1, R2S, R16, RG1, RT2...
LATE_S = 5 * 60  # a partir de 5 minuts es compta com a tren amb retard


def get_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "rodalies-app/1.0", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def text_of(obj, prefer=("ca", "es")):
    tr = (obj or {}).get("translation") or []
    for lang in prefer:
        for t in tr:
            if (t.get("language") or "").lower().startswith(lang):
                return t.get("text", "").strip()
    return (tr[0].get("text", "").strip() if tr else "")


def main():
    tz = ZoneInfo(CONFIG["timezone"])
    now = dt.datetime.now(tz)
    today = now.date().isoformat()

    by_id = {t["id"]: t for t in SCHEDULE["trips"]}
    # Si el feed en temps real usa un altre codi de servei, s'enllaça per número de tren + línia del dia
    by_key = {}
    for t in SCHEDULE["trips"]:
        if t["date"] == today or t["key"] not in by_key:
            by_key[t["key"]] = t

    def match(trip_id):
        if not trip_id:
            return None
        return by_id.get(trip_id) or by_key.get(trip_id[5:])

    lines = {t["line"] for t in SCHEDULE["trips"]}
    station_ids = {s["id"] for s in CONFIG["stations"].values()}
    station_ids |= {s["id"] for side in (CONFIG.get("options") or {}).values() for s in side}
    out = {"generated": int(now.timestamp()), "feeds": {}, "trips": {}, "vehicles": {}, "alerts": [], "network": {}, "errors": []}

    try:
        tu = get_json(CONFIG["rt"]["trip_updates"])
        out["feeds"]["trip_updates"] = int(tu.get("header", {}).get("timestamp", 0))
        net = {}
        for e in tu.get("entity", []):
            u = e.get("tripUpdate") or {}
            trip = u.get("trip") or {}
            # Estat general: tots els trens de Rodalies de Catalunya (codis que comencen per 51)
            tid = trip.get("tripId") or ""
            m = LINE_RE.search(tid)
            if tid.startswith("51") and m:
                ln = m.group(1)
                agg = net.setdefault(ln, {"trains": 0, "late": 0, "canceled": 0, "delay_sum": 0, "max": 0})
                if trip.get("scheduleRelationship") == "CANCELED":
                    agg["canceled"] += 1
                else:
                    d = u.get("delay")
                    if d is None:
                        d = next(((s.get("arrival") or s.get("departure") or {}).get("delay") for s in u.get("stopTimeUpdate") or []
                                  if (s.get("arrival") or s.get("departure") or {}).get("delay") is not None), 0)
                    d = max(int(d or 0), 0)
                    agg["trains"] += 1
                    agg["delay_sum"] += d
                    agg["max"] = max(agg["max"], d)
                    if d > LATE_S:
                        agg["late"] += 1
            t = match(tid)
            if not t:
                continue
            info = {"delay": None, "canceled": trip.get("scheduleRelationship") == "CANCELED", "skipped": [], "next": None}
            for s in u.get("stopTimeUpdate") or []:
                if s.get("scheduleRelationship") == "SKIPPED":
                    info["skipped"].append(s.get("stopId"))
                    continue
                ev = s.get("arrival") or s.get("departure") or {}
                if info["next"] is None and s.get("stopId"):
                    info["next"] = {"stop": s.get("stopId"), "time": int(ev["time"]) if ev.get("time") else None}
                if info["delay"] is None and ev.get("delay") is not None:
                    info["delay"] = int(ev["delay"])
            if info["delay"] is None and u.get("delay") is not None:
                info["delay"] = int(u["delay"])
            out["trips"][t["id"]] = info
        out["network"] = {
            ln: {"trains": a["trains"], "late": a["late"], "canceled": a["canceled"],
                 "avg": round(a["delay_sum"] / a["trains"]) if a["trains"] else 0, "max": a["max"]}
            for ln, a in sorted(net.items())
        }
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"retards: {e}")

    try:
        vp = get_json(CONFIG["rt"]["vehicle_positions"])
        out["feeds"]["vehicle_positions"] = int(vp.get("header", {}).get("timestamp", 0))
        for e in vp.get("entity", []):
            v = e.get("vehicle") or {}
            t = match((v.get("trip") or {}).get("tripId"))
            pos = v.get("position") or {}
            if not t or pos.get("latitude") is None:
                continue
            out["vehicles"][t["id"]] = {
                "lat": round(float(pos["latitude"]), 6),
                "lon": round(float(pos["longitude"]), 6),
                "stop": v.get("stopId"),
                "status": v.get("currentStatus"),
                "ts": int(v.get("timestamp", 0) or 0),
            }
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"posicions: {e}")

    # Canal de mitja distància: els Regional Exprés són els mateixos trens (mateix número) i de vegades
    # només surten aquí. Omple els que falten al canal de Rodalies. Codi del tren: els 5 primers dígits.
    # Número de tren al canal de mitja distància -> tren de l'horari. L'horari ja els ha emparellat per hora
    # ("ld"); si no, s'agafa el mateix número.
    by_train = {}
    for t in SCHEDULE["trips"]:
        if t["date"] == today or t["train"] not in by_train:
            by_train[t["train"]] = t
    for t in SCHEDULE["trips"]:  # l'emparellament per hora té prioritat sobre el número
        for n in t.get("ld") or []:
            if t["date"] == today or n not in by_train:
                by_train[n] = t
    try:
        tu_ld = get_json(CONFIG["rt"]["trip_updates_ld"])
        for e in tu_ld.get("entity", []):
            u = e.get("tripUpdate") or {}
            trip = u.get("trip") or {}
            t = by_train.get(str(trip.get("tripId") or "")[:5])
            if not t or t["id"] in out["trips"]:
                continue
            info = {"delay": None, "canceled": trip.get("scheduleRelationship") == "CANCELED", "skipped": [], "next": None, "source": "ld"}
            for s in u.get("stopTimeUpdate") or []:
                if s.get("scheduleRelationship") == "SKIPPED":
                    info["skipped"].append(s.get("stopId"))
                    continue
                ev = s.get("arrival") or s.get("departure") or {}
                if info["next"] is None and s.get("stopId"):
                    info["next"] = {"stop": s.get("stopId"), "time": int(ev["time"]) if ev.get("time") else None}
                if info["delay"] is None and ev.get("delay") is not None:
                    info["delay"] = int(ev["delay"])
            if info["delay"] is None and u.get("delay") is not None:
                info["delay"] = int(u["delay"])
            out["trips"][t["id"]] = info
        vp_ld = get_json(CONFIG["rt"]["vehicle_positions_ld"])
        for e in vp_ld.get("entity", []):
            v = e.get("vehicle") or {}
            t = by_train.get(str((v.get("trip") or {}).get("tripId") or "")[:5])
            pos = v.get("position") or {}
            if not t or t["id"] in out["vehicles"] or pos.get("latitude") is None:
                continue
            out["vehicles"][t["id"]] = {
                "lat": round(float(pos["latitude"]), 6), "lon": round(float(pos["longitude"]), 6),
                "stop": v.get("stopId"), "status": v.get("currentStatus"),
                "ts": int(v.get("timestamp", 0) or 0) or out["generated"],
            }
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"mitja distància: {e}")

    try:
        al = get_json(CONFIG["rt"]["alerts"])
        out["feeds"]["alerts"] = int(al.get("header", {}).get("timestamp", 0))
        now_ts = int(now.timestamp())
        for e in al.get("entity", []):
            a = e.get("alert") or {}
            ents = a.get("informedEntity") or []
            hit_lines = sorted({ln for ie in ents for ln in lines if (ie.get("routeId") or "").strip().endswith(ln)})
            hit_stop = any((ie.get("stopId") or "").strip() in station_ids for ie in ents)
            if not hit_lines and not hit_stop:
                continue
            periods = a.get("activePeriod") or [{}]
            active = any(int(p.get("start", 0) or 0) <= now_ts <= int(p.get("end", 0) or 4102444800) for p in periods)
            if not active:
                continue
            out["alerts"].append({
                "id": e.get("id"),
                "lines": hit_lines,
                "header": text_of(a.get("headerText")),
                "text": text_of(a.get("descriptionText")),
                "start": int(periods[0].get("start", 0) or 0),
                "end": int(periods[0].get("end", 0) or 0) or None,
            })
    except Exception as e:  # noqa: BLE001
        out["errors"].append(f"incidències: {e}")

    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"live.json: {len(out['trips'])} trens amb dades, {len(out['vehicles'])} posicions, "
          f"{len(out['alerts'])} incidències, errors: {out['errors'] or 'cap'}")


if __name__ == "__main__":
    main()
