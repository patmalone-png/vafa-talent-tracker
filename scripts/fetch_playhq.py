#!/usr/bin/env python3
"""VAFA PlayHQ fetcher - restores working games + players. No ladder."""
import json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error

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

HEADERS = {"x-api-key":API_KEY,"x-phq-tenant":TENANT,"Accept":"application/json","User-Agent":"vafa/2.1"}
ROOT = Path(__file__).resolve().parents[1]
OUT_GAMES = ROOT/"data"/"games.json"
OUT_PLAYERS = ROOT/"data"/"players.json"


def get(path):
    req = request.Request(BASE+path, headers=HEADERS)
    try:
        with request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except error.HTTPError as e:
        if e.code != 404:
            print(f"  HTTP {e.code} {path}")
        return None
    except Exception as e:
        print(f"  ERR {path}: {e}")
        return None


def list_grade_games(grade_id):
    data = get(f"/v2/grades/{grade_id}/games")
    if not data: return []
    flat=[]
    for r in (data.get("rounds") or []):
        for g in (r.get("games") or []):
            g["_round"]=r.get("name")
            flat.append(g)
    return flat


def grade_ladder_names(grade_id):
    """Pull team id->name map from ladder so we can name teams in games."""
    data = get(f"/v2/grades/{grade_id}/ladder")
    m={}
    if not data: return m
    for lad in (data.get("ladders") or []):
        for s in (lad.get("standings") or []):
            t=s.get("team") or {}
            if t.get("id"): m[t["id"]]=t.get("name","")
    return m


def game_summary(gid):
    data=get(f"/v1/games/{gid}/summary")
    if not data: return []
    return (data.get("data") or {}).get("appearances") or []


def extract_score(team):
    s={"points":0}
    for st in ((team or {}).get("outcome") or {}).get("statistics") or []:
        if st.get("type")=="TOTAL_SCORE": s["points"]=st.get("value",0)
    return s


def main():
    print("VAFA fetch v2.1 (restore)")
    all_games=[]; appearances=[]
    for grade_name,grade_id in GRADES:
        print(f"-> {grade_name}")
        names=grade_ladder_names(grade_id)
        fixtures=list_grade_games(grade_id)
        for g in fixtures:
            top=g.get("teams") or []
            home_id=next((t.get("id") for t in top if t.get("isHomeTeam")),None)
            away_id=next((t.get("id") for t in top if not t.get("isHomeTeam")),None)
            home_name=names.get(home_id,"")
            away_name=names.get(away_id,"")
            sched=(g.get("schedule") or [{}])[0]
            status=(g.get("status") or "").upper()
            hs=as_=None
            if status=="FINAL":
                mt=((g.get("match") or {}).get("teams")) or []
                sc={t.get("id"):extract_score(t) for t in mt}
                hs=sc.get(home_id,{}).get("points")
                as_=sc.get(away_id,{}).get("points")
                for app in game_summary(g["id"]):
                    app["_grade"]=grade_name; app["_round"]=g.get("_round"); app["_dateTime"]=sched.get("dateTime")
                    appearances.append(app)
                time.sleep(0.05)
            all_games.append({
                "id":g.get("id"),"grade":grade_name,"round":g.get("_round"),
                "date":(sched.get("dateTime") or "")[:10],"dateTime":sched.get("dateTime"),
                "status":status,"homeTeam":home_name,"awayTeam":away_name,
                "homeScore":hs,"awayScore":as_,
            })
    # players
    players={}
    for app in appearances:
        pid=app.get("id")
        if not pid: continue
        goals=sum(s.get("value",0) for s in (app.get("scoreSubTotal") or []) if s.get("type")=="6_POINT_SCORE")//6
        bog=app.get("bestPlayer") or 0
        p=players.setdefault(pid,{"id":pid,"name":f"{app.get('firstName','')} {app.get('lastName','')}".strip(),
            "number":app.get("playerNumber"),"grade":app.get("_grade"),"club":app.get("_teamName",""),
            "games":0,"goals":0,"bog":0,"bogFirsts":0,"bestCount":0,"wins":0,"captainGames":0,"history":[]})
        p["games"]+=1; p["goals"]+=goals; p["bog"]+=bog
        if bog==6: p["bogFirsts"]+=1
        if bog>0: p["bestCount"]+=1
        p["history"].append({"date":(app.get("_dateTime") or "")[:10],"round":app.get("_round"),
            "grade":app.get("_grade"),"goals":goals,"bog":bog,"inBest":bog>0,
            "talentScore":goals*5+bog*8+(6 if bog==6 else 0)})
    for p in players.values():
        g=max(1,p["games"])
        p["talentScore"]=round((p["bog"]*8+p["goals"]*5+p["wins"]*2+p["bogFirsts"]*6)/(g**0.5),1)
    OUT_GAMES.parent.mkdir(parents=True,exist_ok=True)
    OUT_GAMES.write_text(json.dumps(all_games,indent=2))
    OUT_PLAYERS.write_text(json.dumps(list(players.values()),indent=2))
    print(f"Wrote {len(all_games)} games, {len(players)} players")
    return 0


if __name__=="__main__":
    try: sys.exit(main())
    except Exception as e:
        print(f"FATAL: {e}")
        for f in (OUT_GAMES,OUT_PLAYERS):
            if not f.exists(): f.write_text("[]\n")
        sys.exit(0)
