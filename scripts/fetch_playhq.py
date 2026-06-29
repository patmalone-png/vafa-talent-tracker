#!/usr/bin/env python3
"""
OBGFC Talent Tracker — PlayHQ fetch
"""

import os, sys, json, time, pathlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import requests

API_BASE = "https://api.playhq.com/v1"
TENANT = os.getenv("PLAYHQ_TENANT", "afl")
API_KEY = os.getenv("PLAYHQ_API_KEY", "").strip()
DEBUG_DUMP = os.getenv("PLAYHQ_DEBUG", "1") == "1"   # set to "0" to silence

ORG_ID    = "1cd834de-fc01-442d-836e-bc11a1a8e042"
SEASON_ID = "2af0bc11-6f71-4c82-93b5-d46fe9bc739f"

COMPETITIONS: Dict[str, str] = {
    "William Buck Premier Women's":   "2ed24d43-8720-42aa-9483-c0e8e65be568",
    "Premier Women's Reserve":        "bbcf04d5-ec88-4f37-90f8-460ddcc71cc9",
    "Premier B Women's":              "972de8ed-8555-42ce-91de-660850b3e7ea",
    "Division 1 Women's":             "dae84ac0-533d-4dee-8518-10db71bbf0e3",
    "Division 2 Women's":             "a63e5b85-0505-4423-8d49-0c31bb0a4343",
    "Division 3 Women's":             "55ad642b-5f09-48a4-b147-77b89639b968",
    "Division 4 Women's":             "5d67b06e-119c-4180-8dfc-82387a955e61",
    "Division 5 Women's":             "6c9deafe-cc66-48f0-9f0f-0b69c594ea50",
    "Holmesglen U19 Premier Women's": "5a70a2ff-9d02-486a-b7fe-c7f991d367e5",
}

OUT_DIR = pathlib.Path("data")
PLAYERS_OUT = OUT_DIR / "players.json"
GAMES_OUT = OUT_DIR / "games.json"
DEBUG_DIR = pathlib.Path("debug")

REQUEST_TIMEOUT = 60
REQUEST_DELAY = 0.25
MAX_RETRIES = 3
RETRY_BACKOFF = 1.5

FIXTURE_PATHS = [
    "/grades/{grade_id}/fixture",
    "/grades/{grade_id}/games",
    "/seasons/{season_id}/grades/{grade_id}/fixture",
    "/seasons/{season_id}/grades/{grade_id}/games",
]
GAME_DETAIL_PATHS = [
    "/games/{game_id}",
    "/games/{game_id}/summary",
    "/games/{game_id}/statistics",
    "/games/{game_id}/lineups",
]

_resolved_fixture_tpl: Optional[str] = None
_resolved_detail_tpl: Optional[str] = None
_debug_dumped_grades: set = set()


# =============================================================
# HTTP
# =============================================================
def banner():
    print("=" * 65)
    print("  OBGFC Talent Tracker — PlayHQ Fetch")
    print(f"  Time   : {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    print(f"  Tenant : {TENANT}")
    print(f"  Key len: {len(API_KEY)} (expected 36)")
    print(f"  Debug  : {DEBUG_DUMP}")
    print("=" * 65)

def headers():
    if not API_KEY:
        print("❌ PLAYHQ_API_KEY not set"); sys.exit(1)
    return {
        "x-api-key": API_KEY,
        "x-phq-tenant": TENANT,
        "Accept": "application/json",
        "User-Agent": "OBGFC-Talent-Tracker/1.0",
    }

def get(path, params=None, silent_404=False):
    url = f"{API_BASE}{path}"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=headers(), params=params, timeout=REQUEST_TIMEOUT)
            if r.status_code == 200:
                time.sleep(REQUEST_DELAY)
                return r.json()
            if r.status_code in (401, 403):
                print(f"❌ Auth {r.status_code} on {path}: {r.text[:200]}"); sys.exit(2)
            if r.status_code == 404:
                if not silent_404: print(f"  ❌ 404 on {path}")
                return None
            if r.status_code in (429, 502, 503, 504):
                wait = RETRY_BACKOFF ** attempt
                print(f"  ⚠ {r.status_code} on {path} — retry {attempt}/{MAX_RETRIES} in {wait:.1f}s")
                time.sleep(wait); continue
            print(f"  ❌ {r.status_code} on {path}: {r.text[:200]}"); return None
        except requests.RequestException as e:
            print(f"  ⚠ network error on {path} (attempt {attempt}): {e}")
            time.sleep(RETRY_BACKOFF ** attempt)
    return None

