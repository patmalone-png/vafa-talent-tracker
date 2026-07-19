// VAFA Talent ID v1.9 - Coaches Brief Redesign
(function(){
"use strict";
let games=[], players=[], lastSync=null;
let watchlist=JSON.parse(localStorage.getItem("vafa_watchlist")||"[]");
const OWN=["old brighton"];
function isOwnClub(p){return OWN.some(k=>(p.club||"").toLowerCase().includes(k));}
function isOwnClubName(n){return OWN.some(k=>(n||"").toLowerCase().includes(k));}
function gameHome(g){return g.homeTeam||(g.home&&g.home.name)||"";}
function gameAway(g){return g.awayTeam||(g.away&&g.away.name)||"";}
function gameHomeScore(g){if(typeof g.homeScore==="number")return g.homeScore;if(g.home&&g.home.score&&g.home.score.points!=null)return g.home.score.points;return null;}
function gameAwayScore(g){if(typeof g.awayScore==="number")return g.awayScore;if(g.away&&g.away.score&&g.away.score.points!=null)return g.away.score.points;return null;}
function gameDateStr(g){return (g.date||g.dateTime||"").slice(0,10);}
function gameDateTime(g){return g.dateTime||g.date||"";}
function isFinal(g){return (g.status||"").toUpperCase()==="FINAL";}
function homeOutcome(g){const h=gameHomeScore(g),a=gameAwayScore(g);if(h==null||a==null)return null;if(h>a)return "WON";if(h<a)return "LOST";return "DRAW";}
function awayOutcome(g){const o=homeOutcome(g);if(o==="WON")return "LOST";if(o==="LOST")return "WON";if(o==="DRAW")return "DRAW";return null;}
function gameInvolves(g,c){return gameHome(g)===c||gameAway(g)===c;}
function talentScore(p){const g=Math.max(1,p.games||1);const r=((p.bog||0)*8)+((p.bogFirsts||0)*6)+((p.goals||0)*5)+((p.wins||0)*2);return +(r/Math.sqrt(g)).toFixed(1);}
function bestCount(p){if(typeof p.bestCount==="number")return p.bestCount;return (p.history||[]).filter(h=>(h.bog||0)>0||h.inBest).length;}
function gameTalentScore(h){if(typeof h.talentScore==="number")return h.talentScore;return (h.goals||0)*5+(h.bog||0)*8+((h.bog===6)?6:0)+(h.won?2:0);}
function formIndicator(p,w){const hist=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));if(hist.length<w+2)return null;const rec=hist.slice(-w),ear=hist.slice(0,-w);const avg=a=>a.length?a.reduce((s,h)=>s+gameTalentScore(h),0)/a.length:0;const r=avg(rec),e=avg(ear);const d=+(r-e).toFixed(1);return {recent:+r.toFixed(1),earlier:+e.toFixed(1),delta:d,trend:d>1?"\u25B2":d<-1?"\u25BC":"\u25AC"};}
function sel(id){return document.getElementById(id);}
function selectedGrade(){const e=sel("gradeFilter");return e?(e.value||""):"";}
function selectedFormWindow(){const e=sel("formWindow");return e?parseInt(e.value||"3",10):3;}
function applyGrade(l){const g=selectedGrade();return g?l.filter(x=>(x.grade||"")===g):l;}
function discoverGrades(){const s=new Set();games.forEach(g=>{if(g.grade)s.add(g.grade);});players.forEach(p=>{if(p.grade)s.add(p.grade);});return Array.from(s).sort();}
function populateGradeDropdown(id,inclAll){const dd=sel(id);if(!dd)return;const cur=dd.value;while(dd.options.length)dd.remove(0);if(inclAll){const o=document.createElement("option");o.value="";o.textContent="All grades";dd.appendChild(o);}discoverGrades().forEach(g=>{const o=document.createElement("option");o.value=g;o.textContent=g;dd.appendChild(o);});if(cur&&[...dd.options].some(o=>o.value===cur))dd.value=cur;}
function populateAllGradeDropdowns(){populateGradeDropdown("gradeFilter",true);populateGradeDropdown("lbGrade",true);populateGradeDropdown("rlGrade",true);populateGradeDropdown("fpGrade",false);}

async function loadData(){
  try{
    const [gR,pR]=await Promise.all([fetch("data/games.json",{cache:"no-store"}),fetch("data/players.json",{cache:"no-store"})]);
    games=gR.ok?await gR.json():[];players=pR.ok?await pR.json():[];
  }catch(e){games=[];players=[];}
  players.forEach(p=>{if(typeof p.talentScore!=="number")p.talentScore=talentScore(p);});
  lastSync=localStorage.getItem("vafa_last_render")||new Date().toISOString();
  localStorage.setItem("vafa_last_render",new Date().toISOString());
  populateAllGradeDropdowns();populateClubDropdown();
  renderAll();
}
function renderAll(){renderDashboard();renderLeaderboards();renderPlayerList();renderScoutReport();renderMatchPrep();renderRoundLog();renderFinalsPath();renderWatchlist();renderSettings();const s=lastSync?new Date(lastSync).toLocaleString():"never";const ls=sel("lastSync");if(ls)ls.textContent="Last sync: "+s;}

