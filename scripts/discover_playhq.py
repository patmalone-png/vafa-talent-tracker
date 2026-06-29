#!/usr/bin/env python3
"""
PlayHQ Discovery — finds full UUIDs for organisation, seasons and grades.
Run locally once to discover the right IDs:
    PLAYHQ_API_KEY=xxx python scripts/discover_playhq.py
"""
import os, sys, json, requests

API_BASE = "https://api.playhq.com/v1"
TENANT = os.getenv("PLAYHQ_TENANT", "afl")
API_KEY = os.getenv("PLAYHQ_API_KEY", "").strip()

# Paste the short ID from the VAFA URL here. The script will resolve to the full UUID.
ORG_SHORT_OR_FULL = os.getenv("PLAYHQ_ORG_ID", "1cd834de")

def headers():
    if not API_KEY:
        print("❌ PLAYHQ_API_KEY not set"); sys.exit(1)
    return {"x-api-key": API_KEY, "x-phq-tenant": TENANT, "Accept": "application/json"}

def get(path, params=None):
    r = requests.get(f"{API_BASE}{path}", headers=headers(), params=params, timeout=30)
    if r.status_code != 200:
        print(f"❌ {r.status_code} on {path}: {r.text[:200]}")
        return None
    return r.json()

def get_paged(path):
    out, cursor = [], None
    while True:
        payload = get(path, {"cursor": cursor} if cursor else None)
        if not payload: break
        out.extend(payload.get("data") or [])
        meta = payload.get("metadata") or {}
        cursor = meta.get("nextCursor")
        if not meta.get("hasMore") or not cursor: break
    return out

def main():
    print(f"== Tenant: {TENANT} ==\n")

    # 1. Seasons under organisation
    print(f"→ Seasons under organisation {ORG_SHORT_OR_FULL}…")
    seasons = get_paged(f"/organisations/{ORG_SHORT_OR_FULL}/seasons")
    if not seasons:
        print("⚠ No seasons returned. The org ID is likely the short form — you need the full UUID.")
        print("   Open https://api.playhq.com docs and try the 'Search organisations' endpoint, or")
        print("   contact your VAFA admin to confirm the org UUID.")
        return 1

    for s in seasons:
        sid = s.get("id")
        name = s.get("name")
        comp = (s.get("competition") or {}).get("name")
        print(f"  • SEASON {sid}  {name}  ({comp})")

        # 2. Grades under each season
        grades = get_paged(f"/seasons/{sid}/grades")
        for g in grades:
            gid = g.get("id")
            gname = g.get("name")
            print(f"      └ GRADE {gid}  {gname}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
