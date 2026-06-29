#!/usr/bin/env python3
"""
OBGFC Talent Tracker — PlayHQ fetch
-----------------------------------
Pulls VAFA Women's Premier A and Premier Women's Reserves data from PlayHQ
and writes:
    data/players.json  – aggregated player stats with per-game log
    data/games.json    – per-fixture results for team-form calculations

Requires env vars:
    PLAYHQ_API_KEY   – your PlayHQ x-api-key
    PLAYHQ_TENANT    – usually "afl"
"""

import os
import sys
import json
import time
import pathlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

# =============================================================
# Config
# =============================================================
API_BASE = "https://api.playhq.com/v1"
TENANT = os.getenv("PLAYHQ_TENANT", "afl")
API_KEY = os.getenv("PLAYHQ_API_KEY", "").strip()

# VAFA identifiers
ORG_ID = "1cd834de"          # Victorian Amateur Football Association
SEASON_ID = "2af0bc11"       # current season

# Competitions to pull (label -> PlayHQ grade UUID)
COMPETITIONS: Dict[str, str] = {
    "Premier A Women": "2ed24d43",
    "Premier Women's Reserves": "REPLACE_WITH_RESERVES_UUID",
}

OUT_DIR = pathlib.Path("data")
PLAYERS_OUT = OUT_DIR / "players.json"
GAMES_OUT = OUT_DIR / "games.json"

REQUEST_DELAY = 0.25
MAX_RETRIES = 3
RETRY_BACKOFF = 1.5


