#!/usr/bin/env python3
"""Probe PlayHQ tenants/endpoints to find the right combo."""
import json
from urllib import request, error

API_KEY = "bc7f6eea-fd24-405d-84ba-6ace22e5c930"
BASE    = "https://api.playhq.com/v1"
TENANTS = ["afl", "vafa"]
PROBES  = ["/competitions?search=VAFA", "/sports"]

for t in TENANTS:
    print(f"\n--- tenant: {t} ---")
    for ep in PROBES:
        req = request.Request(BASE + ep, headers={
            "x-api-key": API_KEY, "x-phq-tenant": t, "Accept": "application/json"
        })
        try:
            with request.urlopen(req, timeout=15) as r:
                body = r.read().decode("utf-8","ignore")[:240]
                print(f"  {ep} → {r.status}  {body}")
        except error.HTTPError as e:
            print(f"  {ep} → HTTP {e.code}: {e.read().decode('utf-8','ignore')[:240]}")
        except Exception as e:
            print(f"  {ep} → ERR {e}")