sel("tabs").addEventListener("click",e=>{const b=e.target.closest(".tab");if(!b)return;document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));b.classList.add("active");sel(b.dataset.tab).classList.add("active");if(b.dataset.tab==="matchprep")renderMatchPrep();});
function emptyState(m){return '<div class="empty">'+(m||"No data yet.")+'</div>';}
function playerLink(p){const own=isOwnClub(p)?'<span class="own-club" title="OBGFC">\u25CF</span> ':'';const id=p.id||p.name||'';return own+'<span class="player-link" style="color:#c9a44c;cursor:pointer;text-decoration:underline;" data-pid="'+id+'">'+(p.name||"Unknown")+'</span>';}
function renderTop5(id,rows,label,vf,ex){const el=sel(id);if(!el)return;if(!rows.length){el.innerHTML=emptyState();return;}let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>'+label+'</th>'+(ex?'<th>'+ex.label+'</th>':'')+'</tr></thead><tbody>';rows.forEach((p,i)=>{h+='<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+vf(p)+'</b></td>'+(ex?'<td>'+ex.fn(p)+'</td>':'')+'</tr>';});h+='</tbody></table>';el.innerHTML=h;}

function renderDashboard(){
  const pool=applyGrade(players).filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none");
  const fxPool=applyGrade(games);const fw=selectedFormWindow();
  sel("t-games").textContent=fxPool.length||"0";sel("t-players").textContent=pool.length||"0";
  const top=[...pool].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0))[0];
  sel("t-top").textContent=top?top.talentScore:"-";sel("t-sync").textContent=lastSync?new Date(lastSync).toLocaleDateString():"-";
  const q=pool.filter(p=>(p.games||0)>=3);
  renderTop5("topTalent",[...q].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0)).slice(0,5),"Score",p=>p.talentScore||0,{label:"Games",fn:p=>p.games||0});
  renderTop5("topBest",[...pool].map(p=>({...p,_b:bestCount(p)})).sort((a,b)=>b._b-a._b||(b.talentScore||0)-(a.talentScore||0)).slice(0,5),"In best",p=>p._b,{label:"Games",fn:p=>p.games||0});
  renderTop5("topGoals",[...pool].sort((a,b)=>(b.goals||0)-(a.goals||0)).slice(0,5),"Goals",p=>p.goals||0,{label:"Per game",fn:p=>p.games?(p.goals/p.games).toFixed(2):"0"});
  const formed=q.map(p=>({...p,_f:formIndicator(p,fw)})).filter(p=>p._f).sort((a,b)=>b._f.delta-a._f.delta).slice(0,5);
  renderTop5("topForm",formed,"\u0394",p=>'<span class="'+(p._f.delta>0?'form-up':p._f.delta<0?'form-down':'form-flat')+'">'+p._f.trend+' '+p._f.delta+'</span>',{label:"Last "+fw,fn:p=>p._f.recent});
  const fx=[...fxPool].sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a))).slice(0,8);
  const fEl=sel("recentFixtures");
  if(!fx.length){fEl.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
  fx.forEach(g=>{h+='<tr><td>'+gameDateStr(g)+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+gameHome(g)+'</td><td><b>'+(gameHomeScore(g)!=null?gameHomeScore(g):"-")+'</b></td><td>'+gameAway(g)+'</td><td><b>'+(gameAwayScore(g)!=null?gameAwayScore(g):"-")+'</b></td></tr>';});
  h+='</tbody></table>';fEl.innerHTML=h;
}

