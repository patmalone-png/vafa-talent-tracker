#!/usr/bin/env python3
"""
PlayHQ fetcher for VAFA Talent ID.
Pulls fixtures + game stats for the six VAFA Women's grades we care about
and writes data/games.json + data/players.json.
"""
import json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, parse, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"
BASE    = "https://api.playhq.com/v1"

SEASON_ID   = "2af0bc11-6f71-4c82-93b5-d46fe9bc739f"   # VAFA 2026
SEASON_NAME = "2026"

# Six Women's grades for 2026
GRADES = [
    ("Premier A Women's",       "2ed24d43-8720-42aa-9483-c0e8e65be568"),
    ("Premier A Women's Reserve","bbcf04d5-ec88-4f37-90f8-460ddcc71cc9"),
    ("Premier B Women's",       "972de8ed-8555-42ce-91de-660850b3e7ea"),
    ("Division 1 Women's",      "dae84ac0-533d-4dee-8518-10db71bbf0e3"),
    ("Division 2 Women's",      "a63e5b85-0505-4423-8d49-0c31bb0a4343"),
    ("Division 3 Women's",      "55ad642b-5f09-48a4-b147-77b89639b968"),
    ("Division 4 Women's",      "5d67b06e-119c-4180-8dfc-82387a955e61"),
    ("Division 5 Women's",      "6c9deafe-cc66-48f0-9f0f-0b69c594ea50"),
]

HEADERS = {
    "x-api-key": API_KEY,
    "x-phq-tenant": TENANT,
    "Accept": "application/json",
    "User-Agent": "vafa-talent-id/1.1",
}

ROOT = Path(__file__).resolve().parents[1]
OUT_GAMES   = ROOT / "data" / "games.json"
OUT_PLAYERS = ROOT / "data" / "players.json"


def banner():
    print("=" * 68)
    print(" VAFA Talent ID — PlayHQ fetch")
    print(f" Time   : {datetime.now(timezone.utc).isoformat()}")
    print(f" Tenant : {TENANT}")
    print(f" Key    : {API_KEY[:8]}…")
    print(f" Season : {SEASON_NAME} ({SEASON_ID})")
    print(f" Grades : {len(GRADES)} women's grades")
    print("=" * 68)


def get(path, params=None):
    url = BASE + path
    if params:
        url += "?" + parse.urlencode(params)
    req = request.Request(url, headers=HEADERS)
    try:
        with request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8")), r.status
    except error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")[:200]
        print(f"  HTTP {e.code} {path}: {body}")
        return None, e.code
    except Exception as e:
        print(f"  ERR  {path}: {e}")
        return None, 0


def list_fixture(grade_id):
    """Walk the cursor-paginated fixture endpoint."""
    out, cursor = [], None
    for _ in range(50):
        params = {"cursor": cursor} if cursor else None
        data, status = get(f"/grades/{grade_id}/games", params)
        if not data:
            break
        out.extend(data.get("data", []))
        cursor = (data.get("metadata") or {}).get("nextCursor")
        if not cursor:
            break
        time.sleep(0.2)
    return out


def list_game_stats(game_id):
    data, status = get(f"/games/{game_id}/statistics")
    if not data:
        return []
    # The shape varies — return whatever rows look like player stats
    rows = data.get("data") or []
    flat = []
    for team in rows if isinstance(rows, list) else []:
        team_name = (team.get("team") or {}).get("name") if isinstance(team, dict) else None
        for p in (team.get("players") or []) if isinstance(team, dict) else []:
            flat.append({
                "playerId":   p.get("id") or p.get("playerId"),
                "playerName": p.get("name") or p.get("displayName"),
                "teamName":   team_name,
                "position":   p.get("position"),
                "statistics": p.get("statistics") or p.get("stats") or {},
            })
    return flat


def aggregate_players(games_with_stats):
    players = {}
    for g in games_with_stats:
        for row in g.get("_stats", []):
            pid = row.get("playerId")
            if not pid:
                continue
            p = players.setdefault(pid, {
                "id": pid,
                "name": row.get("playerName") or "Unknown",
                "club": row.get("teamName") or "",
                "position": row.get("position") or "",
                "grade": g.get("grade"),
                "games": 0,
                "stats": {"goals":0,"disposals":0,"contested":0,"marks":0,"tackles":0,"clearances":0,"inside50":0},
                "history": [],
            })
            s = row.get("statistics") or {}
            entry = {
                "date":       g.get("date"),
                "round":      g.get("round"),
                "grade":      g.get("grade"),
                "opponent":   g.get("away") if row.get("teamName") == g.get("home") else g.get("home"),
                "goals":      int(s.get("goals") or 0),
                "disposals":  int(s.get("disposals") or s.get("totalDisposals") or 0),
                "contested":  int(s.get("contestedPossessions") or s.get("contested") or 0),
                "marks":      int(s.get("marks") or 0),
                "tackles":    int(s.get("tackles") or 0),
                "clearances": int(s.get("clearances") or 0),
                "inside50":   int(s.get("inside50s") or s.get("inside50") or 0),
            }
            for k in ("goals","disposals","contested","marks","tackles","clearances","inside50"):
                p["stats"][k] += entry[k]
            p["games"] += 1
            entry["talentScore"] = round(
                entry["goals"]*6 + entry["contested"]*1.2 + entry["clearances"]*2 +
                entry["tackles"]*1.5 + entry["inside50"] + entry["marks"]*0.8 + entry["disposals"]*0.3, 1)
            p["history"].append(entry)
    return list(players.values())


def main():
    banner()
    all_games = []
    for grade_name, grade_id in GRADES:
        print(f"\n→ {grade_name}  ({grade_id[:8]}…)")
        fx = list_fixture(grade_id)
        print(f"   fixtures: {len(fx)}")
        for g in fx:
            entry = {
                "id":     g.get("id"),
                "season": SEASON_NAME,
                "grade":  grade_name,
                "round":  (g.get("round") or {}).get("name"),
                "date":   (g.get("schedule") or {}).get("date"),
                "time":   (g.get("schedule") or {}).get("time"),
                "venue":  (g.get("venue") or {}).get("name"),
                "home":   (g.get("homeTeam") or {}).get("name"),
                "away":   (g.get("awayTeam") or {}).get("name"),
                "status": g.get("status"),
            }
            # Only fetch stats for completed games
            if str(entry["status"] or "").upper() in ("FINAL", "FINAL_RESULT", "COMPLETED"):
                entry["_stats"] = list_game_stats(g["id"])
            else:
                entry["_stats"] = []
            all_games.append(entry)
            time.sleep(0.1)

    players_out = aggregate_players(all_games)
    games_out   = [{k:v for k,v in g.items() if k != "_stats"} for g in all_games]

    OUT_GAMES.parent.mkdir(parents=True, exist_ok=True)
    OUT_GAMES.write_text(json.dumps(games_out, indent=2))
    OUT_PLAYERS.write_text(json.dumps(players_out, indent=2))

    print("\n" + "=" * 68)
    print(f" Wrote {len(games_out)} games, {len(players_out)} players")
    print(f"  → {OUT_GAMES}")
    print(f"  → {OUT_PLAYERS}")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}")
        if not OUT_GAMES.exists():   OUT_GAMES.write_text("[]\n")
        if not OUT_PLAYERS.exists(): OUT_PLAYERS.write_text("[]\n")
        sys.exit(0)
