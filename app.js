// VAFA Talent ID — vanilla JS, no modules, no JSX
(function () {
  "use strict";

  // ----- State -----
  let games = [];
  let players = [];
  let lastSync = null;
  let watchlist = JSON.parse(localStorage.getItem("vafa_watchlist") || "[]");

  // ----- OBGFC own-club detection -----
  const OWN_CLUB_KEYWORDS = ["old brighton"];
  function isOwnClub(p) {
    const c = (p.club || "").toLowerCase();
    return OWN_CLUB_KEYWORDS.some(kw => c.includes(kw));
  }
  function isOwnClubName(name) {
    const c = (name || "").toLowerCase();
    return OWN_CLUB_KEYWORDS.some(kw => c.includes(kw));
  }

  // ----- Talent Score helpers -----
  function talentScore(p) {
    const g = Math.max(1, p.games || 1);
    const raw = ((p.bog||0)*8) + ((p.bogFirsts||0)*6) + ((p.goals||0)*5) + ((p.wins||0)*2);
    return +(raw / Math.sqrt(g)).toFixed(1);
  }
  function bestCount(p) {
    if (typeof p.bestCount === "number") return p.bestCount;
    return (p.history || []).filter(h => (h.bog || 0) > 0 || h.inBest).length;
  }
  function gameTalentScore(h) {
    if (typeof h.talentScore === "number") return h.talentScore;
    return (h.goals || 0)*5 + (h.bog || 0)*8 + ((h.bog===6)?6:0) + (h.won?2:0);
  }
  function formIndicator(p, window) {
    const hist = [...(p.history || [])].sort((a,b) => (a.date||"").localeCompare(b.date||""));
    if (hist.length < window + 2) return null;
    const recent = hist.slice(-window), earlier = hist.slice(0, -window);
    const avg = arr => arr.length ? arr.reduce((s,h)=>s+gameTalentScore(h),0)/arr.length : 0;
    const r = avg(recent), e = avg(earlier);
    const delta = +(r - e).toFixed(1);
    const trend = delta > 1 ? "▲" : delta < -1 ? "▼" : "▬";
    return { recent: +r.toFixed(1), earlier: +e.toFixed(1), delta, trend };
  }

  function selectedGrade() { const el = document.getElementById("gradeFilter"); return el ? (el.value || "") : ""; }
  function selectedFormWindow() { const el = document.getElementById("formWindow"); return el ? parseInt(el.value || "3", 10) : 3; }
  function applyGrade(list, key) {
    const g = selectedGrade();
    if (!g) return list;
    return list.filter(x => (x[key || "grade"] || "") === g);
  }

  async function loadData() {
    try {
      const [gRes, pRes] = await Promise.all([
        fetch("data/games.json", {cache: "no-store"}),
        fetch("data/players.json", {cache: "no-store"})
      ]);
      games   = gRes.ok ? await gRes.json() : [];
      players = pRes.ok ? await pRes.json() : [];
    } catch (e) {
      console.warn("Data load failed", e);
      games = []; players = [];
    }
    players.forEach(p => {
      if (typeof p.talentScore !== "number") p.talentScore = talentScore(p);
    });
    lastSync = localStorage.getItem("vafa_last_render") || new Date().toISOString();
    localStorage.setItem("vafa_last_render", new Date().toISOString());
    populateClubDropdown();
    populateMatchPrepDropdowns();
    renderAll();
  }

  function renderAll() {
    renderDashboard(); renderLeaderboards(); renderPlayerList();
    renderScoutReport(); renderMatchPrep(); renderRoundLog();
    renderFinalsPath(); renderWatchlist(); renderSettings();
    const sync = lastSync ? new Date(lastSync).toLocaleString() : "never";
    const ls = document.getElementById("lastSync");
    if (ls) ls.textContent = "Last sync: " + sync;
  }

  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });

  function emptyState(msg) { return '<div class="empty">' + (msg || "No data yet — run the PlayHQ fetch workflow.") + '</div>'; }

  function playerLink(p) {
    const own = isOwnClub(p) ? '<span class="own-club" title="OBGFC">●</span> ' : '';
    return own + '#';
  }

  function renderTop5(elId, rows, metricLabel, valueFn, extraCol) {
    const el = document.getElementById(elId); if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>'+metricLabel+'</th>'+(extraCol?'<th>'+extraCol.label+'</th>':'')+'</tr></thead><tbody>';
    rows.forEach((p,i)=>{
      html += '<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+valueFn(p)+'</b></td>'+(extraCol?'<td>'+extraCol.fn(p)+'</td>':'')+'</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderDashboard() {
    const pool = applyGrade(players).filter(p => p.name && p.name.trim() && p.name.trim().toLowerCase() !== "none none");
    const fxPool = applyGrade(games);
    const fw = selectedFormWindow();
    document.getElementById("t-games").textContent = fxPool.length || "0";
    document.getElementById("t-players").textContent = pool.length || "0";
    const top = [...pool].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0))[0];
    document.getElementById("t-top").textContent = top ? top.talentScore : "–";
    document.getElementById("t-sync").textContent = lastSync ? new Date(lastSync).toLocaleDateString() : "–";
    const minGamesForTop = 3;
    const qualified = pool.filter(p => (p.games || 0) >= minGamesForTop);
    renderTop5("topTalent", [...qualified].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0)).slice(0,5),
      "Score", p => p.talentScore || 0, {label: "Games", fn: p => p.games || 0});
    renderTop5("topBest",
      [...pool].map(p => ({...p, _best: bestCount(p)}))
        .sort((a,b)=> b._best - a._best || (b.talentScore||0)-(a.talentScore||0)).slice(0,5),
      "In best", p => p._best, {label: "Games", fn: p => p.games || 0});
    renderTop5("topGoals",
      [...pool].sort((a,b)=> (b.goals||0) - (a.goals||0) || (b.talentScore||0)-(a.talentScore||0)).slice(0,5),
      "Goals", p => p.goals || 0, {label: "Per game", fn: p => p.games ? (p.goals/p.games).toFixed(2) : "0"});
    const formed = qualified.map(p => ({...p, _form: formIndicator(p, fw)}))
      .filter(p => p._form).sort((a,b) => b._form.delta - a._form.delta).slice(0,5);
    renderTop5("topForm", formed, "Δ vs avg",
      p => '<span class="'+(p._form.delta>0?'form-up':p._form.delta<0?'form-down':'form-flat')+'">'+p._form.trend+' '+p._form.delta+'</span>',
      {label: "Last "+fw+" avg", fn: p => p._form.recent});
    const fx = [...fxPool].sort((a,b)=> (b.dateTime||"").localeCompare(a.dateTime||"")).slice(0,8);
    const fEl = document.getElementById("recentFixtures");
    if (!fx.length) { fEl.innerHTML = emptyState(); }
    else {
      let html = '<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
      fx.forEach(g=>{
        const hs = (g.home && g.home.score) ? (g.home.score.points != null ? g.home.score.points : "–") : "–";
        const as = (g.away && g.away.score) ? (g.away.score.points != null ? g.away.score.points : "–") : "–";
        html += '<tr><td>'+((g.dateTime||"").slice(0,10))+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+((g.home||{}).name||"")+'</td><td><b>'+hs+'</b></td><td>'+((g.away||{}).name||"")+'</td><td><b>'+as+'</b></td></tr>';
      });
      html += '</tbody></table>';
      fEl.innerHTML = html;
    }
  }

  function renderLeaderboards() {
    const metric = (document.getElementById("lbMetric")||{}).value || "talentScore";
    const positionE = document.getElementById("lbPosition");
    const position = positionE ? positionE.value : "";
    const minGames = parseInt((document.getElementById("lbMinGames")||{}).value || "1", 10);
    const grade = (document.getElementById("lbGrade")||{}).value || "";
    let pool = players.filter(p => (p.games || 0) >= minGames && p.name && p.name.trim() && p.name.trim().toLowerCase() !== "none none");
    if (position) pool = pool.filter(p => (p.position||"") === position);
    if (grade) pool = pool.filter(p => p.grade === grade);
    const getVal = (p) => {
      if (metric === "talentScore") return p.talentScore || 0;
      if (metric === "bog") return p.bog || 0;
      if (metric === "bogFirsts") return p.bogFirsts || 0;
      if (metric === "bestCount") return bestCount(p);
      if (metric === "goals") return p.goals || 0;
      if (metric === "wins") return p.wins || 0;
      return 0;
    };
    pool.sort((a,b)=>getVal(b)-getVal(a));
    const el = document.getElementById("lbTable");
    if (!pool.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Games</th><th>'+metric+'</th></tr></thead><tbody>';
    pool.slice(0,30).forEach((p,i)=>{
      html += '<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td><b>'+getVal(p)+'</b></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderPlayerList() {
    const q = (document.getElementById("playerSearch").value || "").toLowerCase();
    const el = document.getElementById("playerList");
    const filtered = players.filter(p => p.name && p.name.trim() && p.name.trim().toLowerCase() !== "none none" && (!q || (p.name||"").toLowerCase().includes(q) || (p.club||"").toLowerCase().includes(q))).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    if (!filtered.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th></th><th>Player</th><th>Club</th><th>Grade</th><th>Score</th><th></th></tr></thead><tbody>';
    filtered.slice(0,200).forEach(p=>{
      const starred = watchlist.includes(p.id);
      html += '<tr><td><button class="star" data-pid="'+p.id+'">'+(starred?'★':'☆')+'</button></td><td>'+playerLink(p)+'</td><td>'+(p.club||"")+'</td><td class="muted">'+(p.grade||"")+'</td><td><b>'+(p.talentScore||0)+'</b></td><td><button class="btn small" data-pid="'+p.id+'" data-action="open">View</button></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }
  document.getElementById("playerSearch").addEventListener("input", renderPlayerList);
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".player-link, [data-action='open']");
    if (link) { e.preventDefault(); openProfile(link.dataset.pid); return; }
    const star = e.target.closest(".star");
    if (star) {
      const id = star.dataset.pid;
      if (watchlist.includes(id)) watchlist = watchlist.filter(x=>x!==id);
      else watchlist.push(id);
      localStorage.setItem("vafa_watchlist", JSON.stringify(watchlist));
      renderPlayerList(); renderWatchlist(); renderDashboard();
    }
  });
  document.getElementById("backToList").addEventListener("click", () => {
    document.getElementById("playerProfile").classList.add("hidden");
    document.getElementById("playerList").classList.remove("hidden");
    document.querySelector('.tab[data-tab="players"]').click();
  });

  function openProfile(pid) {
    const p = players.find(x => x.id === pid);
    if (!p) return;
    document.querySelector('.tab[data-tab="players"]').click();
    document.getElementById("playerList").classList.add("hidden");
    const prof = document.getElementById("playerProfile");
    prof.classList.remove("hidden");
    document.getElementById("profileName").textContent = p.name;
    document.getElementById("profileMeta").textContent =
      [p.club, p.grade, "#"+(p.number||""), (p.games||0)+" games","Goals: "+(p.goals||0),"In best: "+bestCount(p),"Talent score: "+(p.talentScore||0)].filter(Boolean).join(" · ");
    const tiles = [
      ["Goals", p.goals || 0, p.games ? (p.goals/p.games).toFixed(2) : "0"],
      ["BOG votes", p.bog || 0, p.games ? (p.bog/p.games).toFixed(2) : "0"],
      ["BOG firsts", p.bogFirsts || 0, ""],
      ["In best", bestCount(p), ""],
      ["Wins", p.wins || 0, ""],
      ["Captain games", p.captainGames || 0, ""],
    ].map(([label,total,pg]) =>
      '<div class="tile"><div class="tile-label">'+label+'</div><div class="tile-value">'+total+'</div>'+(pg ? '<div class="muted">'+pg+' / game</div>' : '')+'</div>'
    ).join("");
    document.getElementById("profileStats").innerHTML = '<div class="tiles">'+tiles+'</div>';
    const hist = [...(p.history || [])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    drawSparkline("profileChart", hist.map(h => gameTalentScore(h)));
    const gEl = document.getElementById("profileGames");
    if (!hist.length) { gEl.innerHTML = emptyState("No per-game data available."); return; }
    let html = '<table class="data"><thead><tr><th>Date</th><th>Round</th><th>Grade</th><th>Opp</th><th>G</th><th>BOG</th><th>W</th><th>Score</th></tr></thead><tbody>';
    hist.forEach(h=>{
      html += '<tr><td>'+(h.date||"")+'</td><td>'+(h.round||"")+'</td><td class="muted">'+(h.grade||"")+'</td><td>'+(h.opponent||"")+'</td><td>'+(h.goals||0)+'</td><td>'+(h.bog||0)+'</td><td>'+(h.won?"✓":"")+'</td><td><b>'+gameTalentScore(h)+'</b></td></tr>';
    });
    html += '</tbody></table>';
    gEl.innerHTML = html;
  }

  function drawSparkline(id, data) {
    const c = document.getElementById(id);
    if (!c || !c.getContext) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0,0,c.width,c.height);
    if (!data.length) return;
    const max = Math.max(...data, 1), min = Math.min(...data, 0);
    const pad = 10, w = c.width - pad*2, h = c.height - pad*2;
    ctx.strokeStyle = "#c9a44c"; ctx.lineWidth = 2; ctx.beginPath();
    data.forEach((v,i)=>{
      const x = pad + (i/(Math.max(1,data.length-1)))*w;
      const y = pad + h - ((v-min)/Math.max(0.001,max-min))*h;
      if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.fillStyle = "#c9a44c";
    data.forEach((v,i)=>{
      const x = pad + (i/(Math.max(1,data.length-1)))*w;
      const y = pad + h - ((v-min)/Math.max(0.001,max-min))*h;
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    });
  }

  function populateClubDropdown() {
    const sel = document.getElementById("scoutClub");
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    Array.from(new Set(players.map(p=>p.club).filter(Boolean))).sort().forEach(c=>{
      const o = document.createElement("option"); o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  }
  function renderScoutReport() {
    const sel = document.getElementById("scoutClub"); if (!sel) return;
    const club = sel.value;
    const el = document.getElementById("scoutReport");
    if (!club) { el.innerHTML = '<p class="muted">Pick a club to generate a scouting report.</p>'; return; }
    const squad = players.filter(p => p.club === club).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    if (!squad.length) { el.innerHTML = emptyState(); return; }
    const recent = games.filter(g => ((g.home||{}).name)===club || ((g.away||{}).name)===club)
      .sort((a,b)=>(b.dateTime||"").localeCompare(a.dateTime||"")).slice(0,5);
    let html = '<h3>Top 5 danger players</h3><table class="data"><thead><tr><th>Player</th><th>Grade</th><th>Goals</th><th>In best</th><th>Score</th></tr></thead><tbody>';
    squad.slice(0,5).forEach(p=>{
      html += '<tr><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.goals||0)+'</td><td>'+bestCount(p)+'</td><td><b>'+(p.talentScore||0)+'</b></td></tr>';
    });
    html += '</tbody></table><h3>Recent fixtures</h3>';
    if (!recent.length) html += emptyState("No recent fixtures.");
    else {
      html += '<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
      recent.forEach(g=>{
        const hs = (g.home && g.home.score) ? (g.home.score.points != null ? g.home.score.points : "–") : "–";
        const as = (g.away && g.away.score) ? (g.away.score.points != null ? g.away.score.points : "–") : "–";
        html += '<tr><td>'+((g.dateTime||"").slice(0,10))+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+((g.home||{}).name||"")+'</td><td><b>'+hs+'</b></td><td>'+((g.away||{}).name||"")+'</td><td><b>'+as+'</b></td></tr>';
      });
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  }
  (function bindScout(){
    const sel = document.getElementById("scoutClub");
    if (sel) sel.addEventListener("change", renderScoutReport);
  })();

  // ===== MATCH PREP =====
  function obgfcTeams() {
    return Array.from(new Set(players.filter(isOwnClub)
      .map(p => ({club: p.club, grade: p.grade})).map(o => JSON.stringify(o))))
      .map(s => JSON.parse(s)).sort((a,b) => (a.grade||"").localeCompare(b.grade||""));
  }
  function nextFixtureFor(club, grade) {
    const now = new Date().toISOString();
    return games.filter(g => g.grade === grade)
      .filter(g => (g.status||"").toUpperCase() !== "FINAL")
      .filter(g => ((g.home||{}).name === club) || ((g.away||{}).name === club))
      .filter(g => !g.dateTime || g.dateTime >= now)
      .sort((a,b) => (a.dateTime||"").localeCompare(b.dateTime||""))[0] || null;
  }
  function lastFixtureFor(club, grade) {
    return games.filter(g => g.grade === grade)
      .filter(g => (g.status||"").toUpperCase() === "FINAL")
      .filter(g => ((g.home||{}).name === club) || ((g.away||{}).name === club))
      .sort((a,b) => (b.dateTime||"").localeCompare(a.dateTime||""))[0] || null;
  }
  function populateMatchPrepDropdowns() {
    const own = document.getElementById("mpOwnTeam");
    const opp = document.getElementById("mpOpponent");
    if (!own || !opp) return;
    while (own.options.length > 1) own.remove(1);
    obgfcTeams().forEach(t => {
      const o = document.createElement("option");
      o.value = JSON.stringify(t);
      o.textContent = t.grade ? (t.grade + " — " + t.club) : t.club;
      own.appendChild(o);
    });
    while (opp.options.length > 1) opp.remove(1);
    Array.from(new Set(players.map(p=>p.club).filter(Boolean)))
      .filter(c => !isOwnClubName(c)).sort()
      .forEach(c => {
        const o = document.createElement("option"); o.value = c; o.textContent = c;
        opp.appendChild(o);
      });
  }
  function autoFillOpponent() {
    const ownSel = document.getElementById("mpOwnTeam");
    const oppSel = document.getElementById("mpOpponent");
    if (!ownSel.value) return;
    const t = JSON.parse(ownSel.value);
    const nxt = nextFixtureFor(t.club, t.grade) || lastFixtureFor(t.club, t.grade);
    if (!nxt) return;
    const opponent = ((nxt.home||{}).name === t.club) ? (nxt.away||{}).name : (nxt.home||{}).name;
    if (opponent && [...oppSel.options].some(o => o.value === opponent)) oppSel.value = opponent;
  }
  function selectedOwnTeam() {
    const v = document.getElementById("mpOwnTeam").value;
    if (!v) return null;
    try { return JSON.parse(v); } catch(e) { return null; }
  }
  function selectedOpponent() { return document.getElementById("mpOpponent").value || ""; }
  function selectedMPFormWindow() { return parseInt(document.getElementById("mpFormWindow").value || "3", 10); }
  function gradeTalentBenchmark(grade, topN) {
    topN = topN || 20;
    const ranked = players.filter(p => p.grade === grade && (p.games||0) >= 3)
      .filter(p => p.name && p.name.trim().toLowerCase() !== "none none")
      .sort((a,b) => (b.talentScore||0)-(a.talentScore||0)).slice(0, topN);
    if (!ranked.length) return 0;
    return ranked[ranked.length-1].talentScore || 0;
  }
  function squadSummary(squad) {
    if (!squad.length) return { size:0, avgScore:0, topScore:0, goals:0, best:0, topName:"–" };
    const goals = squad.reduce((s,p)=>s+(p.goals||0),0);
    const best = squad.reduce((s,p)=>s+bestCount(p),0);
    const sorted = [...squad].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    const top = sorted[0];
    return {
      size: squad.length,
      avgScore: +(squad.reduce((s,p)=>s+(p.talentScore||0),0)/squad.length).toFixed(1),
      topScore: top.talentScore || 0, topName: top.name || "–", goals, best,
    };
  }
  function renderVersusComparison(own, opp, opponentSquad) {
    const card = document.getElementById("mpVersus");
    const verdict = document.getElementById("mpVersusVerdict");
    if (!card) return;
    if (!own || !opp) { card.classList.add("hidden"); return; }
    const ourSquad = players.filter(p => isOwnClub(p) && p.grade === own.grade && p.name && p.name.trim().toLowerCase() !== "none none");
    if (!ourSquad.length) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    document.getElementById("mpVersusOpponent").textContent = opp;
    const us = squadSummary(ourSquad), th = squadSummary(opponentSquad);
    const metrics = [
      { label: "Squad size", a: us.size, b: th.size, fmt: v => v },
      { label: "Avg talent score", a: us.avgScore, b: th.avgScore, fmt: v => v },
      { label: "Top talent score", a: us.topScore, b: th.topScore, fmt: v => v, suffix: { a: us.topName, b: th.topName } },
      { label: "Total goals (season)", a: us.goals, b: th.goals, fmt: v => v },
      { label: "Total times in best", a: us.best, b: th.best, fmt: v => v },
    ];
    let html = '<table class="vs-table"><thead><tr><th>Metric</th><th>OBGFC</th><th>'+opp+'</th></tr></thead><tbody>';
    let oursAhead = 0, theirsAhead = 0;
    metrics.forEach(m => {
      const aBetter = m.a > m.b, bBetter = m.b > m.a;
      if (aBetter) oursAhead++; else if (bBetter) theirsAhead++;
      const aCls = aBetter ? "vs-better" : bBetter ? "vs-worse" : "vs-equal";
      const bCls = bBetter ? "vs-better" : aBetter ? "vs-worse" : "vs-equal";
      html += '<tr><td>'+m.label+'</td><td><span class="'+aCls+'">'+m.fmt(m.a)+'</span>'+(m.suffix ? '<span class="vs-edge">'+m.suffix.a+'</span>' : '')+'</td><td><span class="'+bCls+'">'+m.fmt(m.b)+'</span>'+(m.suffix ? '<span class="vs-edge">'+m.suffix.b+'</span>' : '')+'</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById("mpVersusTable").innerHTML = html;
    let line;
    if (oursAhead > theirsAhead) line = `🟢 OBGFC ahead in ${oursAhead} of ${metrics.length} metrics — favourable matchup on paper.`;
    else if (theirsAhead > oursAhead) line = `🔴 ${opp} ahead in ${theirsAhead} of ${metrics.length} metrics — work to do.`;
    else line = `🟡 Even matchup — ${oursAhead}-${theirsAhead} across ${metrics.length} metrics.`;
    const topGap = th.topScore - us.topScore;
    if (Math.abs(topGap) >= 5) {
      line += topGap > 0
        ? ` Their best (${th.topName}) outranks ours by ${topGap.toFixed(1)} — plan to tag.`
        : ` Our best (${us.topName}) outranks theirs by ${(-topGap).toFixed(1)} — own that matchup.`;
    }
    verdict.textContent = line;
  }
  function renderMatchPrep() {
    const own = selectedOwnTeam(), opp = selectedOpponent(), fw = selectedMPFormWindow();
    const showCards = (yes) => {
      ["mpHeader","mpVersus","mpSummary","mpDanger","mpInForm","mpCrossGrade","mpFullSquad","mpRecent"].forEach(id => {
        const el = document.getElementById(id); if (el) el.classList.toggle("hidden", !yes);
      });
    };
    if (!opp) { showCards(false); return; }
    showCards(true);
    let squad = players.filter(p => p.club === opp);
    if (own) { const sameGrade = squad.filter(p => p.grade === own.grade); if (sameGrade.length) squad = sameGrade; }
    squad = squad.filter(p => p.name && p.name.trim().toLowerCase() !== "none none");
    squad.sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    const fixture = own ? (nextFixtureFor(own.club, own.grade) || lastFixtureFor(own.club, own.grade)) : null;
    document.getElementById("mpFixtureTitle").textContent = own ? (own.club + " vs " + opp) : ("Preview: " + opp);
    const fixtureMeta = [];
    if (fixture) {
      fixtureMeta.push((fixture.dateTime||"").slice(0,10));
      if (fixture.round) fixtureMeta.push(fixture.round);
      if (own && own.grade) fixtureMeta.push(own.grade);
      const status = (fixture.status||"").toUpperCase()==="FINAL" ? "(last meeting)" : "(upcoming)";
      fixtureMeta.push(status);
    } else if (own) fixtureMeta.push(own.grade + " — no scheduled fixture found");
    document.getElementById("mpFixtureMeta").textContent = fixtureMeta.join(" · ");
    renderVersusComparison(own, opp, squad);
    const totals = squad.reduce((acc,p) => {
      acc.players++; acc.games += p.games || 0; acc.goals += p.goals || 0; acc.best += bestCount(p);
      return acc;
    }, {players:0, games:0, goals:0, best:0});
    const topScore = squad[0] ? squad[0].talentScore : 0;
    const avgScore = squad.length ? +(squad.reduce((s,p)=>s+(p.talentScore||0),0)/squad.length).toFixed(1) : 0;
    document.getElementById("mpSummaryTiles").innerHTML = [
      ["Squad size", totals.players], ["Avg talent score", avgScore],
      ["Top talent score", topScore], ["Total goals (season)", totals.goals],
      ["Total times in best", totals.best],
    ].map(([l,v]) => '<div class="tile"><div class="tile-label">'+l+'</div><div class="tile-value">'+v+'</div></div>').join("");
    renderTop5("mpDangerList", squad.slice(0,5), "Score", p => p.talentScore || 0, {label: "Games", fn: p => p.games || 0});
    const inForm = squad.map(p => ({...p, _form: formIndicator(p, fw)}))
      .filter(p => p._form && p._form.delta > 0)
      .sort((a,b) => b._form.delta - a._form.delta).slice(0,5);
    const fEl = document.getElementById("mpInFormList");
    if (!inForm.length) { fEl.innerHTML = emptyState("No players currently above season average."); }
    else {
      let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Grade</th><th>Δ vs avg</th><th>Last '+fw+' avg</th><th>Season avg</th></tr></thead><tbody>';
      inForm.forEach((p,i)=>{
        html += '<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td><span class="form-up">▲ '+p._form.delta+'</span></td><td>'+p._form.recent+'</td><td>'+p._form.earlier+'</td></tr>';
      });
      html += '</tbody></table>';
      fEl.innerHTML = html;
    }
    const crossEl = document.getElementById("mpCrossList");
    if (!own) crossEl.innerHTML = '<p class="muted">Pick your OBGFC team above to enable cross-grade detection.</p>';
    else {
      const benchmark = gradeTalentBenchmark(own.grade, 20);
      const allOppPlayers = players.filter(p => p.club === opp && p.grade !== own.grade && p.name && p.name.trim().toLowerCase() !== "none none" && (p.games||0) >= 3 && (p.talentScore||0) >= benchmark)
        .sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
      if (!allOppPlayers.length) crossEl.innerHTML = '<p class="muted">No opponent players in other grades currently ranking inside the top 20 of '+own.grade+' (benchmark: '+benchmark+').</p>';
      else {
        let html = '<p class="muted">Benchmark: top-20 cut-off in '+own.grade+' = <b>'+benchmark+'</b>. Players below would rank inside that range if promoted.</p><table class="data"><thead><tr><th>Player</th><th>Their grade</th><th>Games</th><th>In best</th><th>Goals</th><th>Score</th></tr></thead><tbody>';
        allOppPlayers.slice(0,8).forEach(p => {
          html += '<tr class="cross-grade-row"><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td>'+bestCount(p)+'</td><td>'+(p.goals||0)+'</td><td><b>'+(p.talentScore||0)+'</b></td></tr>';
        });
        html += '</tbody></table>';
        crossEl.innerHTML = html;
      }
    }
    const fsEl = document.getElementById("mpFullSquadList");
    if (!squad.length) fsEl.innerHTML = emptyState();
    else {
      let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Grade</th><th>Games</th><th>In best</th><th>Goals</th><th>Talent</th><th>Form</th></tr></thead><tbody>';
      squad.forEach((p,i)=>{
        const f = formIndicator(p, fw);
        const formCell = f ? '<span class="'+(f.delta>0?'form-up':f.delta<0?'form-down':'form-flat')+'">'+f.trend+' '+f.delta+'</span>' : '<span class="muted">–</span>';
        html += '<tr><td>'+(i+1)+'</td><td>'+playerLink(p)+'</td><td class="muted">'+(p.grade||"")+'</td><td>'+(p.games||0)+'</td><td>'+bestCount(p)+'</td><td>'+(p.goals||0)+'</td><td><b>'+(p.talentScore||0)+'</b></td><td>'+formCell+'</td></tr>';
      });
      html += '</tbody></table>';
      fsEl.innerHTML = html;
    }
    const rEl = document.getElementById("mpRecentList");
    const recent = games.filter(g => ((g.home||{}).name === opp) || ((g.away||{}).name === opp))
      .filter(g => (g.status||"").toUpperCase() === "FINAL")
      .sort((a,b)=>(b.dateTime||"").localeCompare(a.dateTime||"")).slice(0,6);
    if (!recent.length) rEl.innerHTML = emptyState("No recent results.");
    else {
      let html = '<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th><th>Result for '+opp+'</th></tr></thead><tbody>';
      recent.forEach(g=>{
        const hs = (g.home && g.home.score) ? (g.home.score.points != null ? g.home.score.points : "–") : "–";
        const as = (g.away && g.away.score) ? (g.away.score.points != null ? g.away.score.points : "–") : "–";
        const isHome = (g.home||{}).name === opp;
        const oppOutcome = isHome ? (g.home||{}).outcome : (g.away||{}).outcome;
        const cls = oppOutcome === "WON" ? "form-up" : oppOutcome === "LOST" ? "form-down" : "form-flat";
        html += '<tr><td>'+((g.dateTime||"").slice(0,10))+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+((g.home||{}).name||"")+'</td><td><b>'+hs+'</b></td><td>'+((g.away||{}).name||"")+'</td><td><b>'+as+'</b></td><td><span class="'+cls+'">'+(oppOutcome||"–")+'</span></td></tr>';
      });
      html += '</tbody></table>';
      rEl.innerHTML = html;
    }
  }
  (function bindMatchPrep(){
    const own = document.getElementById("mpOwnTeam");
    const opp = document.getElementById("mpOpponent");
    const fw = document.getElementById("mpFormWindow");
    if (own) own.addEventListener("change", () => { autoFillOpponent(); renderMatchPrep(); });
    if (opp) opp.addEventListener("change", renderMatchPrep);
    if (fw) fw.addEventListener("change", renderMatchPrep);
  })();

  // ===== ROUND LOG =====
  function selectedRLGrade() { const el = document.getElementById("rlGrade"); return el ? (el.value || "") : ""; }
  function selectedRLFormWindow() { const el = document.getElementById("rlFormWindow"); return el ? parseInt(el.value || "3", 10) : 3; }

  function buildTeamForm(grade, window) {
    const completed = games.filter(g => (g.status||"").toUpperCase() === "FINAL")
      .filter(g => !grade || g.grade === grade)
      .sort((a,b)=>(a.dateTime||"").localeCompare(b.dateTime||""));
    const byTeam = {};
    completed.forEach(g => {
      const home = g.home || {}, away = g.away || {};
      const hScore = (home.score && home.score.points) || 0;
      const aScore = (away.score && away.score.points) || 0;
      function record(side, opp, scoreFor, scoreAgainst, outcome) {
        if (!side.name) return;
        const k = side.name + "||" + g.grade;
        if (!byTeam[k]) byTeam[k] = { team: side.name, grade: g.grade, results: [] };
        const result = outcome === "WON" ? "W" : outcome === "LOST" ? "L" : outcome === "DRAW" ? "D" : "?";
        byTeam[k].results.push({
          date: (g.dateTime||"").slice(0,10),
          round: g.round, opponent: opp.name || "",
          scoreFor, scoreAgainst, result,
        });
      }
      record(home, away, hScore, aScore, home.outcome);
      record(away, home, aScore, hScore, away.outcome);
    });
    return Object.values(byTeam).map(t => {
      const lastN = t.results.slice(-window);
      const wins = lastN.filter(r => r.result === "W").length;
      const losses = lastN.filter(r => r.result === "L").length;
      const draws = lastN.filter(r => r.result === "D").length;
      const pts = wins * 3 + draws;
      const max = lastN.length * 3;
      const pct = max ? +((pts / max) * 100).toFixed(0) : 0;
      const trend = pct >= 67 ? "hot" : pct <= 33 ? "cold" : "even";
      const totalFor = lastN.reduce((s,r)=>s+r.scoreFor,0);
      const totalAgainst = lastN.reduce((s,r)=>s+r.scoreAgainst,0);
      const avgMargin = lastN.length ? +(((totalFor - totalAgainst)/lastN.length)).toFixed(0) : 0;
      return { team: t.team, grade: t.grade, results: lastN, wins, losses, draws, pts, pct, trend, avgMargin, gamesPlayed: t.results.length };
    }).sort((a,b) => b.pct - a.pct || b.avgMargin - a.avgMargin || b.wins - a.wins);
  }

  function renderFormBlocks(results, window) {
    const blocks = [...results];
    while (blocks.length < window) blocks.unshift({result: "tbd"});
    return '<span class="form-blocks">'
      + blocks.map(r => {
          const cls = r.result === "W" ? "win" : r.result === "L" ? "loss" : r.result === "D" ? "draw" : "tbd";
          const letter = r.result && r.result !== "tbd" ? r.result : "·";
          const tip = r.round ? `${r.round}: ${r.result} vs ${r.opponent} (${r.scoreFor}-${r.scoreAgainst})` : "no data";
          return `<span class="form-block ${cls}" title="${tip}">${letter}</span>`;
        }).join("")
      + '</span>';
  }

  function renderTeamFormBoard(grade, window) {
    const teams = buildTeamForm(grade, window);
    const el = document.getElementById("rlTeamForm");
    if (!teams.length) { el.innerHTML = emptyState("No completed games yet."); return; }
    let html = '<table class="data"><thead><tr><th>#</th><th>Team</th>'
             + (grade ? '' : '<th>Grade</th>')
             + '<th>Last '+window+'</th><th>Form pts</th><th>Form %</th><th>Avg margin</th><th>W-D-L</th></tr></thead><tbody>';
    teams.forEach((t,i) => {
      const own = isOwnClubName(t.team);
      const cls = t.trend === "hot" ? "hot" : t.trend === "cold" ? "cold" : "";
      const ownDot = own ? '<span class="own-club" title="OBGFC">●</span> ' : '';
      html += `<tr class="team-form-row ${cls}">`
            + `<td>${i+1}</td><td class="team-name">${ownDot}${t.team}</td>`
            + (grade ? '' : `<td class="muted">${t.grade}</td>`)
            + `<td>${renderFormBlocks(t.results, window)}</td>`
            + `<td>${t.pts} / ${window*3}</td>`
            + `<td class="form-pct">${t.pct}%</td>`
            + `<td>${t.avgMargin > 0 ? "+" : ""}${t.avgMargin}</td>`
            + `<td>${t.wins}-${t.draws}-${t.losses}</td>`
            + `</tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function buildPlayerMovers(grade) {
    const pool = players.filter(p =>
      p.name && p.name.trim().toLowerCase() !== "none none" &&
      (!grade || p.grade === grade) && (p.history || []).length >= 2);
    return pool.map(p => {
      const hist = [...(p.history || [])].sort((a,b) => (a.date||"").localeCompare(b.date||""));
      const last = hist[hist.length - 1];
      const prior = hist.slice(0, -1);
      const lastTs = gameTalentScore(last);
      const priorAvg = prior.length ? prior.reduce((s,h)=>s+gameTalentScore(h),0)/prior.length : 0;
      return {
        ...p, _lastTs: lastTs, _priorAvg: +priorAvg.toFixed(1),
        _delta: +(lastTs - priorAvg).toFixed(1),
        _lastRound: last.round, _lastDate: last.date, _lastOpp: last.opponent,
      };
    });
  }

  function renderPlayerMovers(grade) {
    const movers = buildPlayerMovers(grade);
    const climbers = [...movers].sort((a,b)=>b._delta-a._delta).slice(0,10);
    const faders = [...movers].sort((a,b)=>a._delta-b._delta).slice(0,10);
    function renderMoverTable(elId, rows, className) {
      const el = document.getElementById(elId);
      if (!rows.length) { el.innerHTML = emptyState("Need at least 2 games to measure movement."); return; }
      let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Last round</th><th>This game</th><th>Prior avg</th><th>Δ</th></tr></thead><tbody>';
      rows.forEach((p,i) => {
        const deltaCls = p._delta > 0 ? "form-up" : p._delta < 0 ? "form-down" : "form-flat";
        const trendSym = p._delta > 0 ? "▲" : p._delta < 0 ? "▼" : "▬";
        html += `<tr class="${className}"><td>${i+1}</td><td>${playerLink(p)}</td><td>${p.club || ""}</td><td class="muted">${p.grade || ""}</td><td>${p._lastRound || ""} <span class="muted">vs ${p._lastOpp || "?"}</span></td><td>${p._lastTs}</td><td>${p._priorAvg}</td><td><span class="${deltaCls}">${trendSym} ${p._delta > 0 ? "+" : ""}${p._delta}</span></td></tr>`;
      });
      html += '</tbody></table>';
      el.innerHTML = html;
    }
    renderMoverTable("rlClimbers", climbers, "mover-up");
    renderMoverTable("rlFaders", faders, "mover-down");
  }

  function renderNewElite(grade) {
    const el = document.getElementById("rlNewElite");
    const grades = grade ? [grade] : Array.from(new Set(players.map(p=>p.grade).filter(Boolean)));
    const out = [];
    grades.forEach(g => {
      const pool = players.filter(p => p.grade === g && p.name && p.name.trim().toLowerCase() !== "none none" && (p.history || []).length >= 2);
      if (!pool.length) return;
      const benchmark = gradeTalentBenchmark(g, 20);
      if (!benchmark) return;
      pool.forEach(p => {
        const hist = [...(p.history || [])].sort((a,b) => (a.date||"").localeCompare(b.date||""));
        const last = hist[hist.length - 1];
        const prior = hist.slice(0, -1);
        const priorTotals = prior.reduce((acc, h) => {
          acc.bog += (h.bog || 0); acc.goals += (h.goals || 0);
          acc.wins += h.won ? 1 : 0; acc.bogFirsts += (h.bog === 6 ? 1 : 0);
          return acc;
        }, {bog:0, goals:0, wins:0, bogFirsts:0});
        const priorGames = Math.max(1, prior.length);
        const priorScore = +(((priorTotals.bog * 8) + (priorTotals.bogFirsts * 6) + (priorTotals.goals * 5) + (priorTotals.wins * 2)) / Math.sqrt(priorGames)).toFixed(1);
        const currScore = p.talentScore || 0;
        if (priorScore < benchmark && currScore >= benchmark) {
          out.push({ ...p, _priorScore: priorScore, _benchmark: benchmark, _lastRound: last.round, _lastOpp: last.opponent, _lastTs: gameTalentScore(last) });
        }
      });
    });
    if (!out.length) { el.innerHTML = '<p class="muted">No new entrants this round. The top 20 of each grade was stable.</p>'; return; }
    out.sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Last round</th><th>Game TS</th><th>Now</th><th>Was</th><th>Benchmark</th></tr></thead><tbody>';
    out.forEach((p,i) => {
      html += `<tr class="elite-new"><td>${i+1}</td><td>${playerLink(p)}</td><td>${p.club || ""}</td><td class="muted">${p.grade || ""}</td><td>${p._lastRound || ""} <span class="muted">vs ${p._lastOpp || "?"}</span></td><td>${p._lastTs}</td><td><b>${p.talentScore || 0}</b></td><td>${p._priorScore}</td><td class="muted">${p._benchmark}</td></tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderBigResults(grade) {
    const el = document.getElementById("rlBigResults");
    let pool = games.filter(g => (g.status||"").toUpperCase() === "FINAL").filter(g => !grade || g.grade === grade);
    const sorted = [...pool].sort((a,b)=>(b.dateTime||"").localeCompare(a.dateTime||""));
    if (!sorted.length) { el.innerHTML = emptyState("No completed games yet."); return; }
    const latestDate = (sorted[0].dateTime||"").slice(0,10);
    const cutoff = new Date(latestDate); cutoff.setDate(cutoff.getDate() - 6);
    const cutoffStr = cutoff.toISOString().slice(0,10);
    const lastRound = pool.filter(g => (g.dateTime||"").slice(0,10) >= cutoffStr);
    const ranked = lastRound.map(g => {
      const hs = (g.home && g.home.score && g.home.score.points) || 0;
      const as = (g.away && g.away.score && g.away.score.points) || 0;
      return {...g, _margin: Math.abs(hs - as), _hs: hs, _as: as};
    }).sort((a,b)=>b._margin-a._margin).slice(0,8);
    if (!ranked.length) { el.innerHTML = emptyState("No big results in the last round."); return; }
    let html = '<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th><th>Margin</th></tr></thead><tbody>';
    ranked.forEach(g => {
      html += '<tr><td>'+((g.dateTime||"").slice(0,10))+'</td><td class="muted">'+(g.grade||"")+'</td><td>'+(g.round||"")+'</td><td>'+((g.home||{}).name||"")+'</td><td><b>'+g._hs+'</b></td><td>'+((g.away||{}).name||"")+'</td><td><b>'+g._as+'</b></td><td><b>'+g._margin+'</b></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  function renderRoundLog() {
    const grade = selectedRLGrade(), fw = selectedRLFormWindow();
    renderTeamFormBoard(grade, fw); renderPlayerMovers(grade);
    renderNewElite(grade); renderBigResults(grade);
  }
  ["rlGrade","rlFormWindow"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", renderRoundLog);
  });

  // ===== FINALS PATH ESTIMATOR =====
  function selectedFPGrade() {
    const el = document.getElementById("fpGrade");
    return el ? (el.value || "Premier A Women's") : "Premier A Women's";
  }
  function selectedFPFinalsSpots() {
    const el = document.getElementById("fpFinalsSpots");
    return el ? parseInt(el.value || "4", 10) : 4;
  }
  function selectedFPPtsWin() {
    const el = document.getElementById("fpPtsWin");
    const v = el ? parseInt(el.value || "4", 10) : 4;
    return Math.max(1, Math.min(4, v));
  }

  // Build a full team-level ladder for a grade
  function buildLadder(grade, ptsPerWin) {
    ptsPerWin = ptsPerWin || 4;
    const ptsPerDraw = Math.floor(ptsPerWin / 2);
    const completed = games.filter(g => (g.status||"").toUpperCase() === "FINAL" && g.grade === grade)
      .sort((a,b)=>(a.dateTime||"").localeCompare(b.dateTime||""));
    const upcoming = games.filter(g => (g.status||"").toUpperCase() !== "FINAL" && g.grade === grade);
    const byTeam = {};

    function ensure(name) {
      if (!name) return null;
      if (!byTeam[name]) byTeam[name] = {
        team: name, played:0, wins:0, losses:0, draws:0, pointsFor:0, pointsAgainst:0,
        results:[], upcomingCount:0, upcomingOpponents:[]
      };
      return byTeam[name];
    }

    completed.forEach(g => {
      const home = g.home || {}, away = g.away || {};
      const hName = home.name, aName = away.name;
      if (!hName || !aName) return;
      const hScore = (home.score && home.score.points) || 0;
      const aScore = (away.score && away.score.points) || 0;
      const h = ensure(hName), a = ensure(aName);
      h.played++; a.played++;
      h.pointsFor += hScore; h.pointsAgainst += aScore;
      a.pointsFor += aScore; a.pointsAgainst += hScore;
      if (home.outcome === "WON") { h.wins++; a.losses++; }
      else if (away.outcome === "WON") { a.wins++; h.losses++; }
      else if (home.outcome === "DRAW" || away.outcome === "DRAW") { h.draws++; a.draws++; }
      h.results.push({date: (g.dateTime||"").slice(0,10), round: g.round, opponent: aName, scoreFor: hScore, scoreAgainst: aScore, result: home.outcome==="WON"?"W":away.outcome==="WON"?"L":"D", home: true});
      a.results.push({date: (g.dateTime||"").slice(0,10), round: g.round, opponent: hName, scoreFor: aScore, scoreAgainst: hScore, result: away.outcome==="WON"?"W":home.outcome==="WON"?"L":"D", home: false});
    });

    upcoming.forEach(g => {
      const home = g.home || {}, away = g.away || {};