function renderLeaderboards(){
  const metric=(sel("lbMetric")||{}).value||"talentScore";
  const minG=parseInt((sel("lbMinGames")||{}).value||"1",10);
  const grade=(sel("lbGrade")||{}).value||"";
  let pool=players.filter(p=>(p.games||0)>=minG&&p.name&&p.name.trim().toLowerCase()!=="none none");
  if(grade)pool=pool.filter(p=>p.grade===grade);
  const gv=p=>{if(metric==="talentScore")return p.talentScore||0;if(metric==="bestCount")return bestCount(p);if(metric==="goals")return p.goals||0;if(metric==="wins")return p.wins||0;return 0;};
  pool.sort((a,b)=>gv(b)-gv(a));
  const el=sel("lbTable");
  if(!pool.length){el.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Games</th><th>'+metric+'</th></tr></thead><tbody>';
  pool.slice(0,30).forEach((p,i)=>{h+='<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td><b>'+gv(p)+'</b></td></tr>';});
  h+='</tbody></table>';el.innerHTML=h;
}

function renderPlayerList(){
  const q=(sel("playerSearch").value||"").toLowerCase();
  const filtered=players.filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none"&&(!q||(p.name||"").toLowerCase().includes(q)||(p.club||"").toLowerCase().includes(q))).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  const el=sel("playerList");
  if(!filtered.length){el.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th></th><th>Player</th><th>Club</th><th>Grade</th><th>Score</th><th></th></tr></thead><tbody>';
  filtered.slice(0,200).forEach(p=>{const st=watchlist.indexOf(p.id)>=0;h+='<tr><td><button class="star" data-pid="'+p.id+'">'+(st?'\u2605':'\u2606')+'</button></td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+(p.talentScore||0)+'</b></td><td><button class="btn small" data-pid="'+p.id+'" data-action="open">View</button></td></tr>';});
  h+='</tbody></table>';el.innerHTML=h;
}
sel("playerSearch").addEventListener("input",renderPlayerList);
document.addEventListener("click",e=>{const link=e.target.closest(".player-link, [data-action='open']");if(link){e.preventDefault();openProfile(link.dataset.pid);return;}const star=e.target.closest(".star");if(star){const id=star.dataset.pid;if(watchlist.indexOf(id)>=0)watchlist=watchlist.filter(x=>x!==id);else watchlist.push(id);localStorage.setItem("vafa_watchlist",JSON.stringify(watchlist));renderPlayerList();renderWatchlist();renderDashboard();}});
sel("backToList").addEventListener("click",()=>{sel("playerProfile").classList.add("hidden");sel("playerList").classList.remove("hidden");document.querySelector('.tab[data-tab="players"]').click();});
function openProfile(pid){const p=players.find(x=>x.id===pid);if(!p)return;document.querySelector('.tab[data-tab="players"]').click();sel("playerList").classList.add("hidden");sel("playerProfile").classList.remove("hidden");sel("profileName").textContent=p.name;sel("profileMeta").textContent=[p.club,p.grade,"#"+(p.number||""),(p.games||0)+" games","Goals: "+(p.goals||0),"In best: "+bestCount(p),"Talent: "+(p.talentScore||0)].filter(Boolean).join(" \u00B7 ");const tiles=[["Goals",p.goals||0],["BOG votes",p.bog||0],["BOG firsts",p.bogFirsts||0],["In best",bestCount(p)],["Wins",p.wins||0]].map(x=>'<div class="tile"><div class="tile-label">'+x[0]+'</div><div class="tile-value">'+x[1]+'</div></div>').join("");sel("profileStats").innerHTML='<div class="tiles">'+tiles+'</div>';const hist=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));drawSparkline("profileChart",hist.map(h=>gameTalentScore(h)));const gEl=sel("profileGames");if(!hist.length){gEl.innerHTML=emptyState();return;}let h='<table class="data"><thead><tr><th>Date</th><th>Round</th><th>Opp</th><th>G</th><th>BOG</th><th>W</th><th>Score</th></tr></thead><tbody>';hist.forEach(hh=>{h+='<tr><td>'+(hh.date||"")+'</td><td>'+(hh.round||"")+'</td><td>'+(hh.opponent||"")+'</td><td>'+(hh.goals||0)+'</td><td>'+(hh.bog||0)+'</td><td>'+(hh.won?"\u2713":"")+'</td><td><b>'+gameTalentScore(hh)+'</b></td></tr>';});h+='</tbody></table>';gEl.innerHTML=h;}
function drawSparkline(id,data){const c=sel(id);if(!c||!c.getContext)return;const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);if(!data.length)return;const max=Math.max.apply(null,data.concat([1])),min=Math.min.apply(null,data.concat([0]));const pad=10,w=c.width-pad*2,h=c.height-pad*2;ctx.strokeStyle="#c9a44c";ctx.lineWidth=2;ctx.beginPath();data.forEach((v,i)=>{const x=pad+(i/(Math.max(1,data.length-1)))*w;const y=pad+h-((v-min)/Math.max(0.001,max-min))*h;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();ctx.fillStyle="#c9a44c";data.forEach((v,i)=>{const x=pad+(i/(Math.max(1,data.length-1)))*w;const y=pad+h-((v-min)/Math.max(0.001,max-min))*h;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();});}

function populateClubDropdown(){const s=sel("scoutClub");if(!s)return;while(s.options.length>1)s.remove(1);Array.from(new Set(players.map(p=>p.club).filter(Boolean))).sort().forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;s.appendChild(o);});}
function renderScoutReport(){const s=sel("scoutClub");if(!s)return;const club=s.value;const el=sel("scoutReport");if(!club){el.innerHTML='<p class="muted">Pick a club.</p>';return;}const squad=players.filter(p=>p.club===club).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));if(!squad.length){el.innerHTML=emptyState();return;}let h='<h3>Top 5 danger players</h3><table class="data"><thead><tr><th>Player</th><th>Grade</th><th>Goals</th><th>Best</th><th>Score</th></tr></thead><tbody>';squad.slice(0,5).forEach(p=>{h+='<tr><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.goals||0)+'</td><td>'+bestCount(p)+'</td><td><b>'+(p.talentScore||0)+'</b></td></tr>';});h+='</tbody></table>';el.innerHTML=h;}
(function(){const s=sel("scoutClub");if(s)s.addEventListener("change",renderScoutReport);})();
// ===== MATCH PREP v2.0 - AUTO COACHES BRIEF =====
function obgfcTeams(){return Array.from(new Set(players.filter(isOwnClub).map(p=>({club:p.club,grade:p.grade})).map(o=>JSON.stringify(o)))).map(s=>JSON.parse(s));}
function nextFixtureFor(club,grade){const now=new Date().toISOString();return games.filter(g=>g.grade===grade&&!isFinal(g)&&gameInvolves(g,club)&&(!gameDateTime(g)||gameDateTime(g)>=now)).sort((a,b)=>gameDateTime(a).localeCompare(gameDateTime(b)))[0]||null;}
function lastFixtureFor(club,grade){return games.filter(g=>g.grade===grade&&isFinal(g)&&gameInvolves(g,club)).sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a)))[0]||null;}

function findObgfcNextFixture(){
  const now=new Date().toISOString();
  const isOB=n=>(n||"").toLowerCase().includes("brighton");
  const upcoming=games.filter(g=>!isFinal(g)&&(isOB(gameHome(g))||isOB(gameAway(g)))&&(!gameDateTime(g)||gameDateTime(g)>=now)).sort((a,b)=>gameDateTime(a).localeCompare(gameDateTime(b)));
  if(upcoming.length){
    const g=upcoming[0];
    const club=isOB(gameHome(g))?gameHome(g):gameAway(g);
    return{team:{club:club,grade:g.grade},fixture:g};
  }
  const past=games.filter(g=>isFinal(g)&&(isOB(gameHome(g))||isOB(gameAway(g)))).sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a)));
  if(past.length){
    const g=past[0];
    const club=isOB(gameHome(g))?gameHome(g):gameAway(g);
    return{team:{club:club,grade:g.grade},fixture:g,isPast:true};
  }
  return null;
}

