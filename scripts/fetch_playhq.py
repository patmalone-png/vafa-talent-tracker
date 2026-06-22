#!/usr/bin/env python3
"""
PlayHQ fetcher for VAFA Talent ID.
Pulls VAFA Women's competition fixtures + player stats and writes:
  data/games.json
  data/players.json
API key is baked in per user request.
"""
import json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, parse, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"
BASE    = "https://api.playhq.com/v1"

COMP_HINT   = "VAFA"           # competition search term
GRADE_HINT  = "Women"          # grade filter
SEASON_HINT = "2025"           # season filter

HEADERS = {
    "x-api-key": API_KEY,
    "x-phq-tenant": TENANT,
    "Accept": "application/json",
    "User-Agent": "vafa-talent-id/1.0",
}

ROOT = Path(__file__).resolve().parents[1]
OUT_GAMES   = ROOT / "data" / "games.json"
OUT_PLAYERS = ROOT / "data" / "players.json"


def banner():
    print("=" * 64)
    print(" VAFA Talent ID — PlayHQ fetch")
    print(f" Time   : {datetime.now(timezone.utc).isoformat()}")
    print(f" Tenant : {TENANT}")
    print(f" Key    : {API_KEY[:8]}…")
    print(f" Out    : {OUT_GAMES.name}, {OUT_PLAYERS.name}")
    print("=" * 64)


def get(path, params=None):
    url = BASE + path
    if params:
        url += "?" + parse.urlencode(params)
    req = request.Request(url, headers=HEADERS)
    with request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def safe_get(path, params=None):
    try:
        return get(path, params)
    except error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")[:200]
        print(f"  HTTP {e.code} {path}: {body}")
    except Exception as e:
        print(f"  ERR  {path}: {e}")
    return {}


def find_competition():
    print(f"Searching competitions for {COMP_HINT!r}…")
    data = safe_get("/competitions", {"search": COMP_HINT})
    comps = data.get("data", [])
    if not comps:
        print("  no competitions returned")
        return None
    chosen = next((c for c in comps if COMP_HINT.lower() in (c.get("name") or "").lower()), comps[0])
    print(f"  → using {chosen.get('name')}  id={chosen.get('id')}")
    return chosen


def list_seasons(comp_id):
    data = safe_get(f"/competitions/{comp_id}/seasons")
    return data.get("data", [])


def list_grades(season_id):
    data = safe_get(f"/seasons/{season_id}/grades")
    return data.get("data", [])


def list_fixtures(grade_id):
    out, cursor = [], None
    for _ in range(50):
        params = {"cursor": cursor} if cursor else None
        page = safe_get(f"/grades/{grade_id}/fixture", params)
        out.extend(page.get("data", []))
        cursor = (page.get("metadata") or {}).get("nextCursor")
        if not cursor:
            break
        time.sleep(0.2)
    return out


def list_game_stats(game_id):
    return safe_get(f"/games/{game_id}/statistics").get("data", []) or []


def aggregate_players(games_with_stats):
    """Roll per-game stats up to per-player aggregate + history."""
    players = {}
    for g in games_with_stats:
        for row in g.get("_stats", []):
            pid = row.get("playerId") or row.get("id")
            if not pid:
                continue
            p = players.setdefault(pid, {
                "id": pid,
                "name": row.get("playerName") or row.get("name") or "Unknown",
                "club": row.get("teamName") or "",
                "position": row.get("position") or "",
                "games": 0,
                "stats": {"goals":0,"disposals":0,"contested":0,"marks":0,"tackles":0,"clearances":0,"inside50":0},
                "history": [],
            })
            s = row.get("statistics") or row.get("stats") or {}
            entry = {
                "date":       g.get("date"),
                "opponent":   g.get("away") if row.get("teamName")==g.get("home") else g.get("home"),
                "goals":      int(s.get("goals") or 0),
                "disposals":  int(s.get("disposals") or 0),
                "contested":  int(s.get("contestedPossessions") or s.get("contested") or 0),
                "marks":      int(s.get("marks") or 0),
                "tackles":    int(s.get("tackles") or 0),
                "clearances": int(s.get("clearances") or 0),
                "inside50":   int(s.get("inside50s") or s.get("inside50") or 0),
            }
            for k in ("goals","disposals","contested","marks","tackles","clearances","inside50"):
                p["stats"][k] += entry[k]
            p["games"] += 1
            # talent score for this game (mirrors front-end weighting)
            entry["talentScore"] = round(
                entry["goals"]*6 + entry["contested"]*1.2 + entry["clearances"]*2 +
                entry["tackles"]*1.5 + entry["inside50"] + entry["marks"]*0.8 + entry["disposals"]*0.3, 1)
            p["history"].append(entry)
    return list(players.values())


def main():
    banner()
    comp = find_competition()
    games_out, players_out = [], []
    if not comp:
        print("No competition found — writing empty data files.")
    else:
        seasons = [s for s in list_seasons(comp["id"]) if SEASON_HINT in (s.get("name") or "")] or list_seasons(comp["id"])
        print(f"Seasons: {[s.get('name') for s in seasons]}")
        all_games = []
        for s in seasons:
            grades = [g for g in list_grades(s["id"]) if GRADE_HINT.lower() in (g.get("name") or "").lower()] or list_grades(s["id"])
            for gr in grades:
                fx = list_fixtures(gr["id"])
                print(f"  · {s.get('name')} / {gr.get('name')}: {len(fx)} fixtures")
                for g in fx:
                    entry = {
                        "id":      g.get("id"),
                        "season":  s.get("name"),
                        "grade":   gr.get("name"),
                        "round":   (g.get("round") or {}).get("name"),
                        "date":    (g.get("schedule") or {}).get("date"),
                        "time":    (g.get("schedule") or {}).get("time"),
                        "venue":   (g.get("venue") or {}).get("name"),
                        "home":    (g.get("homeTeam") or {}).get("name"),
                        "away":    (g.get("awayTeam") or {}).get("name"),
                        "status":  g.get("status"),
                    }
                    if entry["status"] in ("FINAL","FINAL_RESULT","COMPLETED"):
                        entry["_stats"] = list_game_stats(g["id"])
                    else:
                        entry["_stats"] = []
                    all_games.append(entry)
                    time.sleep(0.1)
        players_out = aggregate_players(all_games)
        # strip private _stats before writing games.json
        games_out = [{k:v for k,v in g.items() if k != "_stats"} for g in all_games]

    OUT_GAMES.parent.mkdir(parents=True, exist_ok=True)
    OUT_GAMES.write_text(json.dumps(games_out, indent=2))
    OUT_PLAYERS.write_text(json.dumps(players_out, indent=2))
    print(f"Wrote {len(games_out)} games, {len(players_out)} players")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}")
        # never block the workflow on a fetch failure
        if not OUT_GAMES.exists():   OUT_GAMES.write_text("[]\n")
        if not OUT_PLAYERS.exists(): OUT_PLAYERS.write_text("[]\n")
        sys.exit(0)
