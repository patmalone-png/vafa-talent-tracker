#!/usr/bin/env python3
"""
VAFA Talent ID - PlayHQ fetcher.
Pulls: fixtures (v2), per-game player appearances (v1 summary),
and the OFFICIAL ladder (v2) for each Women's grade.
Writes data/games.json, data/players.json, data/ladders.json
"""
import json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, parse, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"
BASE    = "https://api.playhq.com"

SEASON_NAME = "2026"

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
    "User-Agent": "vafa-talent-id/3.0",
}

ROOT = Path(__file__).resolve().parents[1]
OUT_GAMES   = ROOT / "data" / "games.json"
OUT_PLAYERS = ROOT / "data" / "players.json"
OUT_LADDERS = ROOT / "data" / "ladders.json"


def banner():
    print("=" * 70)
    print(" VAFA Talent ID - PlayHQ fetch v3.0 (with official ladders)")
    print(f" Time   : {datetime.now(timezone.utc).isoformat()}")
    print(f" Tenant : {TENANT}")
    print(f" Grades : {len(GRADES)}")
    print("=" * 70)


def get(path):
    url = BASE + path
    req = request.Request(url, headers=HEADERS)
    try:
        with request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except error.HTTPError as e:
        if e.code != 404:
            print(f"  HTTP {e.code} {path}: {e.read().decode('utf-8','ignore')[:160]}")
        return None
    except Exception as e:
        print(f"  ERR  {path}: {e}")
        return None


def list_grade_games(grade_id):
    """v2 fixture - returns list of rounds, each with games[]."""
    data = get(f"/v2/grades/{grade_id}/games")
    if not data:
        return []
    rounds = data.get("rounds") or []
    flat = []
    for r in rounds:
        for g in (r.get("games") or []):
            g["_round"] = r.get("name")
            flat.append(g)
    return flat


def game_summary(game_id):
    """v1 summary - returns appearances[]."""
    data = get(f"/v1/games/{game_id}/summary")
    if not data:
        return []
    return (data.get("data") or {}).get("appearances") or []


def grade_ladder(grade_id, grade_name):
    """v2 ladder - returns official standings for the grade."""
    data = get(f"/v2/grades/{grade_id}/ladder")
    rows = []
    if not data:
        return rows
    # The ladder payload usually has a "ladders" array (one per pool),
    # each with "standings". Fall back to top-level "data" if shape differs.
    ladders = data.get("ladders")
    if ladders:
        for lad in ladders:
            headers = [h.get("key") for h in (lad.get("headers") or [])]
            for i, s in enumerate(lad.get("standings") or []):
                team = s.get("team") or {}
                vals = dict(zip(headers, s.get("values") or []))
                rows.append({
                    "grade":      grade_name,
                    "position":   i + 1,
                    "team":       team.get("name", ""),
                    "played":     vals.get("played", 0),
                    "wins":       vals.get("won", 0),
                    "losses":     vals.get("lost", 0),
                    "draws":      vals.get("drawn", 0),
                    "byes":       vals.get("byes", 0),
                    "points":     vals.get("competitionPoints", 0),
                    "percentage": vals.get("percentage", 0),
                    "pointsFor":  vals.get("pointsFor", 0),
                    "pointsAgainst": vals.get("pointsAgainst", 0),
                    "matchRatio": vals.get("matchRatio", 0),
                })
    return rows


def extract_score(team):
    """Pull TOTAL_GOALS / TOTAL_BEHINDS / TOTAL_SCORE from match.teams[i]."""
    s = {"goals": 0, "behinds": 0, "points": 0}
    for st in ((team or {}).get("outcome") or {}).get("statistics") or []:
        t, v = st.get("type"), st.get("value", 0)
        if   t == "TOTAL_GOALS":   s["goals"]   = v
        elif t == "TOTAL_BEHINDS": s["behinds"] = v
        elif t == "TOTAL_SCORE":   s["points"]  = v
    return s


