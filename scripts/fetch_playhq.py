#!/usr/bin/env python3
"""
OBGFC Talent Tracker — PlayHQ fetch
Pulls VAFA women's competitions and writes data/players.json + data/games.json.
"""

import os, sys, json, time, pathlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import requests

API_BASE = "https://api.playhq.com/v1"
TENANT = os.getenv("PLAYHQ_TENANT", "afl")
API_KEY = os.getenv("PLAYHQ_API_KEY", "").strip()

# === Full UUIDs from discovery ===
ORG_ID    = "1cd834de-fc01-442d-836e-bc11a1a8e042"
SEASON_ID = "2af0bc11-6f71-4c82-93b5-d46fe9bc739f"

COMPETITIONS: Dict[str, str] = {
    # Senior women's
    "William Buck Premier Women's":   "2ed24d43-8720-42aa-9483-c0e8e65be568",
    "Premier Women's Reserve":        "bbcf04d5-ec88-4f37-90f8-460ddcc71cc9",
    "Premier B Women's":              "972de8ed-8555-42ce-91de-660850b3e7ea",
    "Division 1 Women's":             "dae84ac0-533d-4dee-8518-10db71bbf0e3",
    "Division 2 Women's":             "a63e5b85-0505-4423-8d49-0c31bb0a4343",
    "Division 3 Women's":             "55ad642b-5f09-48a4-b147-77b89639b968",
    "Division 4 Women's":             "5d67b06e-119c-4180-8dfc-82387a955e61",
    "Division 5 Women's":             "6c9deafe-cc66-48f0-9f0f-0b69c594ea50",
    # Junior women's pathway
    "Holmesglen U19 Premier Women's": "5a70a2ff-9d02-486a-b7fe-c7f991d367e5",
}

OUT_DIR = pathlib.Path("data")
PLAYERS_OUT = OUT_DIR / "players.json"
GAMES_OUT = OUT_DIR / "games.json"

REQUEST_DELAY = 0.25
MAX_RETRIES = 3
RETRY_BACKOFF = 1.5

# Candidate fixture-list endpoints (PlayHQ has shipped both shapes over time)
FIXTURE_PATHS = [
    "/grades/{grade_id}/fixture",
    "/grades/{grade_id}/games",
    "/seasons/{season_id}/grades/{grade_id}/fixture",
    "/seasons/{season_id}/grades/{grade_id}/games",
]
GAME_DETAIL_PATHS = [
    "/games/{game_id}",
    "/games/{game_id}/summary",
]

# Cache of the winning fixture-path template once discovered
_resolved_fixture_tpl: Optional[str] = None


# =============================================================
# HTTP helpers
# =============================================================
def banner():
    print("=" * 65)
    print("  OBGFC Talent Tracker — PlayHQ Fetch")
    print(f"  Time   : {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    print(f"  Tenant : {TENANT}")
    print(f"  Key len: {len(API_KEY)} (expected 36)")
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
            r = requests.get(url, headers=headers(), params=params, timeout=30)
            if r.status_code == 200:
                time.sleep(REQUEST_DELAY)
                return r.json()
            if r.status_code in (401, 403):
                print(f"❌ Auth {r.status_code} on {path}: {r.text[:200]}"); sys.exit(2)
            if r.status_code == 404:
                if not silent_404:
                    print(f"  ❌ 404 on {path}")
                return None
            if r.status_code in (429, 502, 503, 504):
                wait = RETRY_BACKOFF ** attempt
                print(f"  ⚠ {r.status_code} on {path} — retry {attempt}/{MAX_RETRIES} in {wait:.1f}s")
                time.sleep(wait); continue
            print(f"  ❌ {r.status_code} on {path}: {r.text[:200]}")
            return None
        except requests.RequestException as e:
            print(f"  ❌ network error {e} on {path} (attempt {attempt})")
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


def resolve_fixture_template(grade_id: str) -> Optional[str]:
    """Probe candidate endpoints once and cache the working one."""
    global _resolved_fixture_tpl
    if _resolved_fixture_tpl:
        return _resolved_fixture_tpl
    print("  🔎 Probing fixture endpoint variants…")
    for tpl in FIXTURE_PATHS:
        path = tpl.format(grade_id=grade_id, season_id=SEASON_ID)
        payload = get(path, silent_404=True)
        if payload is not None:
            print(f"  ✓ Using fixture endpoint pattern: {tpl}")
            _resolved_fixture_tpl = tpl
            return tpl
    print("  ❌ No fixture endpoint variant returned 200 for this grade.")
    return None


def list_games_for_grade(grade_id):
    print(f"→ Fetching fixture for grade {grade_id}…")
    tpl = resolve_fixture_template(grade_id)
    if not tpl: return []
    path = tpl.format(grade_id=grade_id, season_id=SEASON_ID)
    return get_paged(path)


def get_game_detail(game_id):
    for tpl in GAME_DETAIL_PATHS:
        path = tpl.format(game_id=game_id)
        payload = get(path, silent_404=True)
        if payload is not None:
            return payload
    return None


# =============================================================
# Aggregation
# =============================================================
def player_key(name, team): return f"{(name or '').strip()}__{(team or '').strip()}"
def safe_int(v):
    try: return int(v)
    except (TypeError, ValueError): return 0
def extract_team_name(t): return (t or {}).get("name") or (t or {}).get("displayName") or "Unknown"

def ensure_player(players, name, team, grade):
    k = player_key(name, team)
    if k not in players:
        players[k] = {"name": name.strip(), "team": team.strip(), "grade": grade,
                      "games": 0, "timesInBest": 0, "goals": 0, "gameLog": []}
    return players[k]


def aggregate_competition(label, grade_id, players, games_out):
    fixtures = list_games_for_grade(grade_id)
