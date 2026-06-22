#!/usr/bin/env python3
"""
VAFA Talent ID — PlayHQ fetcher.
Pulls Women's grades 2026: fixtures (v2), per-game appearances (v1 summary),
and team ladders (v2). Writes data/games.json + data/players.json.
"""
import json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, parse, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"
BASE    = "https://api.playhq.com"

SEASON_ID   = "2af0bc11-6f71-4c82-93b5-d46fe9bc739f"
SEASON_NAME = "2026"

GRADES = [
    ("Premier A Women's",        "2ed24d43-8720-42aa-9483-c0e8e65be568"),
    ("Premier A Women's Reserve","bbcf04d5-ec88-4f37-90f8-460ddcc71cc9"),
    ("Premier B Women's",        "972de8ed-8555-42ce-91de-660850b3e7ea"),
    ("Division 1 Women's",       "dae84ac0-533d-4dee-8518-10db71bbf0e3"),
    ("Division 2 Women's",       "a63e5b85-0505-4423-8d49-0c31bb0a4343"),
    ("Division 3 Women's",       "55ad642b-5f09-48a4-b147-77b89639b968"),
    ("Division 4 Women's",       "5d67b06e-119c-4180-8dfc-82387a955e61"),
    ("Division 5 Women's",       "6c9deafe-cc66-48f0-9f0f-0b69c594ea50"),
]

HEADERS = {
    "x-api-key": API_KEY,
    "x-phq-tenant": TENANT,
    "Accept": "application/json",
    "User-Agent": "vafa-talent-id/2.0",
}

ROOT = Path(__file__).resolve().parents[1]
OUT_GAMES   = ROOT / "data" / "games.json"
OUT_PLAYERS = ROOT / "data" / "players.json"


def banner():
    print("=" * 70)
    print(" VAFA Talent ID — PlayHQ fetch v2")
    print(f" Time   : {datetime.now(timezone.utc).isoformat()}")
    print(f" Tenant : {TENANT}")
    print(f" Key    : {API_KEY[:8]}…")
    print(f" Season : {SEASON_NAME}")
    print(f" Grades : {len(GRADES)}")
    print("=" * 70)


def get(path, params=None):
    url = BASE + path
    if params:
        url += "?" + parse.urlencode(params)
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
    """v2 fixture — returns list of rounds, each with games[]."""
    data = get(f"/v2/grades/{grade_id}/games")
    if not data: return []
    rounds = data.get("rounds") or []
    flat = []
    for r in rounds:
        for g in (r.get("games") or []):
            g["_round"] = r.get("name")
            flat.append(g)
    return flat


def grade_ladder(grade_id):
    """v2 ladder — returns {team_id: {name, played, won, lost, drawn, pct}}."""
    data = get(f"/v2/grades/{grade_id}/ladder")
    teams = {}
    if not data: return teams
    for ladder in (data.get("ladders") or []):
        headers = [h["key"] for h in (ladder.get("headers") or [])]
        for s in (ladder.get("standings") or []):
            t = s.get("team") or {}
            vals = dict(zip(headers, s.get("values") or []))
            teams[t.get("id")] = {
                "name":   t.get("name"),
                "played": vals.get("played", 0),
                "won":    vals.get("won", 0),
                "lost":   vals.get("lost", 0),
                "drawn":  vals.get("drawn", 0),
                "pct":    vals.get("percentage", 0),
            }
    return teams


def game_summary(game_id):
    """v1 summary — returns appearances[]."""
    data = get(f"/v1/games/{game_id}/summary")
    if not data: return []
    return (data.get("data") or {}).get("appearances") or []


