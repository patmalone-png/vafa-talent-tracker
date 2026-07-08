// VAFA Talent ID v1.8 - schema-aligned to actual PlayHQ output
(function(){
"use strict";

let games=[], players=[], lastSync=null;
let watchlist=JSON.parse(localStorage.getItem("vafa_watchlist")||"[]");

const OWN_CLUB_KEYWORDS=["old brighton"];
function isOwnClub(p){return OWN_CLUB_KEYWORDS.some(kw=>(p.club||"").toLowerCase().includes(kw));}
function isOwnClubName(n){return OWN_CLUB_KEYWORDS.some(kw=>(n||"").toLowerCase().includes(kw));}

function gameHome(g){ return g.homeTeam || (g.home&&g.home.name) || ""; }
function gameAway(g){ return g.awayTeam || (g.away&&g.away.name) || ""; }
function gameHomeScore(g){
  if(typeof g.homeScore==="number") return g.homeScore;
  if(g.home && g.home.score && g.home.score.points!=null) return g.home.score.points;
  return null;
}
function gameAwayScore(g){
  if(typeof g.awayScore==="number") return g.awayScore;
  if(g.away && g.away.score && g.away.score.points!=null) return g.away.score.points;
  return null;
}
function gameDateStr(g){ return (g.date || g.dateTime || "").slice(0,10); }
function gameDateTime(g){ return g.dateTime || g.date || ""; }
function isFinal(g){ return (g.status||"").toUpperCase()==="FINAL"; }
function homeOutcome(g){
  const hs=gameHomeScore(g), as=gameAwayScore(g);
  if(hs==null || as==null) return null;
  if(hs>as) return "WON";
  if(hs<as) return "LOST";
  return "DRAW";
}
function awayOutcome(g){
  const o=homeOutcome(g);
  if(o==="WON") return "LOST";
  if(o==="LOST") return "WON";
  if(o==="DRAW") return "DRAW";
  return null;
}
function gameInvolves(g,club){ return gameHome(g)===club || gameAway(g)===club; }

function talentScore(p){
  const g=Math.max(1,p.games||1);
  const raw=((p.bog||0)*8)+((p.bogFirsts||0)*6)+((p.goals||0)*5)+((p.wins||0)*2);
  return +(raw/Math.sqrt(g)).toFixed(1);
}
function bestCount(p){
  if(typeof p.bestCount==="number") return p.bestCount;
  return (p.history||[]).filter(h=>(h.bog||0)>0||h.inBest).length;
}
function gameTalentScore(h){
  if(typeof h.talentScore==="number") return h.talentScore;
  return (h.goals||0)*5+(h.bog||0)*8+((h.bog===6)?6:0)+(h.won?2:0);
}
function formIndicator(p,window){
  const hist=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  if(hist.length<window+2) return null;
  const recent=hist.slice(-window), earlier=hist.slice(0,-window);
  const avg=arr=>arr.length?arr.reduce((s,h)=>s+gameTalentScore(h),0)/arr.length:0;
  const r=avg(recent), e=avg(earlier);
  const delta=+(r-e).toFixed(1);
  const trend=delta>1?"\u25B2":delta<-1?"\u25BC":"\u25AC";
  return {recent:+r.toFixed(1),earlier:+e.toFixed(1),delta,trend};
}

function sel(id){return document.getElementById(id);}
function selectedGrade(){const e=sel("gradeFilter");return e?(e.value||""):"";}
function selectedFormWindow(){const e=sel("formWindow");return e?parseInt(e.value||"3",10):3;}
function applyGrade(list){const g=selectedGrade();return g?list.filter(x=>(x.grade||"")===g):list;}

function discoverGrades(){
  const set=new Set();
  games.forEach(g=>{ if(g.grade) set.add(g.grade); });
  players.forEach(p=>{ if(p.grade) set.add(p.grade); });
  return Array.from(set).sort();
}
function populateGradeDropdown(id, includeAllOption){
  const dd=sel(id);
  if(!dd) return;
  const currentValue=dd.value;
  while(dd.options.length) dd.remove(0);
  if(includeAllOption){
    const o=document.createElement("option");
    o.value=""; o.textContent="All Women's grades";
    dd.appendChild(o);
  }
  discoverGrades().forEach(g=>{
    const o=document.createElement("option");
    o.value=g; o.textContent=g;
    dd.appendChild(o);
  });
  if(currentValue && [...dd.options].some(o=>o.value===currentValue)){
    dd.value=currentValue;
  }
}
function populateAllGradeDropdowns(){
  populateGradeDropdown("gradeFilter", true);
  populateGradeDropdown("lbGrade", true);
  populateGradeDropdown("rlGrade", true);
  populateGradeDropdown("fpGrade", false);
}

async function loadData(){
  try{
    const [gR,pR]=await Promise.all([
      fetch("data/games.json",{cache:"no-store"}),
      fetch("data/players.json",{cache:"no-store"})
    ]);
    games=gR.ok?await gR.json():[];
    players=pR.ok?await pR.json():[];
  }catch(e){games=[];players=[];}
  players.forEach(p=>{if(typeof p.talentScore!=="number")p.talentScore=talentScore(p);});
  lastSync=localStorage.getItem("vafa_last_render")||new Date().toISOString();
  localStorage.setItem("vafa_last_render",new Date().toISOString());
  populateAllGradeDropdowns();
  populateClubDropdown();
  populateMatchPrepDropdowns();
  renderAll();
}

function renderAll(){
  renderDashboard();renderLeaderboards();renderPlayerList();
  renderScoutReport();renderMatchPrep();renderRoundLog();
  renderFinalsPath();renderWatchlist();renderSettings();
  const s=lastSync?new Date(lastSync).toLocaleString():"never";
  const ls=sel("lastSync");if(ls)ls.textContent="Last sync: "+s;
}

sel("tabs").addEventListener("click",e=>{
  const b=e.target.closest(".tab");if(!b)return;
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
  b.classList.add("active");
  sel(b.dataset.tab).classList.add("active");
});

function emptyState(m){return '<div class="empty">'+(m||"No data yet.")+'</div>';}
function playerLink(p){
  const own=isOwnClub(p)?'<span class="own-club" title="OBGFC">\u25CF</span> ':'';
  return own+'<a href="#" class="player-link" data-pid="'+p.id+'">'+(p.name||"Unknown")+'</a>';
}
function renderTop5(id,rows,label,vf,ex){
  const el=sel(id);if(!el)return;
  if(!rows.length){el.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>'+label+'</th>'+(ex?'<th>'+ex.label+'</th>':'')+'</tr></thead><tbody>';
  rows.forEach((p,i)=>{
    h+='<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+vf(p)+'</b></td>'+(ex?'<td>'+ex.fn(p)+'</td>':'')+'</tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}

function renderDashboard(){
  const pool=applyGrade(players).filter(p=>p.name&&p.name.trim()&&p.name.trim().toLowerCase()!=="none none");
  const fxPool=applyGrade(games);
  const fw=selectedFormWindow();
  sel("t-games").textContent=fxPool.length||"0";
  sel("t-players").textContent=pool.length||"0";
  const top=[...pool].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0))[0];
  sel("t-top").textContent=top?top.talentScore:"-";
  sel("t-sync").textContent=lastSync?new Date(lastSync).toLocaleDateString():"-";
  const q=pool.filter(p=>(p.games||0)>=3);
  renderTop5("topTalent",[...q].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0)).slice(0,5),"Score",p=>p.talentScore||0,{label:"Games",fn:p=>p.games||0});
  renderTop5("topBest",[...pool].map(p=>({...p,_best:bestCount(p)})).sort((a,b)=>b._best-a._best||(b.talentScore||0)-(a.talentScore||0)).slice(0,5),"In best",p=>p._best,{label:"Games",fn:p=>p.games||0});
  renderTop5("topGoals",[...pool].sort((a,b)=>(b.goals||0)-(a.goals||0)||(b.talentScore||0)-(a.talentScore||0)).slice(0,5),"Goals",p=>p.goals||0,{label:"Per game",fn:p=>p.games?(p.goals/p.games).toFixed(2):"0"});
  const formed=q.map(p=>({...p,_form:formIndicator(p,fw)})).filter(p=>p._form).sort((a,b)=>b._form.delta-a._form.delta).slice(0,5);
  renderTop5("topForm",formed,"\u0394 vs avg",p=>'<span class="'+(p._form.delta>0?'form-up':p._form.delta<0?'form-down':'form-flat')+'">'+p._form.trend+' '+p._form.delta+'</span>',{label:"Last "+fw+" avg",fn:p=>p._form.recent});
  const fx=[...fxPool].sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a))).slice(0,8);
  const fEl=sel("recentFixtures");
  if(!fx.length){fEl.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
  fx.forEach(g=>{
    const hs=gameHomeScore(g); const as=gameAwayScore(g);
    h+='<tr><td>'+gameDateStr(g)+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+gameHome(g)+'</td><td><b>'+(hs!=null?hs:"-")+'</b></td><td>'+gameAway(g)+'</td><td><b>'+(as!=null?as:"-")+'</b></td></tr>';
  });
  h+='</tbody></table>';fEl.innerHTML=h;
}