def main():
    banner()
    all_games   = []
    all_ladders = []
    appearances = []
    team_lookup = {}

    for grade_name, grade_id in GRADES:
        print(f"\n-> {grade_name}  ({grade_id[:8]}...)")

        # ----- Ladder (official) -----
        lad = grade_ladder(grade_id, grade_name)
        all_ladders.extend(lad)
        for row in lad:
            team_lookup.setdefault(row["team"], {"name": row["team"], "grade": grade_name})
        print(f"   ladder rows: {len(lad)}")

        # ----- Fixtures -----
        fixtures = list_grade_games(grade_id)
        print(f"   fixtures: {len(fixtures)}")
        finals = [g for g in fixtures if (g.get("status") or "").upper() == "FINAL"]

        for i, g in enumerate(finals, 1):
            match_teams = ((g.get("match") or {}).get("teams")) or []
            team_scores = {t.get("id"): extract_score(t) for t in match_teams}
            top_teams = g.get("teams") or []
            home_id = next((t.get("id") for t in top_teams if t.get("isHomeTeam")), None)
            away_id = next((t.get("id") for t in top_teams if not t.get("isHomeTeam")), None)
            schedule = (g.get("schedule") or [{}])[0]

            # We store flat homeTeam/awayTeam names + scores for the app.
            home_name = None
            away_name = None
            # PlayHQ v2 fixture doesn't always name teams inline; look up via ladder team ids if present
            # Fall back to the top_teams names if available
            for t in top_teams:
                nm = (t.get("name") or (t.get("team") or {}).get("name"))
                if t.get("isHomeTeam"):
                    home_name = nm
                else:
                    away_name = nm

            hs = team_scores.get(home_id, {}).get("points")
            as_ = team_scores.get(away_id, {}).get("points")

            all_games.append({
                "id":        g.get("id"),
                "season":    SEASON_NAME,
                "grade":     grade_name,
                "round":     g.get("_round"),
                "date":      (schedule.get("dateTime") or "")[:10],
                "dateTime":  schedule.get("dateTime"),
                "status":    "FINAL",
                "homeTeam":  home_name or "",
                "awayTeam":  away_name or "",
                "homeScore": hs,
                "awayScore": as_,
            })

            for app in game_summary(g["id"]):
                app["_gameId"]   = g.get("id")
                app["_grade"]    = grade_name
                app["_round"]    = g.get("_round")
                app["_dateTime"] = schedule.get("dateTime")
                appearances.append(app)

            if i % 15 == 0:
                print(f"   ...summarised {i}/{len(finals)}")
            time.sleep(0.05)

        # ----- Upcoming (non-final) fixtures -----
        for g in fixtures:
            if (g.get("status") or "").upper() == "FINAL":
                continue
            top_teams = g.get("teams") or []
            home_name = away_name = None
            for t in top_teams:
                nm = (t.get("name") or (t.get("team") or {}).get("name"))
                if t.get("isHomeTeam"):
                    home_name = nm
                else:
                    away_name = nm
            schedule = (g.get("schedule") or [{}])[0]
            all_games.append({
                "id":        g.get("id"),
                "season":    SEASON_NAME,
                "grade":     grade_name,
                "round":     g.get("_round"),
                "date":      (schedule.get("dateTime") or "")[:10],
                "dateTime":  schedule.get("dateTime"),
                "status":    g.get("status"),
                "homeTeam":  home_name or "",
                "awayTeam":  away_name or "",
                "homeScore": None,
                "awayScore": None,
            })

    # ----- Aggregate players -----
    players = {}
    for app in appearances:
        pid = app.get("id")
        if not pid:
            continue
        goals = sum(s.get("value", 0) for s in (app.get("scoreSubTotal") or [])
                    if s.get("type") == "6_POINT_SCORE") // 6
        bog = app.get("bestPlayer") or 0
        cap = app.get("captainRole")

        p = players.setdefault(pid, {
            "id": pid,
            "name": f"{app.get('firstName','')} {app.get('lastName','')}".strip(),
            "number": app.get("playerNumber"),
            "grade": app.get("_grade"),
            "club": "",  # club name not always on appearance; leave blank if absent
            "games": 0, "goals": 0, "bog": 0, "bogFirsts": 0,
            "bestCount": 0, "wins": 0, "captainGames": 0, "history": [],
        })
        p["games"] += 1
        p["goals"] += goals
        p["bog"]   += bog
        if bog == 6: p["bogFirsts"] += 1
        if bog > 0:  p["bestCount"]  += 1
        if cap: p["captainGames"] += 1
        gs = goals * 5 + bog * 8 + (6 if bog == 6 else 0)
        p["history"].append({
            "date": (app.get("_dateTime") or "")[:10],
            "round": app.get("_round"),
            "grade": app.get("_grade"),
            "goals": goals, "bog": bog, "inBest": bog > 0,
            "talentScore": gs,
        })

    for p in players.values():
        g = max(1, p["games"])
        raw = p["bog"]*8 + p["goals"]*5 + p["wins"]*2 + p["bogFirsts"]*6
        p["talentScore"] = round(raw / (g ** 0.5), 1)

    OUT_GAMES.parent.mkdir(parents=True, exist_ok=True)
    OUT_GAMES.write_text(json.dumps(all_games, indent=2))
    OUT_PLAYERS.write_text(json.dumps(list(players.values()), indent=2))
    OUT_LADDERS.write_text(json.dumps(all_ladders, indent=2))

    print("\n" + "=" * 70)
    print(f" Wrote {len(all_games)} games, {len(players)} players, {len(all_ladders)} ladder rows")
    print(f"  -> {OUT_GAMES}")
    print(f"  -> {OUT_PLAYERS}")
    print(f"  -> {OUT_LADDERS}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}")
        for f in (OUT_GAMES, OUT_PLAYERS, OUT_LADDERS):
            if not f.exists():
                f.write_text("[]\n")
        sys.exit(0)
