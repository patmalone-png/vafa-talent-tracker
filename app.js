// VAFA Talent ID — vanilla JS, no modules, no JSX
(function () {
  "use strict";

  // ----- State -----
  let games = [];
  let players = [];
  let lastSync = null;
  let watchlist = JSON.parse(localStorage.getItem("vafa_watchlist") || "[]");

  // ----- Talent Score (fallback if not pre-computed by fetch script) -----
  // bog × 8 + bogFirsts × 6 + goals × 5 + wins × 2, divided by games.
  function talentScore(p) {
    const g = Math.max(1, p.games || 1);
    const raw =
      ((p.bog       || 0) * 8) +
      ((p.bogFirsts || 0) * 6) +
      ((p.goals     || 0) * 5) +
      ((p.wins      || 0) * 2);
    return +(raw / g).toFixed(1);
  }

  // Count games in best (fallback to history scan for legacy data)
  function bestCount(p) {
    if (typeof p.bestCount === "number") return p.bestCount;
    return (p.history || []).filter(h => (h.bog || 0) > 0 || h.inBest).length;
  }

  // Per-game talent score (fallback for legacy history rows)
  function gameTalentScore(h) {
    if (typeof h.talentScore === "number") return h.talentScore;
    return (h.goals || 0) * 5 + (h.bog || 0) * 8 + ((h.bog === 6) ? 6 : 0) + (h.won ? 2 : 0);
  }

  // Form Indicator: last N games avg vs earlier avg
  function formIndicator(p, window) {
    const hist = [...(p.history || [])].sort((a,b) => (a.date||"").localeCompare(b.date||""));
    if (hist.length < window + 1) return null;
    const recent  = hist.slice(-window);
    const earlier = hist.slice(0, -window);
    const avg = arr => arr.length ? arr.reduce((s,h)=>s+gameTalentScore(h),0)/arr.length : 0;
    const r = avg(recent), e = avg(earlier);
    const delta = +(r - e).toFixed(1);
    const trend = delta > 1 ? "▲" : delta < -1 ? "▼" : "▬";
    return { recent: +r.toFixed(1), earlier: +e.toFixed(1), delta, trend };
  }

  // ----- Filters -----
  function selectedGrade() {
    const el = document.getElementById("gradeFilter");
    return el ? (el.value || "") : "";
  }
  function selectedFormWindow() {
    const el = document.getElementById("formWindow");
    return el ? parseInt(el.value || "3", 10) : 3;
  }
  function applyGrade(list, key) {
    const g = selectedGrade();
    if (!g) return list;
    return list.filter(x => (x[key || "grade"] || "") === g);
  }

  // ----- Boot -----
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
    // Enrich players with talent score (use existing if pre-computed)
    players.forEach(p => {
      if (typeof p.talentScore !== "number") p.talentScore = talentScore(p);
    });
    lastSync = localStorage.getItem("vafa_last_render") || new Date().toISOString();
    localStorage.setItem("vafa_last_render", new Date().toISOString());
    populateClubDropdown();
    renderAll();
  }

  function renderAll() {
    renderDashboard();
    renderLeaderboards();
    renderPlayerList();
    renderScoutReport();
    renderWatchlist();
    renderSettings();
    const sync = lastSync ? new Date(lastSync).toLocaleString() : "never";
    const ls = document.getElementById("lastSync");
    if (ls) ls.textContent = "Last sync: " + sync;
  }

  // ----- Tabs -----
  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });

  // ----- Empty state -----
  function emptyState(msg) {
    return '<div class="empty">' + (msg || "No data yet — run the PlayHQ fetch workflow.") + '</div>';
  }

  // ----- Player name link (used across tables) -----
