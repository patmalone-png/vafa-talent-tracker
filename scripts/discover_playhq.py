#!/usr/bin/env python3
"""
PlayHQ Discovery — resolves VAFA org name to full UUID, then lists seasons & grades.

Run locally:
    PLAYHQ_API_KEY=xxx python scripts/discover_playhq.py

Or via the discover.yml GitHub Action.
"""
import os, sys, json, requests

API_BASE = "https://api.playhq.com/v1"
SEARCH_URL = "https://search.playhq.com/graphql"
TENANT = os.getenv("PLAYHQ_TENANT", "afl")
API_KEY = os.getenv("PLAYHQ_API_KEY", "").strip()

# Search term — adjust if needed
ORG_SEARCH_QUERY = os.getenv("PLAYHQ_ORG_QUERY", "Victorian Amateur Football")


def headers_rest():
    if not API_KEY:
        print("❌ PLAYHQ_API_KEY not set"); sys.exit(1)
    return {"x-api-key": API_KEY, "x-phq-tenant": TENANT, "Accept": "application/json"}


def search_orgs(query: str):
    """Use PlayHQ's public GraphQL search to find org UUIDs by name."""
    payload = {
        "query": """
            query search($filter: SearchFilter!) {
              search(filter: $filter) {
                meta { totalRecords }
                results {
                  ... on Organisation {
                    id
                    routingCode
                    name
                    type
                    tenant { slug name }
                  }
                }
              }
            }
        """,
        "variables": {
            "filter": {
                "meta": {"limit": 20, "page": 1},
                "organisation": {
                    "query": query,
                    "types": ["ASSOCIATION", "CLUB"],
                    "sports": ["AFL"],
                },
            }
        },
    }
    r = requests.post(
        SEARCH_URL,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
            "Origin": "https://www.playhq.com",
        },
        timeout=30,
    )
    if r.status_code != 200:
        print(f"❌ search {r.status_code}: {r.text[:200]}"); return []
    return ((r.json().get("data") or {}).get("search") or {}).get("results") or []


def get_rest(path, params=None):
    r = requests.get(f"{API_BASE}{path}", headers=headers_rest(), params=params, timeout=30)
    if r.status_code != 200:
        print(f"  ❌ {r.status_code} on {path}: {r.text[:200]}")
        return None
    return r.json()


def get_paged_rest(path):
    out, cursor = [], None
    while True:
        payload = get_rest(path, {"cursor": cursor} if cursor else None)
        if not payload: break
        out.extend(payload.get("data") or [])
        meta = payload.get("metadata") or {}
        cursor = meta.get("nextCursor") or (meta.get("cursor") or {}).get("next")
        if not (meta.get("hasMore") if "hasMore" in meta else cursor): break
    return out


def main():
    print(f"== Tenant: {TENANT} ==\n")

    # 1. Resolve org name → full UUID
    print(f"→ Searching organisations matching '{ORG_SEARCH_QUERY}'…")
    orgs = search_orgs(ORG_SEARCH_QUERY)
    if not orgs:
        print("❌ No organisations found. Try a different query (e.g. 'VAFA', 'Amateur Football').")
        return 1

    print(f"  Found {len(orgs)} match(es):\n")
    for o in orgs:
        print(f"  • ORG  id={o.get('id')}")
        print(f"         routingCode={o.get('routingCode')}")
        print(f"         name={o.get('name')}  type={o.get('type')}")
        print(f"         tenant={(o.get('tenant') or {}).get('slug')}\n")

    # 2. For each org, list seasons & grades
    for o in orgs:
        org_id = o.get("id")
        if not org_id: continue
        print(f"\n=== Seasons under {o.get('name')} ({org_id}) ===")
        seasons = get_paged_rest(f"/organisations/{org_id}/seasons")
        if not seasons:
            print("  (no seasons)"); continue
        for s in seasons:
            sid = s.get("id"); sname = s.get("name")
            comp = (s.get("competition") or {}).get("name") or ""
            print(f"  • SEASON {sid}  {sname}  ({comp})")
            grades = get_paged_rest(f"/seasons/{sid}/grades")
            for g in grades:
                print(f"      └ GRADE  {g.get('id')}  {g.get('name')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
