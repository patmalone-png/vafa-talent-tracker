#!/usr/bin/env python3
"""Standalone: fetch official PlayHQ ladders only. Writes data/ladders.json"""
import json, sys
from pathlib import Path
from urllib import request, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"
BASE    = "https://api.playhq.com"

GRADES = [
    ("Premier A Women's",         "2ed24d43-8720-42aa-9483-c0e8e65be568"),
    ("Premier A Women's Reserve", "bbcf04d5-ec88-4f37-90f8-460ddcc71cc9"),
    ("Premier B Women's",         "972de8ed-8555-42ce-91de-660850b3e7ea"),
    ("Division 1 Women's",        "dae84ac0-533d-4dee-8518-10db71bbf0e3"),
    ("Division 2 Women's",        "a63e5b85-0505-4423-8d49-0c31bb0a4343"),
    ("Division 3 Women's",        "55ad642b-5f09-48a4-b147-77b89639b968"),
    ("Division 4 Women's",        "5d67b06e-119c-4180-8dfc-82387a955e61"),
    ("Division 5 Women's",        "6c9deafe-cc66-48f0-9f0f-0b69c594ea50"),
]

HEADERS = {
    "x-api-key": API_KEY,
    "x-phq-tenant": TENANT,
    "Accept": "application/json",
    "User-Agent": "vafa-ladders/1.0",
}

ROOT = Path(__file__).resolve().parents[1]
OUT  = ROOT / "data" / "ladders.json"


def get(path):
    req = request.Request(BASE + path, headers=HEADERS)
    try:
        with request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except error.HTTPError as e:
        print(f"  HTTP {e.code} {path}")
        return None
    except Exception as e:
        print(f"  ERR {path}: {e}")
        return None


def main():
    print("Fetching official ladders...")
    all_rows = []
    for grade_name, grade_id in GRADES:
        data = get(f"/v2/grades/{grade_id}/ladder")
        if not data:
            print(f"  {grade_name}: no data")
            continue
        ladders = data.get("ladders") or []
        count = 0
        for lad in ladders:
            headers = [h.get("key") for h in (lad.get("headers") or [])]
            for i, s in enumerate(lad.get("standings") or []):
                team = s.get("team") or {}
                vals = dict(zip(headers, s.get("values") or []))
                all_rows.append({
                    "grade": grade_name,
                    "position": i + 1,
                    "team": team.get("name", ""),
                    "raw": vals,   # keep everything so we can see the real field names
                })
                count += 1
        print(f"  {grade_name}: {count} rows")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(all_rows, indent=2))
    print(f"\nWrote {len(all_rows)} rows to {OUT}")
    # Print first entry so we can see the field structure
    if all_rows:
        print("\nSample entry:")
        print(json.dumps(all_rows[0], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