function buildLadderSimple(grade){
  const done=games.filter(g=>isFinal(g)&&g.grade===grade);
  const t={};
  done.forEach(g=>{
    const hN=gameHome(g),aN=gameAway(g);
    if(!hN||!aN)return;
    const hS=gameHomeScore(g)||0,aS=gameAwayScore(g)||0;
    if(!t[hN])t[hN]={team:hN,wins:0,losses:0,draws:0,pf:0,pa:0};
    if(!t[aN])t[aN]={team:aN,wins:0,losses:0,draws:0,pf:0,pa:0};
    t[hN].pf+=hS;t[hN].pa+=aS;t[aN].pf+=aS;t[aN].pa+=hS;
    if(hS>aS){t[hN].wins++;t[aN].losses++;}
    else if(aS>hS){t[aN].wins++;t[hN].losses++;}
    else{t[hN].draws++;t[aN].draws++;}
  });
  return Object.values(t).map(x=>{x.pts=x.wins*4+x.draws*2;x.pct=x.pa>0?(x.pf/x.pa)*100:0;return x;}).sort((a,b)=>b.pts-a.pts||b.pct-a.pct);
}

function teamLast5(club,grade,ladder){
  const done=games.filter(g=>isFinal(g)&&g.grade===grade&&gameInvolves(g,club)).sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a))).slice(0,5);
  const results=[];
  let weightedScore=0,maxScore=0;
  done.forEach(g=>{
    const isHome=gameHome(g)===club;
    const ourScore=isHome?gameHomeScore(g):gameAwayScore(g);
    const theirScore=isHome?gameAwayScore(g):gameHomeScore(g);
    if(ourScore==null||theirScore==null)return;
    const oppName=isHome?gameAway(g):gameHome(g);
    const won=ourScore>theirScore;
    const drew=ourScore===theirScore;
    let base=0;
    if(won)base=isHome?1.0:1.5;
    else if(drew)base=isHome?0.5:0.75;
    else base=isHome?-1.5:-1.0;
    let bonus=0;
    if(ladder){
      const ourPos=ladder.findIndex(t=>t.team===club);
      const oppPos=ladder.findIndex(t=>t.team===oppName);
      if(ourPos>=0&&oppPos>=0){
        if(won&&oppPos<ourPos)bonus=0.5;
        else if(!won&&!drew&&oppPos>ourPos)bonus=-0.5;
      }
    }
    weightedScore+=base+bonus;
    maxScore+=isHome?1.0:1.5;
    results.push({date:gameDateStr(g),round:g.round,isHome,ourScore,theirScore,oppName,result:won?"W":drew?"D":"L",margin:ourScore-theirScore});
  });
  const pctScore=maxScore>0?Math.round(((weightedScore+maxScore)/(2*maxScore))*100):50;
  return {results:results.reverse(),weightedScore:+weightedScore.toFixed(1),pct:pctScore,wins:results.filter(r=>r.result==="W").length,losses:results.filter(r=>r.result==="L").length,draws:results.filter(r=>r.result==="D").length};
}

function generateCoachingNotes(ownClub,oppName,grade,fixture,ourForm,theirForm,oppSquad,ladder){
  const notes=[];
  const isHome=gameHome(fixture)===ownClub;
  if(isHome){
    notes.push({icon:"HOME",tone:"neutral",text:"We're hosting. Their away form is "+(theirForm.wins)+"W-"+theirForm.losses+"L in last 5. Own the first quarter to set the tone."});
  }else{
    notes.push({icon:"AWAY",tone:"warning",text:"We're travelling. Their home advantage counts - factor into the game plan and pre-game routine."});
  }
  const formGap=ourForm.pct-theirForm.pct;
  if(formGap>=15){
    notes.push({icon:"MOMENTUM",tone:"positive",text:"We enter in stronger form ("+ourForm.pct+"% vs "+theirForm.pct+"%). Take confidence but don't drop intensity."});
  }else if(formGap<=-15){
    notes.push({icon:"CHALLENGE",tone:"negative",text:"They enter in stronger form ("+theirForm.pct+"% vs "+ourForm.pct+"%). Underdog mindset - stay disciplined, stay in the fight."});
  }else{
    notes.push({icon:"BALANCE",tone:"neutral",text:"Form is close ("+ourForm.pct+"% vs "+theirForm.pct+"%). The details will decide this - first-quarter energy and set-piece execution."});
  }
  if(oppSquad.length){
    const topPlayer=oppSquad[0];
    notes.push({icon:"TAG",tone:"warning",text:"Their #1 threat: "+topPlayer.name+" (Talent Score "+topPlayer.talentScore+", "+(topPlayer.goals||0)+" goals, "+bestCount(topPlayer)+" games in best). Plan a matchup - do not let her set the tempo."});
  }
  if(theirForm.losses>=3){
    notes.push({icon:"OPPORTUNITY",tone:"positive",text:"They've lost "+theirForm.losses+" of their last 5. Fragile confidence - press hard early and they may fold."});
  }else if(theirForm.wins>=4){
    notes.push({icon:"WARN",tone:"warning",text:"They've won "+theirForm.wins+" of their last 5. On a run - expect a confident, structured opponent."});
  }
  const avgFor=theirForm.results.length?Math.round(theirForm.results.reduce((s,r)=>s+r.ourScore,0)/theirForm.results.length):0;
  const avgAgainst=theirForm.results.length?Math.round(theirForm.results.reduce((s,r)=>s+r.theirScore,0)/theirForm.results.length):0;
  if(avgAgainst>=70){
    notes.push({icon:"ATTACK",tone:"positive",text:"They're leaking goals ("+avgAgainst+" pts against per game in last 5). Attack the forward line early - reward efficient entries."});
  }
  if(avgFor>=80){
    notes.push({icon:"DEFEND",tone:"warning",text:"They're scoring heavily ("+avgFor+" pts per game). Defensive structure is critical - reduce their inside-50 count."});
  }
  return notes;
}