def get_paged(path, params=None):
    items, cursor, page = [], None, 0
    while True:
        page += 1
        p = dict(params or {})
        if cursor: p["cursor"] = cursor
        payload = get(path, p)
        if not payload: break
        data = payload.get("data") or []
        items.extend(data)
        meta = payload.get("metadata") or {}
        cursor = meta.get("nextCursor") or (meta.get("cursor") or {}).get("next")
        has_more = meta.get("hasMore") if "hasMore" in meta else bool(cursor)
        print(f"    • page {page}: +{len(data)} (total {len(items)})")
        if not has_more or not cursor: break
    return items

def resolve_fixture_template(grade_id):
    global _resolved_fixture_tpl
    if _resolved_fixture_tpl: return _resolved_fixture_tpl
    print("  🔎 Probing fixture endpoint variants…")
    for tpl in FIXTURE_PATHS:
        path = tpl.format(grade_id=grade_id, season_id=SEASON_ID)
        if get(path, silent_404=True) is not None:
            print(f"  ✓ Using fixture endpoint pattern: {tpl}")
            _resolved_fixture_tpl = tpl
            return tpl
    return None

def resolve_detail_template(game_id):
    global _resolved_detail_tpl
    if _resolved_detail_tpl: return _resolved_detail_tpl
    print("  🔎 Probing game-detail endpoint variants…")
    for tpl in GAME_DETAIL_PATHS:
        path = tpl.format(game_id=game_id)
        payload = get(path, silent_404=True)
        if payload is not None:
            print(f"  ✓ Using game-detail endpoint pattern: {tpl}")
            _resolved_detail_tpl = tpl
            return tpl
    print("  ⚠ No game-detail endpoint variant returned 200")
    return None

def list_games_for_grade(grade_id):
    print(f"→ Fetching fixture for grade {grade_id}…")
    tpl = resolve_fixture_template(grade_id)
    if not tpl: return []
    return get_paged(tpl.format(grade_id=grade_id, season_id=SEASON_ID))

def get_game_detail(game_id, grade_label=None):
    tpl = resolve_detail_template(game_id)
    if not tpl: return None
    payload = get(tpl.format(game_id=game_id), silent_404=True)

    # Debug dump: save first game's full JSON per grade so we can see actual shape
    if payload and DEBUG_DUMP and grade_label and grade_label not in _debug_dumped_grades:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        slug = grade_label.replace("'", "").replace(" ", "_").lower()
        out = DEBUG_DIR / f"sample_game_{slug}.json"
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        print(f"  🐛 Wrote debug sample → {out}")
        print(f"     Top-level keys: {list(payload.keys())}")
        _debug_dumped_grades.add(grade_label)
    return payload


# =============================================================
# Aggregation
# =============================================================
def player_key(name, team): return f"{(name or '').strip()}__{(team or '').strip()}"
def safe_int(v):
    try: return int(v)
    except (TypeError, ValueError): return 0
def extract_team_name(t):
    if not t: return "Unknown"
    return t.get("name") or t.get("displayName") or (t.get("team") or {}).get("name") or "Unknown"

def ensure_player(players, name, team, grade):
    k = player_key(name, team)
    if k not in players:
        players[k] = {"name": name.strip(), "team": team.strip(), "grade": grade,
                      "games": 0, "timesInBest": 0, "goals": 0, "gameLog": []}
    return players[k]


def flexible_list(obj, *keys):
    """Try multiple possible keys, return first non-empty list."""
    for k in keys:
        v = obj.get(k) if isinstance(obj, dict) else None
        if isinstance(v, list) and v:
            return v
    return []


def flexible_name(p):
    if not isinstance(p, dict): return ""
    direct = p.get("name") or p.get("playerName") or p.get("fullName") or p.get("displayName")
    if direct: return direct.strip()
    first = p.get("firstName") or (p.get("person") or {}).get("firstName") or ""
    last = p.get("lastName") or (p.get("person") or {}).get("lastName") or ""
    return f"{first} {last}".strip()


