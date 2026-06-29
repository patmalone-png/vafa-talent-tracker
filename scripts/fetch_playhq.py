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
DEBUG_DUMP = os.getenv("PLAYHQ_DEBUG", "0") == "1"   # set "1" to re-dump samples

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
REQUEST_DELAY = 0.20
MAX_RETRIES = 3
RETRY_BACKOFF = 1.5

FIXTURE_PATHS = [
    "/grades/{grade_id}/fixture",
    "/grades/{grade_id}/games",
    "/seasons/{season_id}/grades/{grade_id}/fixture",
    "/seasons/{season_id}/grades/{grade_id}/games",
]
GAME_DETAIL_PATHS = [
    "/games/{game_id}/summary",
    "/games/{game_id}",
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

def unwrap(payload):
    """PlayHQ wraps everything in {data: ...} — peel one layer if present."""
    if isinstance(payload, dict) and set(payload.keys()) >= {"data"}:
        return payload["data"]
    return payload

def get_paged(path, params=None):
    """List endpoints. Items live under `data` (list); paging cursor under `metadata`."""
    items, cursor, page = [], None, 0
    while True:
        page += 1
        p = dict(params or {})
        if cursor: p["cursor"] = cursor
        payload = get(path, p)
        if not payload: break
        data = payload.get("data") or []
        if isinstance(data, dict):
            data = [data]
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
        if get(tpl.format(game_id=game_id), silent_404=True) is not None:
            print(f"  ✓ Using game-detail endpoint pattern: {tpl}")
            _resolved_detail_tpl = tpl
            return tpl
    return None

def list_games_for_grade(grade_id):
    print(f"→ Fetching fixture for grade {grade_id}…")
    tpl = resolve_fixture_template(grade_id)
    if not tpl: return []
    return get_paged(tpl.format(grade_id=grade_id, season_id=SEASON_ID))

def get_game_detail(game_id, grade_label=None):
    tpl = resolve_detail_template(game_id)
    if not tpl: return None
    raw = get(tpl.format(game_id=game_id), silent_404=True)
    if not raw: return None
    detail = unwrap(raw)

    if DEBUG_DUMP and grade_label and grade_label not in _debug_dumped_grades:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        slug = grade_label.replace("'", "").replace(" ", "_").lower()
        out = DEBUG_DIR / f"sample_game_{slug}.json"
        out.write_text(json.dumps(raw, indent=2, ensure_ascii=False))
        print(f"  🐛 Debug sample → {out}")
        _debug_dumped_grades.add(grade_label)
    return detail


# =============================================================
# Aggregation
# =============================================================
def player_key(name, team): return f"{(name or '').strip()}__{(team or '').strip()}"

def safe_int(v):
    try: return int(v)
    except (TypeError, ValueError): return 0

def ensure_player(players, name, team, grade):
    k = player_key(name, team)
    if k not in players:
        players[k] = {
            "name": name.strip(), "team": team.strip(), "grade": grade,
            "games": 0, "timesInBest": 0, "goals": 0, "gameLog": [],
        }
    return players[k]


def extract_fixture_meta(fx):
    """Pull common fields from a fixture row regardless of exact shape."""
    fx = unwrap(fx) if isinstance(fx, dict) and "data" in fx else fx
    game_id = fx.get("id")
    date_iso = (
        (fx.get("schedule") or {}).get("date")
        or fx.get("date")
        or fx.get("startDate")
        or (fx.get("startTime") or "")[:10]
        or ""
    )

    # Try fixture-row shapes for teams + scores
    home_team = away_team = None
    home_score = away_score = None

    competitors = fx.get("competitors") or []
    if competitors and isinstance(competitors, list):
        for c in competitors:
            nm = c.get("name") or (c.get("team") or {}).get("name") or "Unknown"
            sc = c.get("scoreTotal") or c.get("score") or 0
            if c.get("isHomeTeam"):
                home_team, home_score = nm, safe_int(sc)
            else:
                away_team, away_score = nm, safe_int(sc)

    if not home_team:
        ht = fx.get("homeTeam") or (fx.get("teams") or [{}, {}])[0]
        at = fx.get("awayTeam") or (fx.get("teams") or [{}, {}])[1]
        home_team = (ht or {}).get("name") or "Unknown"
        away_team = (at or {}).get("name") or "Unknown"

    status = (fx.get("status") or "").upper()
    return game_id, date_iso, home_team, away_team, home_score, away_score, status


def aggregate_competition(label, grade_id, players, games_out):
    fixtures = list_games_for_grade(grade_id)
    print(f"  ↳ {len(fixtures)} fixtures returned")

    processed, skipped = 0, 0
    for fx in fixtures:
        game_id, date_iso, home_team, away_team, hs, as_, status = extract_fixture_meta(fx)
        if not game_id:
            continue

        # Pull detail (also gives definitive team names + scores via `competitors`)
        detail = get_game_detail(game_id, label)
        if not detail:
            skipped += 1
            continue

        # Override team names / scores from detail if available (more reliable)
        det_competitors = detail.get("competitors") or []
        team_map = {}
        for c in det_competitors:
            tid = c.get("id")
            name = c.get("name")
            if tid and name:
                team_map[tid] = name
            if c.get("isHomeTeam") and name:
                home_team = name
                hs = safe_int(c.get("scoreTotal")) if c.get("scoreTotal") is not None else hs
            elif not c.get("isHomeTeam") and name:
                away_team = name
                as_ = safe_int(c.get("scoreTotal")) if c.get("scoreTotal") is not None else as_

        det_status = (detail.get("status") or status or "").upper()

        games_out.append({
            "id": game_id, "grade": label, "date": date_iso,
            "homeTeam": home_team, "awayTeam": away_team,
            "homeScore": hs, "awayScore": as_,
            "status": det_status,
        })

        # Only process player stats for FINAL games
        if det_status != "FINAL":
            continue

        appearances = detail.get("appearances") or []
        for app in appearances:
            if app.get("roleType") != "Player":
                continue
            first = (app.get("firstName") or "").strip()
            last  = (app.get("lastName")  or "").strip()
            name = f"{first} {last}".strip()
            if not name:
                continue

            tid = app.get("teamID")
            team_name = team_map.get(tid, "Unknown")
            opponent = next((n for t, n in team_map.items() if t != tid), "Unknown")

            # Goals: scoreSubTotal entry of type 6_POINT_SCORE, divided by 6
            goals = 0
            for sub in (app.get("scoreSubTotal") or []):
                if sub.get("type") == "6_POINT_SCORE":
                    goals = safe_int(sub.get("value")) // 6
                    break

            best_rank = app.get("bestPlayer")  # 1..6 or None
            in_best = best_rank is not None

            rec = ensure_player(players, name, team_name, label)
            rec["games"] += 1
            if in_best: rec["timesInBest"] += 1
            if goals:   rec["goals"] += goals
            rec["gameLog"].append({
                "date": date_iso,
                "opponent": opponent,
                "goals": goals,
                "inBest": in_best,
                "bestRank": best_rank,
            })

        processed += 1

    print(f"  ✓ Processed {processed} FINAL games  ({skipped} skipped, {len(fixtures)-processed-skipped} not yet played)")


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
    if players_list:
        top = players_list[:5]
        print("\n🏆 Top 5 by raw impact:")
        for p in top:
            print(f"   {p['name']:25} ({p['team'][:30]:30}) — Best {p['timesInBest']:>2} · Goals {p['goals']:>3} · Games {p['games']:>2}")
    print("=" * 65)
    return 0


if __name__ == "__main__":
    sys.exit(main())