function renderLeaderboards(){
  const metric=(sel("lbMetric")||{}).value||"talentScore";
  const minG=parseInt((sel("lbMinGames")||{}).value||"1",10);
  const grade=(sel("lbGrade")||{}).value||"";
  let pool=players.filter(p=>(p.games||0)>=minG&&p.name&&p.name.trim()&&p.name.trim().toLowerCase()!=="none none");
  if(grade)pool=pool.filter(p=>p.grade===grade);
  const gv=p=>{
    if(metric==="talentScore")return p.talentScore||0;
    if(metric==="bog")return p.bog||0;
    if(metric==="bogFirsts")return p.bogFirsts||0;
    if(metric==="bestCount")return bestCount(p);
    if(metric==="goals")return p.goals||0;
    if(metric==="wins")return p.wins||0;
    return 0;
  };
  pool.sort((a,b)=>gv(b)-gv(a));
  const el=sel("lbTable");
  if(!pool.length){el.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Games</th><th>'+metric+'</th></tr></thead><tbody>';
  pool.slice(0,30).forEach((p,i)=>{
    h+='<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td><b>'+gv(p)+'</b></td></tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}

function renderPlayerList(){
  const q=(sel("playerSearch").value||"").toLowerCase();
  const filtered=players.filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none"&&(!q||(p.name||"").toLowerCase().includes(q)||(p.club||"").toLowerCase().includes(q))).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  const el=sel("playerList");
  if(!filtered.length){el.innerHTML=emptyState();return;}
  let h='<table class="data"><thead><tr><th></th><th>Player</th><th>Club</th><th>Grade</th><th>Score</th><th></th></tr></thead><tbody>';
  filtered.slice(0,200).forEach(p=>{
    const st=watchlist.indexOf(p.id)>=0;
    h+='<tr><td><button class="star" data-pid="'+p.id+'">'+(st?'\u2605':'\u2606')+'</button></td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+(p.talentScore||0)+'</b></td><td><button class="btn small" data-pid="'+p.id+'" data-action="open">View</button></td></tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}
sel("playerSearch").addEventListener("input",renderPlayerList);
document.addEventListener("click",e=>{
  const link=e.target.closest(".player-link, [data-action='open']");
  if(link){e.preventDefault();openProfile(link.dataset.pid);return;}
  const star=e.target.closest(".star");
  if(star){
    const id=star.dataset.pid;
    if(watchlist.indexOf(id)>=0)watchlist=watchlist.filter(x=>x!==id);
    else watchlist.push(id);
    localStorage.setItem("vafa_watchlist",JSON.stringify(watchlist));
    renderPlayerList();renderWatchlist();renderDashboard();
  }
});
sel("backToList").addEventListener("click",()=>{
  sel("playerProfile").classList.add("hidden");
  sel("playerList").classList.remove("hidden");
  document.querySelector('.tab[data-tab="players"]').click();
});
function openProfile(pid){
  const p=players.find(x=>x.id===pid);if(!p)return;
  document.querySelector('.tab[data-tab="players"]').click();
  sel("playerList").classList.add("hidden");
  sel("playerProfile").classList.remove("hidden");
  sel("profileName").textContent=p.name;
  sel("profileMeta").textContent=[p.club,p.grade,"#"+(p.number||""),(p.games||0)+" games","Goals: "+(p.goals||0),"In best: "+bestCount(p),"Talent: "+(p.talentScore||0)].filter(Boolean).join(" \u00B7 ");
  const tiles=[["Goals",p.goals||0,p.games?(p.goals/p.games).toFixed(2):"0"],["BOG votes",p.bog||0,p.games?(p.bog/p.games).toFixed(2):"0"],["BOG firsts",p.bogFirsts||0,""],["In best",bestCount(p),""],["Wins",p.wins||0,""],["Captain",p.captainGames||0,""]].map(function(x){var l=x[0],t=x[1],pg=x[2];return '<div class="tile"><div class="tile-label">'+l+'</div><div class="tile-value">'+t+'</div>'+(pg?'<div class="muted">'+pg+' / game</div>':'')+'</div>';}).join("");
  sel("profileStats").innerHTML='<div class="tiles">'+tiles+'</div>';
  const hist=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  drawSparkline("profileChart",hist.map(h=>gameTalentScore(h)));
  const gEl=sel("profileGames");
  if(!hist.length){gEl.innerHTML=emptyState("No per-game data.");return;}
  let h='<table class="data"><thead><tr><th>Date</th><th>Round</th><th>Grade</th><th>Opp</th><th>G</th><th>BOG</th><th>W</th><th>Score</th></tr></thead><tbody>';
  hist.forEach(hh=>{
    h+='<tr><td>'+(hh.date||"")+'</td><td>'+(hh.round||"")+'</td><td class="muted">'+(hh.grade||"")+'</td><td>'+(hh.opponent||"")+'</td><td>'+(hh.goals||0)+'</td><td>'+(hh.bog||0)+'</td><td>'+(hh.won?"\u2713":"")+'</td><td><b>'+gameTalentScore(hh)+'</b></td></tr>';
  });
  h+='</tbody></table>';gEl.innerHTML=h;
}
function drawSparkline(id,data){
  const c=sel(id);if(!c||!c.getContext)return;
  const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);
  if(!data.length)return;
  const max=Math.max.apply(null,data.concat([1])),min=Math.min.apply(null,data.concat([0]));
  const pad=10,w=c.width-pad*2,h=c.height-pad*2;
  ctx.strokeStyle="#c9a44c";ctx.lineWidth=2;ctx.beginPath();
  data.forEach((v,i)=>{
    const x=pad+(i/(Math.max(1,data.length-1)))*w;
    const y=pad+h-((v-min)/Math.max(0.001,max-min))*h;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  });
  ctx.stroke();
  ctx.fillStyle="#c9a44c";
  data.forEach((v,i)=>{
    const x=pad+(i/(Math.max(1,data.length-1)))*w;
    const y=pad+h-((v-min)/Math.max(0.001,max-min))*h;
    ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
  });
}

function populateClubDropdown(){
  const s=sel("scoutClub");if(!s)return;
  while(s.options.length>1)s.remove(1);
  Array.from(new Set(players.map(p=>p.club).filter(Boolean))).sort().forEach(c=>{
    const o=document.createElement("option");o.value=c;o.textContent=c;s.appendChild(o);
  });
}
function renderScoutReport(){
  const s=sel("scoutClub");if(!s)return;
  const club=s.value;const el=sel("scoutReport");
  if(!club){el.innerHTML='<p class="muted">Pick a club.</p>';return;}
  const squad=players.filter(p=>p.club===club).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  if(!squad.length){el.innerHTML=emptyState();return;}
  const recent=games.filter(g=>gameInvolves(g,club)).sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a))).slice(0,5);
  let h='<h3>Top 5 danger players</h3><table class="data"><thead><tr><th>Player</th><th>Grade</th><th>Goals</th><th>In best</th><th>Score</th></tr></thead><tbody>';
  squad.slice(0,5).forEach(p=>{
    h+='<tr><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.goals||0)+'</td><td>'+bestCount(p)+'</td><td><b>'+(p.talentScore||0)+'</b></td></tr>';
  });
  h+='</tbody></table><h3>Recent fixtures</h3>';
  if(!recent.length)h+=emptyState("No recent fixtures.");
  else{
    h+='<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
    recent.forEach(g=>{
      const hs=gameHomeScore(g); const as=gameAwayScore(g);
      h+='<tr><td>'+gameDateStr(g)+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+gameHome(g)+'</td><td><b>'+(hs!=null?hs:"-")+'</b></td><td>'+gameAway(g)+'</td><td><b>'+(as!=null?as:"-")+'</b></td></tr>';
    });
    h+='</tbody></table>';
  }
  el.innerHTML=h;
}
(function(){const s=sel("scoutClub");if(s)s.addEventListener("change",renderScoutReport);})();

function obgfcTeams(){
  return Array.from(new Set(players.filter(isOwnClub).map(p=>({club:p.club,grade:p.grade})).map(o=>JSON.stringify(o)))).map(s=>JSON.parse(s)).sort((a,b)=>(a.grade||"").localeCompare(b.grade||""));
}
function nextFixtureFor(club,grade){
  const now=new Date().toISOString();
  return games.filter(g=>g.grade===grade).filter(g=>!isFinal(g)).filter(g=>gameInvolves(g,club)).filter(g=>{const dt=gameDateTime(g);return !dt||dt>=now;}).sort((a,b)=>gameDateTime(a).localeCompare(gameDateTime(b)))[0]||null;
}
function lastFixtureFor(club,grade){
  return games.filter(g=>g.grade===grade).filter(g=>isFinal(g)).filter(g=>gameInvolves(g,club)).sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a)))[0]||null;
}
function populateMatchPrepDropdowns(){
  const own=sel("mpOwnTeam"),opp=sel("mpOpponent");
  if(!own||!opp)return;
  while(own.options.length>1)own.remove(1);
  obgfcTeams().forEach(t=>{
    const o=document.createElement("option");o.value=JSON.stringify(t);
    o.textContent=t.grade?(t.grade+" - "+t.club):t.club;own.appendChild(o);
  });
  while(opp.options.length>1)opp.remove(1);
  Array.from(new Set(players.map(p=>p.club).filter(Boolean))).filter(c=>!isOwnClubName(c)).sort().forEach(c=>{
    const o=document.createElement("option");o.value=c;o.textContent=c;opp.appendChild(o);
  });
}
function autoFillOpponent(){
  const oS=sel("mpOwnTeam"),pS=sel("mpOpponent");
  if(!oS.value)return;
  const t=JSON.parse(oS.value);
  const nxt=nextFixtureFor(t.club,t.grade)||lastFixtureFor(t.club,t.grade);
  if(!nxt)return;
  const o=(gameHome(nxt)===t.club)?gameAway(nxt):gameHome(nxt);
  if(o&&[...pS.options].some(x=>x.value===o))pS.value=o;
}
function selectedOwnTeam(){const v=sel("mpOwnTeam").value;if(!v)return null;try{return JSON.parse(v);}catch(e){return null;}}
function selectedOpponent(){return sel("mpOpponent").value||"";}
function selectedMPFormWindow(){return parseInt(sel("mpFormWindow").value||"3",10);}
function gradeTalentBenchmark(grade,topN){
  topN=topN||20;
  const r=players.filter(p=>p.grade===grade&&(p.games||0)>=3).filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none").sort((a,b)=>(b.talentScore||0)-(a.talentScore||0)).slice(0,topN);
  return r.length?(r[r.length-1].talentScore||0):0;
}
function squadSummary(sq){
  if(!sq.length)return{size:0,avgScore:0,topScore:0,goals:0,best:0,topName:"-"};
  const goals=sq.reduce((s,p)=>s+(p.goals||0),0);
  const best=sq.reduce((s,p)=>s+bestCount(p),0);
  const sorted=[...sq].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  const top=sorted[0];
  return{size:sq.length,avgScore:+(sq.reduce((s,p)=>s+(p.talentScore||0),0)/sq.length).toFixed(1),topScore:top.talentScore||0,topName:top.name||"-",goals,best};
}
function renderVersusComparison(own,opp,oppSquad){
  const card=sel("mpVersus"),vd=sel("mpVersusVerdict");
  if(!card)return;
  if(!own||!opp){card.classList.add("hidden");return;}
  const ourSquad=players.filter(p=>isOwnClub(p)&&p.grade===own.grade&&p.name&&p.name.trim().toLowerCase()!=="none none");
  if(!ourSquad.length){card.classList.add("hidden");return;}
  card.classList.remove("hidden");
  sel("mpVersusOpponent").textContent=opp;
  const us=squadSummary(ourSquad),th=squadSummary(oppSquad);
  const m=[
    {l:"Squad size",a:us.size,b:th.size},
    {l:"Avg talent score",a:us.avgScore,b:th.avgScore},
    {l:"Top talent score",a:us.topScore,b:th.topScore,s:{a:us.topName,b:th.topName}},
    {l:"Total goals",a:us.goals,b:th.goals},
    {l:"Total times in best",a:us.best,b:th.best}
  ];
  let h='<table class="vs-table"><thead><tr><th>Metric</th><th>OBGFC</th><th>'+opp+'</th></tr></thead><tbody>';
  let oA=0,tA=0;
  m.forEach(x=>{
    const aB=x.a>x.b,bB=x.b>x.a;
    if(aB)oA++;else if(bB)tA++;
    const aC=aB?"vs-better":bB?"vs-worse":"vs-equal";
    const bC=bB?"vs-better":aB?"vs-worse":"vs-equal";
    h+='<tr><td>'+x.l+'</td><td><span class="'+aC+'">'+x.a+'</span>'+(x.s?'<span class="vs-edge">'+x.s.a+'</span>':'')+'</td><td><span class="'+bC+'">'+x.b+'</span>'+(x.s?'<span class="vs-edge">'+x.s.b+'</span>':'')+'</td></tr>';
  });
  h+='</tbody></table>';
  sel("mpVersusTable").innerHTML=h;
  let line;
  if(oA>tA)line="OBGFC ahead in "+oA+" of "+m.length+" metrics - favourable matchup on paper.";
  else if(tA>oA)line=opp+" ahead in "+tA+" of "+m.length+" metrics - work to do.";
  else line="Even matchup - "+oA+"-"+tA+" across "+m.length+" metrics.";
  const gap=th.topScore-us.topScore;
  if(Math.abs(gap)>=5){
    line+=gap>0?" Their best ("+th.topName+") outranks ours by "+gap.toFixed(1)+" - plan to tag.":" Our best ("+us.topName+") outranks theirs by "+(-gap).toFixed(1)+" - own that matchup.";
  }
  vd.textContent=line;
}
function renderMatchPrep(){
  const own=selectedOwnTeam(),opp=selectedOpponent(),fw=selectedMPFormWindow();
  const show=y=>{["mpHeader","mpVersus","mpSummary","mpDanger","mpInForm","mpCrossGrade","mpFullSquad","mpRecent"].forEach(id=>{const el=sel(id);if(el)el.classList.toggle("hidden",!y);});};
  if(!opp){show(false);return;}
  show(true);
  let squad=players.filter(p=>p.club===opp);
  if(own){const sg=squad.filter(p=>p.grade===own.grade);if(sg.length)squad=sg;}
  squad=squad.filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none");
  squad.sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  const fx=own?(nextFixtureFor(own.club,own.grade)||lastFixtureFor(own.club,own.grade)):null;
  sel("mpFixtureTitle").textContent=own?(own.club+" vs "+opp):("Preview: "+opp);
  const fm=[];
  if(fx){
    fm.push(gameDateStr(fx));
    if(fx.round)fm.push(fx.round);
    if(own&&own.grade)fm.push(own.grade);
    fm.push(isFinal(fx)?"(last meeting)":"(upcoming)");
  }else if(own)fm.push(own.grade+" - no scheduled fixture");
  sel("mpFixtureMeta").textContent=fm.join(" \u00B7 ");
  renderVersusComparison(own,opp,squad);
  const t=squad.reduce((a,p)=>{a.players++;a.games+=p.games||0;a.goals+=p.goals||0;a.best+=bestCount(p);return a;},{players:0,games:0,goals:0,best:0});
  const ts=squad[0]?squad[0].talentScore:0;
  const as=squad.length?+(squad.reduce((s,p)=>s+(p.talentScore||0),0)/squad.length).toFixed(1):0;
  sel("mpSummaryTiles").innerHTML=[["Squad size",t.players],["Avg talent",as],["Top talent",ts],["Total goals",t.goals],["Times in best",t.best]].map(function(x){return '<div class="tile"><div class="tile-label">'+x[0]+'</div><div class="tile-value">'+x[1]+'</div></div>';}).join("");
  renderTop5("mpDangerList",squad.slice(0,5),"Score",p=>p.talentScore||0,{label:"Games",fn:p=>p.games||0});
  const inF=squad.map(p=>({...p,_form:formIndicator(p,fw)})).filter(p=>p._form&&p._form.delta>0).sort((a,b)=>b._form.delta-a._form.delta).slice(0,5);
  const fEl=sel("mpInFormList");
  if(!inF.length)fEl.innerHTML=emptyState("No players above season avg.");
  else{
    let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Grade</th><th>\u0394</th><th>Last '+fw+' avg</th><th>Season avg</th></tr></thead><tbody>';
    inF.forEach((p,i)=>{
      h+='<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td><span class="form-up">\u25B2 '+p._form.delta+'</span></td><td>'+p._form.recent+'</td><td>'+p._form.earlier+'</td></tr>';
    });
    h+='</tbody></table>';fEl.innerHTML=h;
  }
  const cEl=sel("mpCrossList");
  if(!own)cEl.innerHTML='<p class="muted">Pick your OBGFC team to enable cross-grade detection.</p>';
  else{
    const bench=gradeTalentBenchmark(own.grade,20);
    const cross=players.filter(p=>p.club===opp&&p.grade!==own.grade&&p.name&&p.name.trim().toLowerCase()!=="none none"&&(p.games||0)>=3&&(p.talentScore||0)>=bench).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    if(!cross.length)cEl.innerHTML='<p class="muted">No cross-grade threats. Benchmark: '+bench+'.</p>';
    else{
      let h='<p class="muted">Benchmark: top-20 cut-off in '+own.grade+' = <b>'+bench+'</b>.</p><table class="data"><thead><tr><th>Player</th><th>Their grade</th><th>Games</th><th>In best</th><th>Goals</th><th>Score</th></tr></thead><tbody>';
      cross.slice(0,8).forEach(p=>{
        h+='<tr class="cross-grade-row"><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td>'+bestCount(p)+'</td><td>'+(p.goals||0)+'</td><td><b>'+(p.talentScore||0)+'</b></td></tr>';
      });
      h+='</tbody></table>';cEl.innerHTML=h;
    }
  }
  const fsEl=sel("mpFullSquadList");
  if(!squad.length)fsEl.innerHTML=emptyState();
  else{
    let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Grade</th><th>Games</th><th>In best</th><th>Goals</th><th>Talent</th><th>Form</th></tr></thead><tbody>';
    squad.forEach((p,i)=>{
      const f=formIndicator(p,fw);
      const fc=f?'<span class="'+(f.delta>0?'form-up':f.delta<0?'form-down':'form-flat')+'">'+f.trend+' '+f.delta+'</span>':'<span class="muted">-</span>';
      h+='<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td>'+bestCount(p)+'</td><td>'+(p.goals||0)+'</td><td><b>'+(p.talentScore||0)+'</b></td><td>'+fc+'</td></tr>';
    });
    h+='</tbody></table>';fsEl.innerHTML=h;
  }
  const rEl=sel("mpRecentList");
  const rec=games.filter(g=>gameInvolves(g,opp)).filter(g=>isFinal(g)).sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a))).slice(0,6);
  if(!rec.length)rEl.innerHTML=emptyState("No recent results.");
  else{
    let h='<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th><th>Result</th></tr></thead><tbody>';
    rec.forEach(g=>{
      const hs=gameHomeScore(g); const as=gameAwayScore(g);
      const iH=gameHome(g)===opp;
      const oc=iH?homeOutcome(g):awayOutcome(g);
      const cl=oc==="WON"?"form-up":oc==="LOST"?"form-down":"form-flat";
      h+='<tr><td>'+gameDateStr(g)+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+gameHome(g)+'</td><td><b>'+(hs!=null?hs:"-")+'</b></td><td>'+gameAway(g)+'</td><td><b>'+(as!=null?as:"-")+'</b></td><td><span class="'+cl+'">'+(oc||"-")+'</span></td></tr>';
    });
    h+='</tbody></table>';rEl.innerHTML=h;
  }
}
(function(){
  const o=sel("mpOwnTeam"),p=sel("mpOpponent"),f=sel("mpFormWindow");
  if(o)o.addEventListener("change",()=>{autoFillOpponent();renderMatchPrep();});
  if(p)p.addEventListener("change",renderMatchPrep);
  if(f)f.addEventListener("change",renderMatchPrep);
})();

