#!/usr/bin/env python3
"""Find the full UUIDs we need from PlayHQ via the public search API."""
import json
from urllib import request

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
TENANT  = "afl"

# 1. Search for the VAFA organisation (returns full UUID)
search_url = "https://search.playhq.com/graphql"
query = """
query S($filter: SearchFilter!) {
  search(filter: $filter) {
    results { ... on Organisation { id routingCode name type } }
  }
}
"""
body = json.dumps({
    "query": query,
    "variables": {"filter": {
        "meta": {"limit": 10, "page": 1},
        "organisation": {
            "query": "Victorian Amateur Football",
            "types": ["ASSOCIATION"],
            "sports": ["AFL"]
        }
    }}
}).encode()

req = request.Request(search_url, data=body, headers={
    "Content-Type": "application/json",
    "Origin": "https://www.playhq.com",
    "User-Agent": "Mozilla/5.0"
})
with request.urlopen(req, timeout=20) as r:
    data = json.loads(r.read())

print("=== ORGANISATION SEARCH ===")
for o in data["data"]["search"]["results"]:
    print(f"  name={o['name']!r}")
    print(f"  routingCode={o['routingCode']}  (this is what's in the URL)")
    print(f"  FULL ID   ={o['id']}  ← USE THIS")
    print()

# 2. With the full ID, list seasons + grades using the REST API
org_id = data["data"]["search"]["results"][0]["id"]
print(f"\n=== SEASONS for org {org_id} ===")
req2 = request.Request(
    f"https://api.playhq.com/v1/organisations/{org_id}/seasons",
    headers={"x-api-key": API_KEY, "x-phq-tenant": TENANT, "Accept": "application/json"}
)
with request.urlopen(req2, timeout=20) as r:
    seasons = json.loads(r.read()).get("data", [])
for s in seasons:
    print(f"  season {s.get('name')!r:30s} id={s.get('id')}")

# 3. Optional: list grades for the most recent season
if seasons:
    sid = seasons[0]["id"]
    print(f"\n=== GRADES for season {seasons[0].get('name')} ===")
    req3 = request.Request(
        f"https://api.playhq.com/v1/seasons/{sid}/grades",
        headers={"x-api-key": API_KEY, "x-phq-tenant": TENANT, "Accept": "application/json"}
    )
    with request.urlopen(req3, timeout=20) as r:
        grades = json.loads(r.read()).get("data", [])
    for g in grades:
        print(f"  grade {g.get('name')!r:40s} id={g.get('id')}")