function playerLink(p) {
    return '<a href="#" class="player-link" data-pid="' + p.id + '">' + (p.name || "Unknown") + '</a>';
}

  // ----- Generic Top-5 table -----
  function renderTop5(elId, rows, metricLabel, valueFn, extraCol) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!rows.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>'+metricLabel+'</th>'+(extraCol?'<th>'+extraCol.label+'</th>':'')+'</tr></thead><tbody>';
    rows.forEach((p,i)=>{
      html += '<tr>'
            + '<td>'+(i+1)+'</td>'
            + '<td>'+playerLink(p)+'</td>'
            + '<td>'+(p.club||"")+'</td>'
            + '<td class="muted">'+(p.grade||"")+'</td>'
            + '<td><b>'+valueFn(p)+'</b></td>'
            + (extraCol ? '<td>'+extraCol.fn(p)+'</td>' : '')
            + '</tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ----- Dashboard -----
  function renderDashboard() {
    const pool   = applyGrade(players);
    const fxPool = applyGrade(games);
    const fw     = selectedFormWindow();

    document.getElementById("t-games").textContent   = fxPool.length || "0";
    document.getElementById("t-players").textContent = pool.length || "0";
    const top = [...pool].sort((a,b)=>(b.talentScore||0)-(a.talentScore||0))[0];
    document.getElementById("t-top").textContent     = top ? top.talentScore : "–";
    document.getElementById("t-sync").textContent    = lastSync ? new Date(lastSync).toLocaleDateString() : "–";

    // Top 5 — Talent Score
    const byTalent = [...pool]
      .sort((a,b)=>(b.talentScore||0)-(a.talentScore||0))
      .slice(0,5);
    renderTop5("topTalent", byTalent, "Score", p => p.talentScore || 0,
      {label: "Games", fn: p => p.games || 0});

    // Top 5 — Times in the Best
    const byBest = [...pool]
      .map(p => ({...p, _best: bestCount(p)}))
      .sort((a,b)=> b._best - a._best || (b.talentScore||0)-(a.talentScore||0))
      .slice(0,5);
    renderTop5("topBest", byBest, "In best", p => p._best,
      {label: "Games", fn: p => p.games || 0});

    // Top 5 — Total Goals
    const byGoals = [...pool]
      .sort((a,b)=> (b.goals||0) - (a.goals||0) || (b.talentScore||0)-(a.talentScore||0))
      .slice(0,5);
    renderTop5("topGoals", byGoals, "Goals", p => p.goals || 0,
      {label: "Per game", fn: p => p.games ? (p.goals/p.games).toFixed(2) : "0"});

    // Top 5 — Form Indicator
    const formed = pool
      .map(p => ({...p, _form: formIndicator(p, fw)}))
      .filter(p => p._form)
      .sort((a,b) => b._form.delta - a._form.delta)
      .slice(0,5);
    renderTop5("topForm", formed, "Δ vs avg",
      p => '<span style="color:'+(p._form.delta>0?'#7ddc7d':p._form.delta<0?'#f08484':'#c9a44c')+'">'+p._form.trend+' '+p._form.delta+'</span>',
      {label: "Last "+fw+" avg", fn: p => p._form.recent});

    // Recent fixtures (grade-filtered)
    const fx = [...fxPool]
      .sort((a,b)=> (b.dateTime||"").localeCompare(a.dateTime||""))
      .slice(0,8);
    const fEl = document.getElementById("recentFixtures");
    if (!fx.length) { fEl.innerHTML = emptyState(); }
    else {
      let html = '<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
      fx.forEach(g=>{
        const hs = (g.home && g.home.score) ? (g.home.score.points != null ? g.home.score.points : "–") : "–";
        const as = (g.away && g.away.score) ? (g.away.score.points != null ? g.away.score.points : "–") : "–";
        html += '<tr><td>'+((g.dateTime||"").slice(0,10))+'</td>'
              + '<td class="muted">'+(g.grade||"")+'</td>'
              + '<td>'+(g.round||"")+'</td>'
              + '<td>'+((g.home||{}).name||"")+'</td><td><b>'+hs+'</b></td>'
              + '<td>'+((g.away||{}).name||"")+'</td><td><b>'+as+'</b></td></tr>';
      });
      html += '</tbody></table>';
      fEl.innerHTML = html;
    }
  }

  // ----- Leaderboards -----
  function renderLeaderboards() {
    const metric    = (document.getElementById("lbMetric")||{}).value || "talentScore";
    const positionE = document.getElementById("lbPosition");
    const position  = positionE ? positionE.value : "";
    const minGames  = parseInt((document.getElementById("lbMinGames")||{}).value || "1", 10);
    const grade     = (document.getElementById("lbGrade")||{}).value || "";

    let pool = players.filter(p => (p.games || 0) >= minGames);
    if (position) pool = pool.filter(p => (p.position||"") === position);
    if (grade)    pool = pool.filter(p => p.grade === grade);

    const getVal = (p) => {
      if (metric === "talentScore") return p.talentScore || 0;
      if (metric === "bog")         return p.bog || 0;
      if (metric === "bogFirsts")   return p.bogFirsts || 0;
      if (metric === "bestCount")   return bestCount(p);
      if (metric === "goals")       return p.goals || 0;
      if (metric === "wins")        return p.wins || 0;
      return 0;
    };
    pool.sort((a,b)=>getVal(b)-getVal(a));

    const el = document.getElementById("lbTable");
    if (!pool.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Grade</th><th>Games</th><th>'+metric+'</th></tr></thead><tbody>';
    pool.slice(0,30).forEach((p,i)=>{
      html += '<tr><td>'+(i+1)+'</td>'
            + '<td>'+playerLink(p)+'</td>'
            + '<td>'+(p.club||"")+'</td>'
            + '<td class="muted">'+(p.grade||"")+'</td>'
            + '<td>'+(p.games||0)+'</td>'
            + '<td><b>'+getVal(p)+'</b></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ----- Players list + profile -----
  function renderPlayerList() {
    const q = (document.getElementById("playerSearch").value || "").toLowerCase();
    const el = document.getElementById("playerList");
    const filtered = players.filter(p =>
      !q || (p.name||"").toLowerCase().includes(q) || (p.club||"").toLowerCase().includes(q)
    ).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    if (!filtered.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th></th><th>Player</th><th>Club</th><th>Grade</th><th>Score</th><th></th></tr></thead><tbody>';
    filtered.slice(0,200).forEach(p=>{
      const starred = watchlist.includes(p.id);
      html += '<tr>'
            + '<td><button class="star" data-pid="'+p.id+'">'+(starred?'★':'☆')+'</button></td>'
            + '<td>'+playerLink(p)+'</td>'
            + '<td>'+(p.club||"")+'</td>'
            + '<td class="muted">'+(p.grade||"")+'</td>'
            + '<td><b>'+(p.talentScore||0)+'</b></td>'
            + '<td><button class="btn small" data-pid="'+p.id+'" data-action="open">View</button></td></tr>';
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
      [p.club, p.grade, "#"+(p.number||""), (p.games||0)+" games",
       "Goals: "+(p.goals||0), "In best: "+bestCount(p),
       "Talent score: "+(p.talentScore||0)].filter(Boolean).join(" · ");

    const tiles = [
      ["Goals",        p.goals || 0,        p.games ? (p.goals/p.games).toFixed(2) : "0"],
      ["BOG votes",    p.bog || 0,          p.games ? (p.bog/p.games).toFixed(2)   : "0"],
      ["BOG firsts",   p.bogFirsts || 0,    ""],
      ["In best",      bestCount(p),        ""],
      ["Wins",         p.wins || 0,         ""],
      ["Captain games",p.captainGames || 0, ""],
    ].map(([label,total,pg]) =>
      '<div class="tile"><div class="tile-label">'+label+'</div>'
      +'<div class="tile-value">'+total+'</div>'
      +(pg ? '<div class="muted">'+pg+' / game</div>' : '')
      +'</div>'
    ).join("");
    document.getElementById("profileStats").innerHTML = '<div class="tiles">'+tiles+'</div>';

    const hist = [...(p.history || [])].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    drawSparkline("profileChart", hist.map(h => gameTalentScore(h)));

    const gEl = document.getElementById("profileGames");
    if (!hist.length) { gEl.innerHTML = emptyState("No per-game data available."); return; }
    let html = '<table class="data"><thead><tr><th>Date</th><th>Round</th><th>Grade</th><th>Opp</th><th>G</th><th>BOG</th><th>W</th><th>Score</th></tr></thead><tbody>';
    hist.forEach(h=>{
      html += '<tr><td>'+(h.date||"")+'</td>'
            + '<td>'+(h.round||"")+'</td>'
            + '<td class="muted">'+(h.grade||"")+'</td>'
            + '<td>'+(h.opponent||"")+'</td>'
            + '<td>'+(h.goals||0)+'</td>'
            + '<td>'+(h.bog||0)+'</td>'
            + '<td>'+(h.won?"✓":"")+'</td>'
            + '<td><b>'+gameTalentScore(h)+'</b></td></tr>';
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
    const pad = 10;
    const w = c.width - pad*2, h = c.height - pad*2;
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

  // ----- Opposition Scout -----
  function populateClubDropdown() {
    const sel = document.getElementById("scoutClub");
    if (!sel) return;
    // Reset
    while (sel.options.length > 1) sel.remove(1);
    const clubs = Array.from(new Set(players.map(p=>p.club).filter(Boolean))).sort();
    clubs.forEach(c=>{
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  }
  function renderScoutReport() {
    const sel = document.getElementById("scoutClub");
    if (!sel) return;
    const club = sel.value;
    const el = document.getElementById("scoutReport");
    if (!club) { el.innerHTML = '<p class="muted">Pick a club to generate a scouting report.</p>'; return; }
    const squad = players.filter(p => p.club === club).sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    if (!squad.length) { el.innerHTML = emptyState(); return; }
    const recent = games.filter(g => ((g.home||{}).name)===club || ((g.away||{}).name)===club)
      .sort((a,b)=>(b.dateTime||"").localeCompare(a.dateTime||""))
      .slice(0,5);
    let html = '<h3>Top 5 danger players</h3><table class="data"><thead><tr><th>Player</th><th>Grade</th><th>Goals</th><th>In best</th><th>Score</th></tr></thead><tbody>';
    squad.slice(0,5).forEach(p=>{
      html += '<tr><td>'+playerLink(p)+'</td>'
            + '<td class="muted">'+(p.grade||"")+'</td>'
            + '<td>'+(p.goals||0)+'</td>'
            + '<td>'+bestCount(p)+'</td>'
            + '<td><b>'+(p.talentScore||0)+'</b></td></tr>';
    });
    html += '</tbody></table>';
    html += '<h3>Recent fixtures</h3>';
    if (!recent.length) html += emptyState("No recent fixtures.");
    else {
      html += '<table class="data"><thead><tr><th>Date</th><th>Grade</th><th>Round</th><th>Home</th><th>Score</th><th>Away</th><th>Score</th></tr></thead><tbody>';
      recent.forEach(g=>{
        const hs = (g.home && g.home.score) ? (g.home.score.points != null ? g.home.score.points : "–") : "–";
        const as = (g.away && g.away.score) ? (g.away.score.points != null ? g.away.score.points : "–") : "–";
        html += '<tr><td>'+((g.dateTime||"").slice(0,10))+'</td>'
              + '<td class="muted">'+(g.grade||"")+'</td>'
              + '<td>'+(g.round||"")+'</td>'
              + '<td>'+((g.home||{}).name||"")+'</td><td><b>'+hs+'</b></td>'
              + '<td>'+((g.away||{}).name||"")+'</td><td><b>'+as+'</b></td></tr>';
      });
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  }
  (function bindScout(){
    const sel = document.getElementById("scoutClub");
    if (sel) sel.addEventListener("change", renderScoutReport);
  })();

  // ----- Watchlist -----
  function renderWatchlist() {
    const el = document.getElementById("watchlistView");
    if (!el) return;
    const list = players.filter(p => watchlist.includes(p.id))
      .sort((a,b)=>(b.talentScore||0)-(a.talentScore||0));
    if (!list.length) { el.innerHTML = emptyState("Your watchlist is empty."); return; }
    let html = '<table class="data"><thead><tr><th>Player</th><th>Club</th><th>Grade</th><th>Games</th><th>Goals</th><th>In best</th><th>Score</th><th></th></tr></thead><tbody>';
    list.forEach(p=>{
      html += '<tr><td>'+playerLink(p)+'</td>'
            + '<td>'+(p.club||"")+'</td>'
            + '<td class="muted">'+(p.grade||"")+'</td>'
            + '<td>'+(p.games||0)+'</td>'
            + '<td>'+(p.goals||0)+'</td>'
            + '<td>'+bestCount(p)+'</td>'
            + '<td><b>'+(p.talentScore||0)+'</b></td>'
            + '<td><button class="star" data-pid="'+p.id+'">★</button></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ----- Settings -----
  function renderSettings() {
    const el = document.getElementById("setLastSync");
    if (el) el.textContent = lastSync ? new Date(lastSync).toLocaleString() : "never";
  }
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", loadData);

  // ----- Filter listeners -----
  ["lbMetric","lbPosition","lbMinGames","lbGrade"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderLeaderboards);
  });
  ["gradeFilter","formWindow"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderDashboard);
  });

  // ----- Boot -----
  loadData();
})();