function renderMatchPrep(){
  const nx=findObgfcNextFixture();
  const cards=["mpAutoHeader","mpHeadToHead","mpHomeAwayForm","mpClassForm","mpVersus","mpDanger","mpFullSquad","mpRecent"];
  if(!nx){
    if(sel("mpAutoHeader")){sel("mpAutoHeader").classList.remove("hidden");sel("mpAutoHeaderContent").innerHTML='<div class="autoheader-team">No upcoming OBGFC fixture found</div><div class="autoheader-meta">Check that fixtures are loaded for your grade.</div>';}
    cards.slice(1).forEach(id=>{const e=sel(id);if(e)e.classList.add("hidden");});
    return;
  }
  const own=nx.team;
  const opp=(gameHome(nx.fixture)===own.club)?gameAway(nx.fixture):gameHome(nx.fixture);
  const fixture=nx.fixture;
  const isHome=gameHome(fixture)===own.club;
  const ladder=buildLadderSimple(own.grade);
  const ourForm=teamLast5(own.club,own.grade,ladder);
  const theirForm=teamLast5(opp,own.grade,ladder);
  let oppSquad=players.filter(p=>p.club===opp&&p.grade===own.grade&&p.name&&p.name.trim().toLowerCase()!=="none none").sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  if(!oppSquad.length){oppSquad=players.filter(p=>p.club===opp&&p.name&&p.name.trim().toLowerCase()!=="none none").sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));}
  if(sel("mpAutoHeader")){
    sel("mpAutoHeader").classList.remove("hidden");
    const badge=isHome?'<div class="venue-badge home">AT HOME</div>':'<div class="venue-badge away">AWAY AT '+opp+'</div>';
    let dateStr=gameDateStr(fixture);
    try{const d=new Date(gameDateTime(fixture));if(!isNaN(d))dateStr=d.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'short'});}catch(e){}
    const roundLabel=fixture.round||"Next";
    const html='<div class="autoheader-team">'+own.club+'</div><div class="autoheader-vs">VS</div><div class="autoheader-team">'+opp+'</div><div class="autoheader-meta">'+roundLabel+' \u00B7 '+dateStr+' \u00B7 '+own.grade+(nx.isPast?' (last meeting)':'')+'</div>'+badge;
    sel("mpAutoHeaderContent").innerHTML=html;
  }
  if(sel("mpHeadToHead")){
    sel("mpHeadToHead").classList.remove("hidden");
    sel("mpHeadToHead").querySelector("h2").textContent="Form Comparison - Last 5 Games";
    const p=sel("mpHeadToHead").querySelector("p");if(p)p.textContent="Weighted for venue difficulty and opponent quality.";
    const renderBlocks=(f)=>{return f.results.map(r=>{const cls=r.result==="W"?"win":r.result==="L"?"loss":"draw";return '<span class="form-block '+cls+'" title="'+r.round+' '+(r.isHome?"H":"A")+' vs '+r.oppName+' '+r.ourScore+'-'+r.theirScore+'">'+r.result+'</span>';}).join("");};
    let html='<div class="h2h-split">';
    html+='<div class="h2h-block h2h-highlight"><div class="h2h-block-label">OBGFC (last 5)</div><div style="margin:8px 0"><span class="form-blocks">'+renderBlocks(ourForm)+'</span></div><div class="h2h-block-record">'+ourForm.pct+'%</div><div class="h2h-block-margin">'+ourForm.wins+'W-'+ourForm.draws+'D-'+ourForm.losses+'L weighted</div></div>';
    html+='<div class="h2h-block"><div class="h2h-block-label">'+opp+' (last 5)</div><div style="margin:8px 0"><span class="form-blocks">'+renderBlocks(theirForm)+'</span></div><div class="h2h-block-record">'+theirForm.pct+'%</div><div class="h2h-block-margin">'+theirForm.wins+'W-'+theirForm.draws+'D-'+theirForm.losses+'L weighted</div></div>';
    html+='</div>';
    sel("mpHeadToHeadContent").innerHTML=html;
  }
  if(sel("mpHomeAwayForm")){
    sel("mpHomeAwayForm").classList.remove("hidden");
    sel("mpHomeAwayForm").querySelector("h2").textContent="Match Verdict";
    const p=sel("mpHomeAwayForm").querySelector("p");if(p)p.textContent="Based on weighted form and matchup context.";
    const formGap=ourForm.pct-theirForm.pct;
    let tone,text;
    if(formGap>=15){tone="positive";text="Form favours OBGFC ("+ourForm.pct+"% vs "+theirForm.pct+"%). Confident approach but stay disciplined - upsets happen when favourites drop intensity.";}
    else if(formGap<=-15){tone="negative";text="Steep test. "+opp+" enters in significantly better form ("+theirForm.pct+"% vs "+ourForm.pct+"%). Underdog mindset, structured game plan, target their weaknesses.";}
    else{tone="neutral";text="Close call. Form separated by "+Math.abs(formGap)+"% - this is a genuine tossup. First-quarter energy and set-piece execution will decide it.";}
    sel("mpHomeAwayFormContent").innerHTML='<div class="haf-verdict tone-'+tone+'"><strong>'+text+'</strong></div>';
  }
  if(sel("mpClassForm")){
    sel("mpClassForm").classList.remove("hidden");
    sel("mpClassForm").querySelector("h2").textContent="Coaching Notes";
    const p=sel("mpClassForm").querySelector("p");if(p)p.textContent="Auto-generated tactical points for this fixture.";
    const notes=generateCoachingNotes(own.club,opp,own.grade,fixture,ourForm,theirForm,oppSquad,ladder);
    let html='';
    notes.forEach(n=>{
      const toneCls=n.tone==="positive"?"tone-positive":n.tone==="negative"?"tone-negative":"tone-neutral";
      html+='<div class="haf-verdict '+toneCls+'" style="margin-top:8px;"><strong>'+n.icon+':</strong> '+n.text+'</div>';
    });
    sel("mpClassFormContent").innerHTML=html;
  }
  if(sel("mpDanger")){
    sel("mpDanger").classList.remove("hidden");
    sel("mpDanger").querySelector("h2").textContent="Their Top 5 - Watch these players";
    renderTop5("mpDangerList",oppSquad.slice(0,5),"Talent",p=>p.talentScore||0,{label:"Games",fn:p=>p.games||0});
  }
  ["mpVersus","mpFullSquad","mpRecent"].forEach(id=>{const e=sel(id);if(e)e.classList.add("hidden");});
}
// ===== ROUND LOG =====
function selectedRLGrade(){const e=sel("rlGrade");return e?(e.value||""):"";}
function selectedRLFormWindow(){const e=sel("rlFormWindow");return e?parseInt(e.value||"3",10):3;}
function buildTeamForm(grade,window){
  const done=games.filter(g=>isFinal(g)).filter(g=>!grade||g.grade===grade).sort((a,b)=>gameDateTime(a).localeCompare(gameDateTime(b)));
  const byT={};
  done.forEach(g=>{const hN=gameHome(g),aN=gameAway(g);const hS=gameHomeScore(g)||0,aS=gameAwayScore(g)||0;const hOut=homeOutcome(g),aOut=awayOutcome(g);const rec=(sN,oN,sF,sA,oc)=>{if(!sN)return;const k=sN+"||"+g.grade;if(!byT[k])byT[k]={team:sN,grade:g.grade,results:[]};const r=oc==="WON"?"W":oc==="LOST"?"L":oc==="DRAW"?"D":"?";byT[k].results.push({date:gameDateStr(g),round:g.round,opponent:oN||"",scoreFor:sF,scoreAgainst:sA,result:r});};rec(hN,aN,hS,aS,hOut);rec(aN,hN,aS,hS,aOut);});
  return Object.values(byT).map(t=>{const lN=t.results.slice(-window);const w=lN.filter(r=>r.result==="W").length,l=lN.filter(r=>r.result==="L").length,d=lN.filter(r=>r.result==="D").length;const pts=w*3+d,max=lN.length*3,pct=max?+((pts/max)*100).toFixed(0):0;const tr=pct>=67?"hot":pct<=33?"cold":"even";const tF=lN.reduce((s,r)=>s+r.scoreFor,0),tA=lN.reduce((s,r)=>s+r.scoreAgainst,0);const aM=lN.length?+(((tF-tA)/lN.length)).toFixed(0):0;return{team:t.team,grade:t.grade,results:lN,wins:w,losses:l,draws:d,pts,pct,trend:tr,avgMargin:aM,gamesPlayed:t.results.length};}).sort((a,b)=>b.pct-a.pct||b.avgMargin-a.avgMargin||b.wins-a.wins);
}
function renderFormBlocks(res,win){const b=[...res];while(b.length<win)b.unshift({result:"tbd"});return '<span class="form-blocks">'+b.map(r=>{const c=r.result==="W"?"win":r.result==="L"?"loss":r.result==="D"?"draw":"tbd";const l=r.result&&r.result!=="tbd"?r.result:"\u00B7";return '<span class="form-block '+c+'">'+l+'</span>';}).join("")+'</span>';}
function renderTeamFormBoard(grade,win){const teams=buildTeamForm(grade,win);const el=sel("rlTeamForm");if(!teams.length){el.innerHTML=emptyState();return;}let h='<table class="data"><thead><tr><th>#</th><th>Team</th>'+(grade?'':'<th>Grade</th>')+'<th>Last '+win+'</th><th>Pts</th><th>%</th><th>Margin</th><th>W-D-L</th></tr></thead><tbody>';teams.forEach((t,i)=>{const own=isOwnClubName(t.team);const cls=t.trend==="hot"?"hot":t.trend==="cold"?"cold":"";const d=own?'<span class="own-club">\u25CF</span> ':'';h+='<tr class="team-form-row '+cls+'"><td>'+(i+1)+'</td><td>'+d+t.team+'</td>'+(grade?'':'<td class="muted">'+t.grade+'</td>')+'<td>'+renderFormBlocks(t.results,win)+'</td><td>'+t.pts+' / '+(win*3)+'</td><td>'+t.pct+'%</td><td>'+(t.avgMargin>0?"+":"")+t.avgMargin+'</td><td>'+t.wins+'-'+t.draws+'-'+t.losses+'</td></tr>';});h+='</tbody></table>';el.innerHTML=h;}
function buildPlayerMovers(grade){return players.filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none"&&(!grade||p.grade===grade)&&(p.history||[]).length>=2).map(p=>{const h=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));const last=h[h.length-1],prior=h.slice(0,-1);const lTs=gameTalentScore(last);const pA=prior.length?prior.reduce((s,x)=>s+gameTalentScore(x),0)/prior.length:0;return{...p,_lastTs:lTs,_priorAvg:+pA.toFixed(1),_delta:+(lTs-pA).toFixed(1),_lastRound:last.round,_lastOpp:last.opponent};});}
function renderPlayerMovers(grade){const m=buildPlayerMovers(grade);const c=[...m].sort((a,b)=>b._delta-a._delta).slice(0,10);const f=[...m].sort((a,b)=>a._delta-b._delta).slice(0,10);const rM=(id,rows,cls)=>{const el=sel(id);if(!rows.length){el.innerHTML=emptyState();return;}let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Last round</th><th>This</th><th>Prior</th><th>\u0394</th></tr></thead><tbody>';rows.forEach((p,i)=>{const dc=p._delta>0?"form-up":p._delta<0?"form-down":"form-flat";const ts=p._delta>0?"\u25B2":p._delta<0?"\u25BC":"\u25AC";h+='<tr class="'+cls+'"><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p._lastRound||"")+' vs '+(p._lastOpp||"?")+'</td><td>'+p._lastTs+'</td><td>'+p._priorAvg+'</td><td><span class="'+dc+'">'+ts+' '+(p._delta>0?"+":"")+p._delta+'</span></td></tr>';});h+='</tbody></table>';el.innerHTML=h;};rM("rlClimbers",c,"mover-up");rM("rlFaders",f,"mover-down");}
function renderBigResults(grade){const el=sel("rlBigResults");const pool=games.filter(g=>isFinal(g)).filter(g=>!grade||g.grade===grade);const sorted=[...pool].sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a)));if(!sorted.length){el.innerHTML=emptyState();return;}const ld=gameDateStr(sorted[0]);const co=new Date(ld);co.setDate(co.getDate()-6);const cs=co.toISOString().slice(0,10);const last=pool.filter(g=>gameDateStr(g)>=cs);const rk=last.map(g=>{const hs=gameHomeScore(g)||0,as=gameAwayScore(g)||0;return{...g,_m:Math.abs(hs-as),_hs:hs,_as:as};}).sort((a,b)=>b._m-a._m).slice(0,8);if(!rk.length){el.innerHTML=emptyState();return;}let h='<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th><th>Margin</th></tr></thead><tbody>';rk.forEach(g=>{h+='<tr><td>'+gameDateStr(g)+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+gameHome(g)+'</td><td><b>'+g._hs+'</b></td><td>'+gameAway(g)+'</td><td><b>'+g._as+'</b></td><td><b>'+g._m+'</b></td></tr>';});h+='</tbody></table>';el.innerHTML=h;}
function renderRoundLog(){const g=selectedRLGrade(),w=selectedRLFormWindow();renderTeamFormBoard(g,w);renderPlayerMovers(g);renderBigResults(g);}
["rlGrade","rlFormWindow"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("change",renderRoundLog);});
  // ===== FINALS PATH =====