def extract_score(team):
    """Pull TOTAL_GOALS / TOTAL_BEHINDS / TOTAL_SCORE from the match.teams[i] block."""
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
    team_lookup = {}     # team_id → {name, club...}
    appearances = []     # raw appearance records

    for grade_name, grade_id in GRADES:
        print(f"\n→ {grade_name}  ({grade_id[:8]}…)")
        ladder = grade_ladder(grade_id)
        for tid, t in ladder.items():
            team_lookup.setdefault(tid, {"name": t["name"], "grade": grade_name,
                                         "ladder": t})
        fixtures = list_grade_games(grade_id)
        print(f"   fixtures: {len(fixtures)}  ·  teams on ladder: {len(ladder)}")

        finals = [g for g in fixtures if (g.get("status") or "").upper() == "FINAL"]
        print(f"   finalised games to summarise: {len(finals)}")

        for i, g in enumerate(finals, 1):
            match_teams = ((g.get("match") or {}).get("teams")) or []
            team_scores = {t.get("id"): extract_score(t) for t in match_teams}

            top_teams = g.get("teams") or []
            home_id   = next((t.get("id") for t in top_teams if t.get("isHomeTeam")), None)
            away_id   = next((t.get("id") for t in top_teams if not t.get("isHomeTeam")), None)
            outcome   = {t.get("id"): t.get("outcome") for t in top_teams}

            schedule  = (g.get("schedule") or [{}])[0]
            game_obj = {
                "id":       g.get("id"),
                "season":   SEASON_NAME,
                "grade":    grade_name,
                "round":    g.get("_round"),
                "dateTime": schedule.get("dateTime"),
                "home":     {"id": home_id, "name": team_lookup.get(home_id,{}).get("name",""),
                             "score": team_scores.get(home_id, {}), "outcome": outcome.get(home_id)},
                "away":     {"id": away_id, "name": team_lookup.get(away_id,{}).get("name",""),
                             "score": team_scores.get(away_id, {}), "outcome": outcome.get(away_id)},
                "url":      g.get("url"),
            }
            all_games.append(game_obj)

            # pull appearances
            for app in game_summary(g["id"]):
                app["_gameId"]    = g.get("id")
                app["_grade"]     = grade_name
                app["_round"]     = g.get("_round")
                app["_dateTime"]  = schedule.get("dateTime")
                app["_teamName"]  = team_lookup.get(app.get("teamID"), {}).get("name", "")
                app["_won"]       = outcome.get(app.get("teamID")) == "WON"
                appearances.append(app)

            if i % 10 == 0:
                print(f"   …processed {i}/{len(finals)}")
            time.sleep(0.05)

        # also include scheduled (not-yet-played) games for the Dashboard
        for g in fixtures:
            if (g.get("status") or "").upper() == "FINAL":
                continue
            top_teams = g.get("teams") or []
            home_id   = next((t.get("id") for t in top_teams if t.get("isHomeTeam")), None)
            away_id   = next((t.get("id") for t in top_teams if not t.get("isHomeTeam")), None)
            schedule  = (g.get("schedule") or [{}])[0]
            all_games.append({
                "id":       g.get("id"),
                "season":   SEASON_NAME,
                "grade":    grade_name,
                "round":    g.get("_round"),
                "dateTime": schedule.get("dateTime"),
                "home":     {"id": home_id, "name": team_lookup.get(home_id,{}).get("name","")},
                "away":     {"id": away_id, "name": team_lookup.get(away_id,{}).get("name","")},
                "status":   g.get("status"),
            })

    # ---------- Aggregate players ----------
    players = {}
    for app in appearances:
        pid = app.get("id")
        if not pid: continue
        goals = sum(s.get("value", 0) for s in (app.get("scoreSubTotal") or [])
                    if s.get("type") == "6_POINT_SCORE") // 6
        bog   = app.get("bestPlayer") or 0   # 6=BOG, 5=2nd…1=5th
        cap   = app.get("captainRole")

p = players.setdefault(pid, {
    "id":       pid,
    "name":     f"{app.get('firstName','')} {app.get('lastName','')}".strip(),
    "number":   app.get("playerNumber"),
    "club":     app.get("_teamName"),
    "grade":    app.get("_grade"),
    "games":    0,
    "goals":    0,
    "bog":      0,
    "bogFirsts":0,
    "bestCount":0,           # ← NEW
    "wins":     0,
    "captainGames": 0,
    "history":  [],
})

        p["games"] += 1
        p["goals"] += goals
        p["bog"]   += bog
        if bog == 6: p["bogFirsts"] += 1
        if app.get("_won"): p["wins"] += 1
        if cap: p["captainGames"] += 1

        p["history"].append({
gs = goals * 5 + bog * 8 + (6 if bog == 6 else 0) + (2 if app.get("_won") else 0)
p["history"].append({
    "date":     (app.get("_dateTime") or "")[:10],
    "round":    app.get("_round"),
    "grade":    app.get("_grade"),
    "opponent": "",
    "goals":    goals,
    "bog":      bog,
    "inBest":   bog > 0,
    "won":      app.get("_won"),
    "talentScore": gs,
})

    # back-fill opponent per history row
    games_by_id = {g["id"]: g for g in all_games}
    for p in players.values():
        for h in p["history"]:
            g = games_by_id.get(next((a["_gameId"] for a in appearances
                                      if a.get("id")==p["id"] and a.get("_round")==h["round"]
                                      and a.get("_grade")==h["grade"]), None))
            if not g: continue
            tname = p["club"]
            h["opponent"] = g["away"]["name"] if g["home"]["name"]==tname else g["home"]["name"]

    # Talent score: BOG-weighted, with goals + win bonus, normalised per game
    for p in players.values():
        g = max(1, p["games"])
        raw = p["bog"] * 8 + p["goals"] * 5 + p["wins"] * 2 + p["bogFirsts"] * 6
        p["talentScore"] = round(raw / g, 1)
        # stats block the front-end expects
        p["stats"] = {"goals": p["goals"], "bog": p["bog"], "wins": p["wins"],
                      "bogFirsts": p["bogFirsts"], "captainGames": p["captainGames"]}

    OUT_GAMES.parent.mkdir(parents=True, exist_ok=True)
    OUT_GAMES.write_text(json.dumps(all_games, indent=2))
    OUT_PLAYERS.write_text(json.dumps(list(players.values()), indent=2))

    print("\n" + "=" * 70)
    print(f" Wrote {len(all_games)} games · {len(players)} players · {len(appearances)} appearances")
    print(f"  → {OUT_GAMES}")
    print(f"  → {OUT_PLAYERS}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}")
        if not OUT_GAMES.exists():   OUT_GAMES.write_text("[]\n")
        if not OUT_PLAYERS.exists(): OUT_PLAYERS.write_text("[]\n")
        sys.exit(0)