function selectedRLGrade(){const e=sel("rlGrade");return e?(e.value||""):"";}
function selectedRLFormWindow(){const e=sel("rlFormWindow");return e?parseInt(e.value||"3",10):3;}
function buildTeamForm(grade,window){
  const done=games.filter(g=>isFinal(g)).filter(g=>!grade||g.grade===grade).sort((a,b)=>gameDateTime(a).localeCompare(gameDateTime(b)));
  const byT={};
  done.forEach(g=>{
    const hName=gameHome(g), aName=gameAway(g);
    const hS=gameHomeScore(g)||0, aS=gameAwayScore(g)||0;
    const hOut=homeOutcome(g), aOut=awayOutcome(g);
    const rec=(sideName,oppName,sF,sA,oc)=>{
      if(!sideName)return;
      const k=sideName+"||"+g.grade;
      if(!byT[k])byT[k]={team:sideName,grade:g.grade,results:[]};
      const r=oc==="WON"?"W":oc==="LOST"?"L":oc==="DRAW"?"D":"?";
      byT[k].results.push({date:gameDateStr(g),round:g.round,opponent:oppName||"",scoreFor:sF,scoreAgainst:sA,result:r});
    };
    rec(hName,aName,hS,aS,hOut);rec(aName,hName,aS,hS,aOut);
  });
  return Object.values(byT).map(t=>{
    const lN=t.results.slice(-window);
    const w=lN.filter(r=>r.result==="W").length,l=lN.filter(r=>r.result==="L").length,d=lN.filter(r=>r.result==="D").length;
    const pts=w*3+d,max=lN.length*3,pct=max?+((pts/max)*100).toFixed(0):0;
    const tr=pct>=67?"hot":pct<=33?"cold":"even";
    const tF=lN.reduce((s,r)=>s+r.scoreFor,0),tA=lN.reduce((s,r)=>s+r.scoreAgainst,0);
    const aM=lN.length?+(((tF-tA)/lN.length)).toFixed(0):0;
    return{team:t.team,grade:t.grade,results:lN,wins:w,losses:l,draws:d,pts,pct,trend:tr,avgMargin:aM,gamesPlayed:t.results.length};
  }).sort((a,b)=>b.pct-a.pct||b.avgMargin-a.avgMargin||b.wins-a.wins);
}
function renderFormBlocks(res,win){
  const b=[...res];while(b.length<win)b.unshift({result:"tbd"});
  return '<span class="form-blocks">'+b.map(r=>{
    const c=r.result==="W"?"win":r.result==="L"?"loss":r.result==="D"?"draw":"tbd";
    const l=r.result&&r.result!=="tbd"?r.result:"\u00B7";
    return '<span class="form-block '+c+'">'+l+'</span>';
  }).join("")+'</span>';
}
function renderTeamFormBoard(grade,win){
  const teams=buildTeamForm(grade,win);const el=sel("rlTeamForm");
  if(!teams.length){el.innerHTML=emptyState("No completed games.");return;}
  let h='<table class="data"><thead><tr><th>#</th><th>Team</th>'+(grade?'':'<th>Grade</th>')+'<th>Last '+win+'</th><th>Form pts</th><th>Form %</th><th>Avg margin</th><th>W-D-L</th></tr></thead><tbody>';
  teams.forEach((t,i)=>{
    const own=isOwnClubName(t.team);
    const cls=t.trend==="hot"?"hot":t.trend==="cold"?"cold":"";
    const d=own?'<span class="own-club">\u25CF</span> ':'';
    h+='<tr class="team-form-row '+cls+'"><td>'+(i+1)+'</td><td class="team-name">'+d+t.team+'</td>'+(grade?'':'<td class="muted">'+t.grade+'</td>')+'<td>'+renderFormBlocks(t.results,win)+'</td><td>'+t.pts+' / '+(win*3)+'</td><td class="form-pct">'+t.pct+'%</td><td>'+(t.avgMargin>0?"+":"")+t.avgMargin+'</td><td>'+t.wins+'-'+t.draws+'-'+t.losses+'</td></tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}
function buildPlayerMovers(grade){
  return players.filter(p=>p.name&&p.name.trim().toLowerCase()!=="none none"&&(!grade||p.grade===grade)&&(p.history||[]).length>=2).map(p=>{
    const h=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const last=h[h.length-1],prior=h.slice(0,-1);
    const lTs=gameTalentScore(last);
    const pA=prior.length?prior.reduce((s,x)=>s+gameTalentScore(x),0)/prior.length:0;
    return{...p,_lastTs:lTs,_priorAvg:+pA.toFixed(1),_delta:+(lTs-pA).toFixed(1),_lastRound:last.round,_lastOpp:last.opponent};
  });
}
function renderPlayerMovers(grade){
  const m=buildPlayerMovers(grade);
  const c=[...m].sort((a,b)=>b._delta-a._delta).slice(0,10);
  const f=[...m].sort((a,b)=>a._delta-b._delta).slice(0,10);
  const rM=(id,rows,cls)=>{
    const el=sel(id);
    if(!rows.length){el.innerHTML=emptyState("Need 2+ games.");return;}
    let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Last round</th><th>This game</th><th>Prior avg</th><th>\u0394</th></tr></thead><tbody>';
    rows.forEach((p,i)=>{
      const dc=p._delta>0?"form-up":p._delta<0?"form-down":"form-flat";
      const ts=p._delta>0?"\u25B2":p._delta<0?"\u25BC":"\u25AC";
      h+='<tr class="'+cls+'"><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p._lastRound||"")+' <span class="muted">vs '+(p._lastOpp||"?")+'</span></td><td>'+p._lastTs+'</td><td>'+p._priorAvg+'</td><td><span class="'+dc+'">'+ts+' '+(p._delta>0?"+":"")+p._delta+'</span></td></tr>';
    });
    h+='</tbody></table>';el.innerHTML=h;
  };
  rM("rlClimbers",c,"mover-up");rM("rlFaders",f,"mover-down");
}
function renderNewElite(grade){
  const el=sel("rlNewElite");
  const gs=grade?"Array.from(new Set(players.map(p=>p.grade).filter(Boolean)));
  const out=[];
  gs.forEach(g=>{
    const pool=players.filter(p=>p.grade===g&&p.name&&p.name.trim().toLowerCase()!=="none none"&&(p.history||[]).length>=2);
    if(!pool.length)return;
    const bench=gradeTalentBenchmark(g,20);if(!bench)return;
    pool.forEach(p=>{
      const h=[...(p.history||[])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
      const last=h[h.length-1],prior=h.slice(0,-1);
      const pT=prior.reduce((a,x)=>{a.bog+=(x.bog||0);a.goals+=(x.goals||0);a.wins+=x.won?1:0;a.bogFirsts+=(x.bog===6?1:0);return a;},{bog:0,goals:0,wins:0,bogFirsts:0});
      const pG=Math.max(1,prior.length);
      const pS=+(((pT.bog*8)+(pT.bogFirsts*6)+(pT.goals*5)+(pT.wins*2))/Math.sqrt(pG)).toFixed(1);
      const cS=p.talentScore||0;
      if(pS<bench&&cS>=bench){
        out.push({...p,_priorScore:pS,_benchmark:bench,_lastRound:last.round,_lastOpp:last.opponent,_lastTs:gameTalentScore(last)});
      }
    });
  });
  if(!out.length){el.innerHTML='<p class="muted">No new entrants this round.</p>';return;}
  out.sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  let h='<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Last round</th><th>Game TS</th><th>Now</th><th>Was</th><th>Benchmark</th></tr></thead><tbody>';
  out.forEach((p,i)=>{
    h+='<tr class="elite-new"><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p._lastRound||"")+' <span class="muted">vs '+(p._lastOpp||"?")+'</span></td><td>'+p._lastTs+'</td><td><b>'+(p.talentScore||0)+'</b></td><td>'+p._priorScore+'</td><td class="muted">'+p._benchmark+'</td></tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}
function renderBigResults(grade){
  const el=sel("rlBigResults");
  const pool=games.filter(g=>isFinal(g)).filter(g=>!grade||g.grade===grade);
  const sorted=[...pool].sort((a,b)=>gameDateTime(b).localeCompare(gameDateTime(a)));
  if(!sorted.length){el.innerHTML=emptyState("No completed games.");return;}
  const ld=gameDateStr(sorted[0]);
  const co=new Date(ld);co.setDate(co.getDate()-6);
  const cs=co.toISOString().slice(0,10);
  const last=pool.filter(g=>gameDateStr(g)>=cs);
  const rk=last.map(g=>{
    const hs=gameHomeScore(g)||0,as=gameAwayScore(g)||0;
    return{...g,_m:Math.abs(hs-as),_hs:hs,_as:as};
  }).sort((a,b)=>b._m-a._m).slice(0,8);
  if(!rk.length){el.innerHTML=emptyState("No big results.");return;}
  let h='<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th><th>Margin</th></tr></thead><tbody>';
  rk.forEach(g=>{
    h+='<tr><td>'+gameDateStr(g)+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+gameHome(g)+'</td><td><b>'+g._hs+'</b></td><td>'+gameAway(g)+'</td><td><b>'+g._as+'</b></td><td><b>'+g._m+'</b></td></tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}
function renderRoundLog(){
  const g=selectedRLGrade(),w=selectedRLFormWindow();
  renderTeamFormBoard(g,w);renderPlayerMovers(g);renderNewElite(g);renderBigResults(g);
}
["rlGrade","rlFormWindow"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("change",renderRoundLog);});

function selectedFPGrade(){const e=sel("fpGrade");return e?(e.value||""):"";}
function selectedFPFinalsSpots(){const e=sel("fpFinalsSpots");return e?parseInt(e.value||"4",10):4;}
function selectedFPPtsWin(){const e=sel("fpPtsWin");const v=e?parseInt(e.value||"4",10):4;return Math.max(1,Math.min(4,v));}
function buildLadder(grade,ptsPerWin){
  ptsPerWin=ptsPerWin||4;
  const ptsPerDraw=Math.floor(ptsPerWin/2);
  const done=games.filter(g=>isFinal(g)&&g.grade===grade);
  const upc=games.filter(g=>!isFinal(g)&&g.grade===grade);
  const bT={};
  const ens=n=>{
    if(!n)return null;
    if(!bT[n])bT[n]={team:n,played:0,wins:0,losses:0,draws:0,pointsFor:0,pointsAgainst:0,upcoming:[]};
    return bT[n];
  };
  done.forEach(g=>{
    const hName=gameHome(g),aName=gameAway(g);
    if(!hName||!aName)return;
    const hS=gameHomeScore(g)||0,aS=gameAwayScore(g)||0;
    const hT=ens(hName),aT=ens(aName);
    hT.played++;aT.played++;
    hT.pointsFor+=hS;hT.pointsAgainst+=aS;
    aT.pointsFor+=aS;aT.pointsAgainst+=hS;
    const hOut=homeOutcome(g);
    if(hOut==="WON"){hT.wins++;aT.losses++;}
    else if(hOut==="LOST"){aT.wins++;hT.losses++;}
    else if(hOut==="DRAW"){hT.draws++;aT.draws++;}
  });
  upc.forEach(g=>{
    const hName=gameHome(g),aName=gameAway(g);
    if(!hName||!aName)return;
    const hT=ens(hName),aT=ens(aName);
    hT.upcoming.push({opponent:aName,date:gameDateTime(g),round:g.round,home:true});
    aT.upcoming.push({opponent:hName,date:gameDateTime(g),round:g.round,home:false});
  });
  return Object.values(bT).map(t=>{
    t.ladderPts=t.wins*ptsPerWin+t.draws*ptsPerDraw;
    t.percentage=t.pointsAgainst>0?+((t.pointsFor/t.pointsAgainst)*100).toFixed(1):0;
    t.remaining=t.upcoming.length;
    t.maxPossiblePts=t.ladderPts+t.remaining*ptsPerWin;
    return t;
  }).sort((a,b)=>b.ladderPts-a.ladderPts||b.percentage-a.percentage);
}
function projectCutline(ladder,spots,ptsPerWin){
  if(ladder.length<spots)return 0;
  const cutTeam=ladder[spots-1];
  if(cutTeam.played===0)return 0;
  const winRate=cutTeam.wins/cutTeam.played;
  const projFuturePts=Math.round(winRate*cutTeam.remaining)*ptsPerWin;
  return cutTeam.ladderPts+projFuturePts;
}
function fixtureDifficulty(ourAvg,theirAvg){
  const diff=(theirAvg||0)-(ourAvg||0);
  if(diff>2)return{lvl:"hard",label:"Hard"};
  if(diff<-2)return{lvl:"easy",label:"Winnable"};
  return{lvl:"medium",label:"50/50"};
}
function renderFinalsPath(){
  const grade=selectedFPGrade();
  const spots=selectedFPFinalsSpots();
  const ptsPerWin=selectedFPPtsWin();
  const ladder=buildLadder(grade,ptsPerWin);
  if(!ladder.length){
    sel("fpLadder").innerHTML=emptyState("No games yet for this grade.");
    sel("fpVerdict").innerHTML=emptyState("Pick a grade with completed games.");
    sel("fpScenarios").innerHTML="";
    sel("fpRemaining").innerHTML="";
    sel("fpKeyFixtures").innerHTML="";
    return;
  }
  const cutline=projectCutline(ladder,spots,ptsPerWin);
  const obgfcRow=ladder.find(t=>isOwnClubName(t.team));
  let lh='<table class="data"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>D</th><th>PF</th><th>PA</th><th>%</th><th>Pts</th><th>Remain</th><th>Max</th></tr></thead><tbody>';
  ladder.forEach((t,i)=>{
    const own=isOwnClubName(t.team);
    const dot=own?'<span class="own-club">\u25CF</span> ':'';
    let cls="";
    if(i<spots)cls="finals-row";
    else if(t.maxPossiblePts<cutline-4)cls="eliminated-row";
    lh+='<tr class="'+cls+'"><td>'+(i+1)+'</td><td>'+dot+t.team+'</td><td>'+t.played+'</td><td>'+t.wins+'</td><td>'+t.losses+'</td><td>'+t.draws+'</td><td>'+t.pointsFor+'</td><td>'+t.pointsAgainst+'</td><td>'+t.percentage+'</td><td><b>'+t.ladderPts+'</b></td><td>'+t.remaining+'</td><td class="muted">'+t.maxPossiblePts+'</td></tr>';
    if(i===spots-1){
      lh+='<tr class="cutline-marker"><td colspan="12">FINALS CUTLINE - projected ~'+cutline+' pts</td></tr>';
    }
  });
  lh+='</tbody></table>';
  sel("fpLadder").innerHTML=lh;
  const vEl=sel("fpVerdict");
  if(!obgfcRow){
    vEl.innerHTML='<p class="muted">No OBGFC team found in '+grade+'.</p>';
    sel("fpScenarios").innerHTML="";
    sel("fpRemaining").innerHTML="";
    sel("fpKeyFixtures").innerHTML="";
    return;
  }
  const pos=ladder.findIndex(t=>t.team===obgfcRow.team)+1;
  const gap=obgfcRow.ladderPts-cutline;
  const maxGap=obgfcRow.maxPossiblePts-cutline;
  let status,emoji,headline,detail,cls;
  const ord=n=>n===1?"st":n===2?"nd":n===3?"rd":"th";
  if(pos<=spots&&gap>=(obgfcRow.remaining*ptsPerWin)){
    status="Guaranteed";emoji="\uD83C\uDFC6";
    headline="Finals locked in";
    detail="OBGFC is "+pos+ord(pos)+" and mathematically safe. Focus on top-2 double chance.";
    cls="safe";
  }else if(pos<=spots){
    status="In the four";emoji="\uD83D\uDFE2";
    headline="Currently "+pos+ord(pos)+" - "+gap+" pts inside the cut";
    detail="You're in the finals mix. Winning half your remaining "+obgfcRow.remaining+" games likely secures your spot.";
    cls="safe";
  }else if(maxGap>=0){
    status="In the mix";emoji="\uD83D\uDFE1";
    headline=Math.abs(gap)+" pts off - "+obgfcRow.remaining+" games left";
    detail="Still mathematically alive. Need to win "+Math.ceil(Math.abs(gap)/ptsPerWin)+"+ of your remaining "+obgfcRow.remaining+" fixtures to challenge.";
    cls="risky";
  }else{
    status="Eliminated";emoji="\uD83D\uDD34";
    headline="Finals unreachable this season";
    detail="Even winning out ("+obgfcRow.remaining+" games) leaves you "+Math.abs(maxGap)+" pts short of projected cutline of "+cutline+".";
    cls="dire";
  }
  vEl.innerHTML='<div class="verdict-hero '+cls+'"><div class="verdict-emoji">'+emoji+'</div><div class="verdict-status">'+status+'</div><div class="verdict-headline">'+headline+'</div><div class="verdict-detail">'+detail+'</div></div>';
  const winsNeeded=Math.max(0,Math.ceil((cutline-obgfcRow.ladderPts)/ptsPerWin));
  const safeWins=Math.min(obgfcRow.remaining,Math.max(winsNeeded,Math.ceil(obgfcRow.remaining*0.7)));
  const liveWins=Math.min(obgfcRow.remaining,Math.max(0,winsNeeded));
  const longshotWins=obgfcRow.remaining;
  sel("fpScenarios").innerHTML='<div class="scenario-grid">'+
    '<div class="scenario-card safe"><div class="scenario-header">Safe path</div><div class="scenario-title">Guaranteed finals</div><div class="scenario-req">Win <b>'+safeWins+' of '+obgfcRow.remaining+'</b> remaining games</div><div class="scenario-detail">Should carry you clear regardless of other results.</div></div>'+
    '<div class="scenario-card live"><div class="scenario-header">Live path</div><div class="scenario-title">In the mix</div><div class="scenario-req">Win <b>'+liveWins+' of '+obgfcRow.remaining+'</b> games</div><div class="scenario-detail">Puts you around the cutline but percentage and rival results matter.</div></div>'+
    '<div class="scenario-card longshot"><div class="scenario-header">Long shot</div><div class="scenario-title">Win out + hope</div><div class="scenario-req">Win <b>all '+longshotWins+'</b> remaining and hope rivals slip</div><div class="scenario-detail">Only path if currently below the cut.</div></div>'+
  '</div>';
  const rEl=sel("fpRemaining");
  if(!obgfcRow.upcoming.length){
    rEl.innerHTML=emptyState("No remaining fixtures - season complete.");
  }else{
    const ourAvg=squadSummary(players.filter(p=>isOwnClub(p)&&p.grade===grade)).avgScore;
    let h='<p class="muted">Difficulty based on opponent squad avg talent score vs OBGFC ('+ourAvg+').</p><table class="data"><thead><tr><th>Round</th><th>Date</th><th>Home/Away</th><th>Opponent</th><th>Their avg</th><th>Difficulty</th></tr></thead><tbody>';
    obgfcRow.upcoming.forEach(f=>{
      const oppSquad=players.filter(p=>p.club===f.opponent&&p.grade===grade);
      const theirAvg=squadSummary(oppSquad).avgScore;
      const d=fixtureDifficulty(ourAvg,theirAvg);
      const cls=d.lvl==="hard"?"must-win":d.lvl==="easy"?"winnable":"";
      h+='<tr class="fixture-row '+cls+'"><td>'+(f.round||"")+'</td><td>'+((f.date||"").slice(0,10))+'</td><td>'+(f.home?"Home":"Away")+'</td><td>'+f.opponent+'</td><td>'+theirAvg+'</td><td><span class="fixture-difficulty '+d.lvl+'">'+d.label+'</span></td></tr>';
    });
    h+='</tbody></table>';
    rEl.innerHTML=h;
  }
  const kEl=sel("fpKeyFixtures");
  const bubbleTeams=ladder.slice(Math.max(0,spots-2),spots+3).map(t=>t.team);
  const keyGames=games.filter(g=>g.grade===grade&&!isFinal(g)).filter(g=>{
    const hN=gameHome(g),aN=gameAway(g);
    return bubbleTeams.indexOf(hN)>=0&&bubbleTeams.indexOf(aN)>=0&&!(isOwnClubName(hN)||isOwnClubName(aN));
  }).sort((a,b)=>gameDateTime(a).localeCompare(gameDateTime(b))).slice(0,10);
  if(!keyGames.length){
    kEl.innerHTML=emptyState("No cutline-impact fixtures scheduled between rival teams.");
  }else{
    let h='<p class="muted">Fixtures between teams inside the finals bubble:</p><table class="data"><thead><tr><th>Round</th><th>Date</th><th>Home</th><th>Away</th><th>Impact</th></tr></thead><tbody>';
    keyGames.forEach(g=>{
      h+='<tr><td>'+(g.round||"")+'</td><td>'+gameDateStr(g)+'</td><td>'+gameHome(g)+'</td><td>'+gameAway(g)+'</td><td class="muted">Rival showdown</td></tr>';
    });
    h+='</tbody></table>';
    kEl.innerHTML=h;
  }
}
["fpGrade","fpFinalsSpots","fpPtsWin"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("change",renderFinalsPath);});

function renderWatchlist(){
  const el=sel("watchlistView");if(!el)return;
  const list=players.filter(p=>watchlist.indexOf(p.id)>=0).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
  if(!list.length){el.innerHTML=emptyState("Your watchlist is empty.");return;}
  let h='<table class="data"><thead><tr><th>Player</th><th>Club</th><th>Grade</th><th>Games</th><th>Goals</th><th>In best</th><th>Score</th><th></th></tr></thead><tbody>';
  list.forEach(p=>{
    h+='<tr><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td>'+(p.goals||0)+'</td><td>'+bestCount(p)+'</td><td><b>'+(p.talentScore||0)+'</b></td><td><button class="star" data-pid="'+p.id+'">\u2605</button></td></tr>';
  });
  h+='</tbody></table>';el.innerHTML=h;
}

function renderSettings(){
  const e=sel("setLastSync");if(e)e.textContent=lastSync?new Date(lastSync).toLocaleString():"never";
}
const rb=sel("refreshBtn");if(rb)rb.addEventListener("click",loadData);

["lbMetric","lbMinGames","lbGrade"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("input",renderLeaderboards);});
["gradeFilter","formWindow"].forEach(id=>{const e=sel(id);if(e)e.addEventListener("input",renderDashboard);});

(function(){
  const b=sel("formulaToggle"),bd=sel("formulaBody");
  if(!b||!bd)return;
  b.addEventListener("click",()=>{
    const hid=bd.classList.toggle("hidden");
    b.setAttribute("aria-expanded",hid?"false":"true");
  });
})();

function tableToCSV(t){
  if(!t)return"";
  const rows=[];
  t.querySelectorAll("tr").forEach(tr=>{
    const cs=[];
    tr.querySelectorAll("th,td").forEach(c=>{
      const tx=c.textContent.replace(/\s+/g," ").trim();
      cs.push(/[",\n]/.test(tx)?'"'+tx.replace(/"/g,'""')+'"':tx);
    });
    if(cs.length)rows.push(cs.join(","));
  });
  return rows.join("\n");
}
function downloadCSV(n,csv){
  const grade=(selectedGrade()||selectedRLGrade()||selectedFPGrade()||"all-grades").replace(/[^a-z0-9]+/gi,"-").toLowerCase();
  const st=new Date().toISOString().slice(0,10);
  const fn="vafa-talent-id_"+n+"_"+grade+"_"+st+".csv";
  const bl=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(bl);
  const a=document.createElement("a");a.href=url;a.download=fn;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.addEventListener("click",e=>{
  const b=e.target.closest(".csv-btn");if(!b)return;
  const tId=b.dataset.csv,n=b.dataset.name||"export";
  const t=document.querySelector("#"+tId+" table");
  if(!t){alert("Nothing to export yet.");return;}
  downloadCSV(n,tableToCSV(t));
});

loadData();
})();