# =============================================================
# HTTP helpers
# =============================================================
def banner() -> None:
    print("=" * 65)
    print("  OBGFC Talent Tracker — PlayHQ Fetch")
    print(f"  Time   : {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    print(f"  Tenant : {TENANT}")
    print(f"  Key len: {len(API_KEY)} (expected 36 for UUID format)")
    print("=" * 65)


def headers() -> Dict[str, str]:
    if not API_KEY:
        print("❌ PLAYHQ_API_KEY not set in environment.")
        sys.exit(1)
    return {
        "x-api-key": API_KEY,
        "x-phq-tenant": TENANT,
        "Accept": "application/json",
        "User-Agent": "OBGFC-Talent-Tracker/1.0",
    }


def get(path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    url = f"{API_BASE}{path}"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, headers=headers(), params=params, timeout=30)
            if r.status_code == 200:
                time.sleep(REQUEST_DELAY)
                return r.json()
            if r.status_code in (401, 403):
                print(f"❌ Auth failure {r.status_code} on {path}. Check PLAYHQ_API_KEY / tenant.")
                sys.exit(2)
            if r.status_code in (429, 502, 503, 504):
                wait = RETRY_BACKOFF ** attempt
                print(f"  ⚠ {r.status_code} on {path} — retry {attempt}/{MAX_RETRIES} in {wait:.1f}s")
                time.sleep(wait)
                continue
            print(f"  ❌ {r.status_code} on {path}: {r.text[:200]}")
            return None
        except requests.RequestException as e:
            print(f"  ❌ network error {e} on {path} (attempt {attempt})")
            time.sleep(RETRY_BACKOFF ** attempt)
    return None


def get_paged(path: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    cursor = None
    page = 0
    while True:
        page += 1
        p = dict(params or {})
        if cursor:
            p["cursor"] = cursor
        payload = get(path, p)
        if not payload:
            break
        data = payload.get("data") or []
        items.extend(data)
        meta = payload.get("metadata") or {}
        cursor = meta.get("nextCursor") or (meta.get("cursor") or {}).get("next")
        has_more = meta.get("hasMore") if "hasMore" in meta else bool(cursor)
        print(f"  • page {page}: +{len(data)} (total {len(items)})")
        if not has_more or not cursor:
            break
    return items


# =============================================================
# Domain helpers
# =============================================================
def list_games_for_grade(grade_id: str) -> List[Dict[str, Any]]:
    print(f"→ Fetching games for grade {grade_id}…")
    return get_paged(f"/seasons/{SEASON_ID}/grades/{grade_id}/games")


def get_game_summary(game_id: str) -> Optional[Dict[str, Any]]:
    return get(f"/games/{game_id}/summary")


# =============================================================
# Aggregation
# =============================================================
def player_key(name: str, team: str) -> str:
    return f"{(name or '').strip()}__{(team or '').strip()}"


def ensure_player(players: Dict[str, Dict[str, Any]], name: str, team: str, grade: str) -> Dict[str, Any]:
    k = player_key(name, team)
    if k not in players:
        players[k] = {
            "name": name.strip(),
            "team": team.strip(),
            "grade": grade,
            "games": 0,
            "timesInBest": 0,
            "goals": 0,
            "gameLog": [],
        }
    return players[k]


def extract_team_name(team_obj: Dict[str, Any]) -> str:
    return (team_obj or {}).get("name") or (team_obj or {}).get("displayName") or "Unknown"


def safe_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def aggregate_competition(grade_label: str, grade_id: str,
                          players: Dict[str, Dict[str, Any]],
                          games_out: List[Dict[str, Any]]) -> None:
    fixtures = list_games_for_grade(grade_id)
    print(f"  ↳ {len(fixtures)} fixtures returned")

    for fx in fixtures:
        game_id = fx.get("id")
        if not game_id:
            continue

        date_iso = (fx.get("schedule") or {}).get("date") or fx.get("date") or ""
        home_team = extract_team_name(fx.get("homeTeam") or (fx.get("teams") or [{}, {}])[0])
        away_team = extract_team_name(fx.get("awayTeam") or (fx.get("teams") or [{}, {}])[1])

        home_score = fx.get("homeScore") or (fx.get("scores") or {}).get("home")
        away_score = fx.get("awayScore") or (fx.get("scores") or {}).get("away")
        if isinstance(home_score, dict):
            home_score = home_score.get("total") or home_score.get("points")
        if isinstance(away_score, dict):
            away_score = away_score.get("total") or away_score.get("points")

        games_out.append({
            "id": game_id,
            "grade": grade_label,
            "date": date_iso,
            "homeTeam": home_team,
            "awayTeam": away_team,
            "homeScore": safe_int(home_score) if home_score is not None else None,
            "awayScore": safe_int(away_score) if away_score is not None else None,
        })

        summary = get_game_summary(game_id)
        if not summary:
            continue
        process_game_summary(summary, fx, grade_label, home_team, away_team, date_iso, players)


def process_game_summary(summary: Dict[str, Any], fixture: Dict[str, Any],
                         grade_label: str, home_team: str, away_team: str,
                         date_iso: str, players: Dict[str, Dict[str, Any]]) -> None:
    teams_block = summary.get("teams")
    if not teams_block:
        teams_block = [
            {"name": home_team, **(summary.get("home") or {})},
            {"name": away_team, **(summary.get("away") or {})},
        ]

    for t in teams_block:
        team_name = extract_team_name(t)
        opponent = away_team if team_name == home_team else home_team

        best_list = (
            t.get("bestPlayers")
            or t.get("best")
            or (t.get("awards") or {}).get("bestPlayers")
            or []
        )
        best_names = set()
        for b in best_list:
            nm = b.get("name") or b.get("playerName") or b.get("fullName")
            if nm:
                best_names.add(nm.strip())

        goals_list = (
            t.get("goalScorers")
            or t.get("goals")
            or (t.get("stats") or {}).get("goalScorers")
            or []
        )
        goal_map: Dict[str, int] = {}
        for g in goals_list:
            nm = g.get("name") or g.get("playerName") or g.get("fullName")
            if not nm:
                continue
            cnt = safe_int(g.get("goals") or g.get("count") or 1)
            goal_map[nm.strip()] = goal_map.get(nm.strip(), 0) + cnt

        roster = (
            t.get("players")
            or t.get("lineup")
            or t.get("roster")
            or []
        )
        if not roster:
            roster = [{"name": nm} for nm in best_names.union(goal_map.keys())]

        for pl in roster:
            nm = pl.get("name") or pl.get("playerName") or pl.get("fullName")
            if not nm:
                continue
            rec = ensure_player(players, nm, team_name, grade_label)
            rec["games"] += 1
            in_best = nm.strip() in best_names
            goals = goal_map.get(nm.strip(), 0)
            if in_best:
                rec["timesInBest"] += 1
            if goals:
                rec["goals"] += goals
            rec["gameLog"].append({
                "date": date_iso,
                "opponent": opponent,
                "goals": goals,
                "inBest": in_best,
            })


# =============================================================
# Form indicator
# =============================================================
def compute_form(p: Dict[str, Any]) -> int:
    log = sorted(p.get("gameLog", []), key=lambda g: g.get("date", ""), reverse=True)
    if not log:
        return 0
    recent = log[:3]
    def impact(g): return (1 if g.get("inBest") else 0) + (safe_int(g.get("goals")) * 0.5)
    recent_impact = sum(impact(g) for g in recent) / len(recent)
    season_impact = sum(impact(g) for g in log) / len(log)
    if season_impact == 0 and recent_impact == 0:
        return 0
    ratio = (recent_impact / season_impact) if season_impact else 1.0
    score = ratio * 50 + recent_impact * 25
    return max(0, min(100, round(score)))


# =============================================================
# Main
# =============================================================
def main() -> int:
    banner()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    players: Dict[str, Dict[str, Any]] = {}
    games_out: List[Dict[str, Any]] = []

    for label, grade_id in COMPETITIONS.items():
        if "REPLACE_WITH" in grade_id:
            print(f"⚠ Skipping {label} — grade UUID not set.")
            continue
        print(f"\n=== {label} ===")
        aggregate_competition(label, grade_id, players, games_out)

    for p in players.values():
        p["formIndicator"] = compute_form(p)

    players_list = sorted(
        players.values(),
        key=lambda x: (x.get("timesInBest", 0) + x.get("goals", 0) * 0.5),
        reverse=True,
    )

    PLAYERS_OUT.write_text(json.dumps(players_list, indent=2, ensure_ascii=False))
    GAMES_OUT.write_text(json.dumps(games_out, indent=2, ensure_ascii=False))

    print("\n" + "=" * 65)
    print(f"✅ Wrote {len(players_list)} players → {PLAYERS_OUT}")
    print(f"✅ Wrote {len(games_out)} games   → {GAMES_OUT}")
    print("=" * 65)
    return 0


if __name__ == "__main__":
    sys.exit(main())