function selectedFPGrade(){const e=sel("fpGrade");return e?(e.value||""):"";}
function selectedFPFinalsSpots(){const e=sel("fpFinalsSpots");return e?parseInt(e.value||"4",10):4;}
function selectedFPPtsWin(){const e=sel("fpPtsWin");const v=e?parseInt(e.value||"4",10):4;return Math.max(1,Math.min(4,v));}
function buildLadder(grade,ptsPerWin){
  ptsPerWin=ptsPerWin||4;const ptsPerDraw=Math.floor(ptsPerWin/2);
  const done=games.filter(g=>isFinal(g)&&g.grade===grade);
  const upc=games.filter(g=>!isFinal(g)&&g.grade===grade);
  const bT={};
  const ens=n=>{if(!n)return null;if(!bT[n])bT[n]={team:n,played:0,wins:0,losses:0,draws:0,pointsFor:0,pointsAgainst:0,upcoming:[]};return bT[n];};
  done.forEach(g=>{const hN=gameHome(g),aN=gameAway(g);if(!hN||!aN)return;const hS=gameHomeScore(g)||0,aS=gameAwayScore(g)||0;const hT=ens(hN),aT=ens(aN);hT.played++;aT.played++;hT.pointsFor+=hS;hT.pointsAgainst+=aS;aT.pointsFor+=aS;aT.pointsAgainst+=hS;const hOut=homeOutcome(g);if(hOut==="WON"){hT.wins++;aT.losses++;}else if(hOut==="LOST"){aT.wins++;hT.losses++;}else if(hOut==="DRAW"){hT.draws++;aT.draws++;}});
  upc.forEach(g=>{const hN=gameHome(g),aN=gameAway(g);if(!hN||!aN)return;const hT=ens(hN),aT=ens(aN);hT.upcoming.push({opponent:aN,date:gameDateTime(g),round:g.round,home:true});aT.upcoming.push({opponent:hN,date:gameDateTime(g),round:g.round,home:false});});
  return Object.values(bT).map(t=>{t.ladderPts=t.wins*ptsPerWin+t.draws*ptsPerDraw;t.percentage=t.pointsAgainst>0?+((t.pointsFor/t.pointsAgainst)*100).toFixed(1):0;t.remaining=t.upcoming.length;t.maxPossiblePts=t.ladderPts+t.remaining*ptsPerWin;return t;}).sort((a,b)=>b.ladderPts-a.ladderPts||b.percentage-a.percentage);
}
function projectCutline(ladder,spots,ptsPerWin){if(ladder.length<spots)return 0;const c=ladder[spots-1];if(c.played===0)return 0;const wr=c.wins/c.played;return c.ladderPts+Math.round(wr*c.remaining)*ptsPerWin;}
function renderFinalsPath(){
  const grade=selectedFPGrade();const spots=selectedFPFinalsSpots();const ptsPerWin=selectedFPPtsWin();
  const ladder=buildLadder(grade,ptsPerWin);
  if(!ladder.length){sel("fpLadder").innerHTML=emptyState();sel("fpVerdict").innerHTML=emptyState();sel("fpScenarios").innerHTML="";sel("fpRemaining").innerHTML="";return;}
  const cutline=projectCutline(ladder,spots,ptsPerWin);
  const obgfcRow=ladder.find(t=>isOwnClubName(t.team));
  let lh='<table class="data"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>D</th><th>%</th><th>Pts</th><th>Rem</th></tr></thead><tbody>';
  ladder.forEach((t,i)=>{const own=isOwnClubName(t.team);const dot=own?'<span class="own-club">\u25CF</span> ':'';let cls="";if(i<spots)cls="finals-row";lh+='<tr class="'+cls+'"><td>'+(i+1)+'</td><td>'+dot+t.team+'</td><td>'+t.played+'</td><td>'+t.wins+'</td><td>'+t.losses+'</td><td>'+t.draws+'</td><td>'+t.percentage+'</td><td><b>'+t.ladderPts+'</b></td><td>'+t.remaining+'</td></tr>';if(i===spots-1){lh+='<tr class="cutline-marker"><td colspan="9">FINALS CUTLINE - projected ~'+cutline+' pts</td></tr>';}});
  lh+='</tbody></table>';sel("fpLadder").innerHTML=lh;
  if(!obgfcRow){sel("fpVerdict").innerHTML='<p class="muted">No OBGFC team in '+grade+'.</p>';sel("fpScenarios").innerHTML="";sel("fpRemaining").innerHTML="";return;}
  const pos=ladder.findIndex(t=>t.team===obgfcRow.team)+1;
  const gap=obgfcRow.ladderPts-cutline;const maxGap=obgfcRow.maxPossiblePts-cutline;
  let status,emoji,headline,detail,cls;
  const ord=n=>n===1?"st":n===2?"nd":n===3?"rd":"th";
  if(pos<=spots&&gap>=(obgfcRow.remaining*ptsPerWin)){status="Guaranteed";emoji="\uD83C\uDFC6";headline="Finals locked in";detail="OBGFC is "+pos+ord(pos)+" and mathematically safe.";cls="safe";}
  else if(pos<=spots){status="In the four";emoji="\uD83D\uDFE2";headline="Currently "+pos+ord(pos);detail="You're inside the cut by "+gap+" pts.";cls="safe";}
  else if(maxGap>=0){status="In the mix";emoji="\uD83D\uDFE1";headline=Math.abs(gap)+" pts off the cut";detail="Need to win "+Math.ceil(Math.abs(gap)/ptsPerWin)+"+ of your remaining "+obgfcRow.remaining+" games.";cls="risky";}
  else{status="Eliminated";emoji="\uD83D\uDD34";headline="Finals unreachable";detail="Even winning out leaves you "+Math.abs(maxGap)+" pts short.";cls="dire";}
  sel("fpVerdict").innerHTML='<div class="verdict-hero '+cls+'"><div class="verdict-emoji">'+emoji+'</div><div class="verdict-status">'+status+'</div><div class="verdict-headline">'+headline+'</div><div class="verdict-detail">'+detail+'</div></div>';
  const winsNeeded=Math.max(0,Math.ceil((cutline-obgfcRow.ladderPts)/ptsPerWin));
  const safeW=Math.min(obgfcRow.remaining,Math.max(winsNeeded,Math.ceil(obgfcRow.remaining*0.7)));
  const liveW=Math.min(obgfcRow.remaining,Math.max(0,winsNeeded));
  sel("fpScenarios").innerHTML='<div class="scenario-grid"><div class="scenario-card safe"><div class="scenario-header">Safe path</div><div class="scenario-title">Guaranteed</div><div class="scenario-req">Win <b>'+safeW+' of '+obgfcRow.remaining+'</b></div></div><div class="scenario-card live"><div class="scenario-header">Live path</div><div class="scenario-title">In the mix</div><div class="scenario-req">Win <b>'+liveW+' of '+obgfcRow.remaining+'</b></div></div><div class="scenario-card longshot"><div class="scenario-header">Long shot</div><div class="scenario-title">Win out</div><div class="scenario-req">Win <b>all '+obgfcRow.remaining+'</b></div></div></div>';
  const rEl=sel("fpRemaining");
  if(!obgfcRow.upcoming.length){rEl.innerHTML=emptyState("Season complete.");}
  else{let h='<table class="data"><thead><tr><th>Round</th><th>Date</th><th>Venue</th><th>Opponent</th></tr></thead><tbody>';obgfcRow.upcoming.forEach(f=>{h+='<tr><td>'+(f.round||"")+'</td><td>'+((f.date||"").slice(0,10))+'</td><td>'+(f.home?"Home":"Away")+'</td><td>'+f.opponent+'</td></tr>';});h+='</tbody></table>';rEl.innerHTML=h;}
}
["fpGrade","fpFinalsSpots","fpPtsWin"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("change",renderFinalsPath);});
// ===== WATCHLIST / SETTINGS =====
function renderWatchlist(){const el=sel("watchlistView");if(!el)return;const list=players.filter(p=>watchlist.indexOf(p.id)>=0).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));if(!list.length){el.innerHTML=emptyState("Your watchlist is empty.");return;}let h='<table class="data"><thead><tr><th>Player</th><th>Club</th><th>Grade</th><th>Score</th><th></th></tr></thead><tbody>';list.forEach(p=>{h+='<tr><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+(p.talentScore||0)+'</b></td><td><button class="star" data-pid="'+p.id+'">\u2605</button></td></tr>';});h+='</tbody></table>';el.innerHTML=h;}
function renderSettings(){const e=sel("setLastSync");if(e)e.textContent=lastSync?new Date(lastSync).toLocaleString():"never";}
const rb=sel("refreshBtn");if(rb)rb.addEventListener("click",loadData);
["lbMetric","lbMinGames","lbGrade"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("input",renderLeaderboards);});
["gradeFilter","formWindow"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("input",renderDashboard);});

loadData();
})();