def aggregate_competition(label, grade_id, players, games_out):
    fixtures = list_games_for_grade(grade_id)
    print(f"  ↳ {len(fixtures)} fixtures returned")

    for fx in fixtures:
        game_id = fx.get("id")
        if not game_id: continue

        date_iso = (fx.get("schedule") or {}).get("date") or fx.get("date") or fx.get("startDate") or ""
        home_team = extract_team_name(fx.get("homeTeam") or (fx.get("teams") or [{}, {}])[0])
        away_team = extract_team_name(fx.get("awayTeam") or (fx.get("teams") or [{}, {}])[1])

        hs = fx.get("homeScore") or (fx.get("scores") or {}).get("home")
        as_ = fx.get("awayScore") or (fx.get("scores") or {}).get("away")
        if isinstance(hs, dict): hs = hs.get("total") or hs.get("points")
        if isinstance(as_, dict): as_ = as_.get("total") or as_.get("points")

        games_out.append({
            "id": game_id, "grade": label, "date": date_iso,
            "homeTeam": home_team, "awayTeam": away_team,
            "homeScore": safe_int(hs) if hs is not None else None,
            "awayScore": safe_int(as_) if as_ is not None else None,
        })

        detail = get_game_detail(game_id, label)
        if not detail: continue
        process_game_detail(detail, label, home_team, away_team, date_iso, players)


def process_game_detail(detail, label, home_team, away_team, date_iso, players):
    teams_block = (
        flexible_list(detail, "teams")
        or [
            {"name": home_team, **(detail.get("home") or detail.get("homeTeam") or {})},
            {"name": away_team, **(detail.get("away") or detail.get("awayTeam") or {})},
        ]
    )

    for t in teams_block:
        team_name = extract_team_name(t)
        opponent = away_team if team_name == home_team else home_team

        best_list = flexible_list(t, "bestPlayers", "best",
                                  *([(t.get("awards") or {}).get("bestPlayers") and "awards"] or []))
        if not best_list:
            best_list = (t.get("awards") or {}).get("bestPlayers") or []

        best_names = {flexible_name(b) for b in best_list if flexible_name(b)}

        goals_list = flexible_list(t, "goalScorers", "goals")
        if not goals_list:
            goals_list = (t.get("stats") or {}).get("goalScorers") or []

        goal_map = {}
        for g in goals_list:
            nm = flexible_name(g)
            if nm:
                goal_map[nm] = goal_map.get(nm, 0) + safe_int(
                    g.get("goals") or g.get("count") or g.get("score") or 1
                )

        roster = flexible_list(t, "players", "lineup", "roster", "squad")
        if not roster:
            roster = [{"name": nm} for nm in best_names.union(goal_map.keys())]

        for pl in roster:
            nm = flexible_name(pl)
            if not nm: continue
            rec = ensure_player(players, nm, team_name, label)
            rec["games"] += 1
            in_best = nm in best_names
            goals = goal_map.get(nm, 0)
            if in_best: rec["timesInBest"] += 1
            if goals: rec["goals"] += goals
            rec["gameLog"].append({"date": date_iso, "opponent": opponent,
                                   "goals": goals, "inBest": in_best})


def compute_form(p):
    log = sorted(p.get("gameLog", []), key=lambda g: g.get("date", ""), reverse=True)
    if not log: return 0
    recent = log[:3]
    def impact(g): return (1 if g.get("inBest") else 0) + (safe_int(g.get("goals")) * 0.5)
    ri = sum(impact(g) for g in recent) / len(recent)
    si = sum(impact(g) for g in log) / len(log)
    if si == 0 and ri == 0: return 0
    ratio = (ri / si) if si else 1.0
    return max(0, min(100, round(ratio * 50 + ri * 25)))


def main():
    banner()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    players, games_out = {}, []

    for label, gid in COMPETITIONS.items():
        print(f"\n=== {label} ===")
        aggregate_competition(label, gid, players, games_out)

    for p in players.values():
        p["formIndicator"] = compute_form(p)

    players_list = sorted(players.values(),
                          key=lambda x: (x.get("timesInBest", 0) + x.get("goals", 0) * 0.5),
                          reverse=True)

    PLAYERS_OUT.write_text(json.dumps(players_list, indent=2, ensure_ascii=False))
    GAMES_OUT.write_text(json.dumps(games_out, indent=2, ensure_ascii=False))

    print("\n" + "=" * 65)
    print(f"✅ Wrote {len(players_list)} players → {PLAYERS_OUT}")
    print(f"✅ Wrote {len(games_out)} games   → {GAMES_OUT}")
    print(f"📁 Debug samples written to: {DEBUG_DIR}/ (commit + share with me)")
    print("=" * 65)
    return 0


if __name__ == "__main__":
    sys.exit(main())
