#!/usr/bin/env python3
"""Show raw PlayHQ responses so we know what fields actually come back."""
import json
from urllib import request, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"
BASE    = "https://api.playhq.com"

# Premier A Women's grade + one known game from your last log
GRADE_ID = "2ed24d43-8720-42aa-9483-c0e8e65be568"
GAME_ID  = "b476af7a-2930-459c-818d-a4b4da4f3062"

HEADERS = {
    "x-api-key": API_KEY, "x-phq-tenant": TENANT, "Accept": "application/json"
}

def hit(path):
    print(f"\n=== GET {path} ===")
    try:
        with request.urlopen(request.Request(BASE + path, headers=HEADERS), timeout=20) as r:
            data = json.loads(r.read())
            # Print just the first item to keep it readable
            if isinstance(data.get("data"), list) and data["data"]:
                print("First item only:")
                print(json.dumps(data["data"][0], indent=2)[:3000])
            else:
                print(json.dumps(data, indent=2)[:3000])
    except error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode('utf-8','ignore')[:300]}")
    except Exception as e:
        print(f"ERR {e}")

hit(f"/v2/grades/{GRADE_ID}/games")          # fixture (we know this works)
hit(f"/v2/games/{GAME_ID}/summary")          # v2 summary (try this)
hit(f"/v1/games/{GAME_ID}/summary")          # v1 summary (already 404'd, sanity check)
hit(f"/v2/grades/{GRADE_ID}/ladder")         # ladder (fallback option)
