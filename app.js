// VAFA Talent ID — vanilla JS, no modules, no JSX
(function () {
  "use strict";

  // ----- State -----
  let games = [];
  let players = [];
  let lastSync = null;
  let watchlist = JSON.parse(localStorage.getItem("vafa_watchlist") || "[]");
  let currentPlayerId = null;

  // ----- Talent score formula -----
// Talent Score (PlayHQ public data only):
//   votes (BOG)   × 10
//   goals         × 4
//   wins          × 2
// Normalised per game so 30+ is elite.
function talentScore(p) {
  const g = Math.max(1, p.games || 1);
  const raw =
    ((p.votes || 0) * 10) +
    ((p.goals || 0) * 4) +
    ((p.wins  || 0) * 2);
  return +(raw / g).toFixed(1);
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
    // Enrich players with talent score
    players.forEach(p => { p.talentScore = talentScore(p); });
    lastSync = localStorage.getItem("vafa_last_render") || new Date().toISOString();
    localStorage.setItem("vafa_last_render", new Date().toISOString());
    renderAll();
  }

  function renderAll() {
    renderDashboard();
    renderLeaderboards();
    renderPlayerList();
    renderScout();
    renderWatchlist();
    renderSettings();
    const sync = lastSync ? new Date(lastSync).toLocaleString() : "never";
    document.getElementById("lastSync").textContent = "Last sync: " + sync;
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

  // ----- Empty state helper -----
  function emptyState(msg) {
    return '<div class="empty">' + (msg || "No data yet — run the PlayHQ fetch workflow.") + '</div>';
  }

  // ----- Dashboard -----
  function renderDashboard() {
    document.getElementById("t-games").textContent = games.length || "0";
    document.getElementById("t-players").textContent = players.length || "0";
    const top = [...players].sort((a,b)=>b.talentScore-a.talentScore)[0];
    document.getElementById("t-top").textContent = top ? top.talentScore : "–";
    document.getElementById("t-sync").textContent = lastSync ? new Date(lastSync).toLocaleDateString() : "–";

    const prospects = [...players].sort((a,b)=>b.talentScore-a.talentScore).slice(0,5);
    const pEl = document.getElementById("topProspects");
    if (!prospects.length) { pEl.innerHTML = emptyState(); }
    else {
      let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Pos</th><th>Games</th><th>Score</th></tr></thead><tbody>';
      prospects.forEach((p,i)=>{
        html += '<tr><td>'+(i+1)+'</td><td><a href="#" data-pid="'+p.id+'" class="player-link">'+p.name+'</a></td><td>'+(p.club||"")+'</td><td>'+(p.position||"")+'</td><td>'+(p.games||0)+'</td><td><b>'+p.talentScore+'</b></td></tr>';
      });
      html += '</tbody></table>';
      pEl.innerHTML = html;
    }

    const fx = [...games].sort((a,b)=> (b.date||"").localeCompare(a.date||"")).slice(0,8);
    const fEl = document.getElementById("recentFixtures");
    if (!fx.length) { fEl.innerHTML = emptyState(); }
    else {
      let html = '<table class="data"><thead><tr><th>Date</th><th>Round</th><th>Home</th><th>Away</th><th>Venue</th></tr></thead><tbody>';
      fx.forEach(g=>{
        html += '<tr><td>'+(g.date||"")+'</td><td>'+(g.round||"")+'</td><td>'+(g.home||"")+'</td><td>'+(g.away||"")+'</td><td>'+(g.venue||"")+'</td></tr>';
      });
      html += '</tbody></table>';
      fEl.innerHTML = html;
    }
  }

  // ----- Leaderboards -----
  function renderLeaderboards() {
    const metric    = document.getElementById("lbMetric").value;
    const position  = document.getElementById("lbPosition").value;
    const minGames  = parseInt(document.getElementById("lbMinGames").value || "1", 10);

    let pool = players.filter(p => (p.games || 0) >= minGames);
    if (position) pool = pool.filter(p => (p.position||"") === position);

    const getVal = (p) => {
      if (metric === "talentScore") return p.talentScore || 0;
      const v = (p.stats || {})[metric] || 0;
      return p.games ? +(v / p.games).toFixed(2) : 0;
    };
    pool.sort((a,b)=>getVal(b)-getVal(a));

    const el = document.getElementById("lbTable");
    if (!pool.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Pos</th><th>Games</th><th>'+metric+(metric==="talentScore"?"":" / game")+'</th></tr></thead><tbody>';
    pool.slice(0,30).forEach((p,i)=>{
      html += '<tr><td>'+(i+1)+'</td><td><a href="#" data-pid="'+p.id+'" class="player-link">'+p.name+'</a></td><td>'+(p.club||"")+'</td><td>'+(p.position||"")+'</td><td>'+(p.games||0)+'</td><td><b>'+getVal(p)+'</b></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }
  ["lbMetric","lbPosition","lbMinGames"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderLeaderboards);
  });

  // ----- Players list + profile -----
  function renderPlayerList() {
    const q = (document.getElementById("playerSearch").value || "").toLowerCase();
    const el = document.getElementById("playerList");
    const filtered = players.filter(p =>
      !q || (p.name||"").toLowerCase().includes(q) || (p.club||"").toLowerCase().includes(q)
    ).sort((a,b)=>b.talentScore-a.talentScore);
    if (!filtered.length) { el.innerHTML = emptyState(); return; }
    let html = '<table class="data"><thead><tr><th></th><th>Player</th><th>Club</th><th>Pos</th><th>Score</th><th></th></tr></thead><tbody>';
    filtered.slice(0,200).forEach(p=>{
      const starred = watchlist.includes(p.id);
      html += '<tr><td><button class="star" data-pid="'+p.id+'">'+(starred?'★':'☆')+'</button></td>'
            + '<td><a href="#" data-pid="'+p.id+'" class="player-link">'+p.name+'</a></td>'
            + '<td>'+(p.club||"")+'</td><td>'+(p.position||"")+'</td><td><b>'+p.talentScore+'</b></td>'
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
      renderPlayerList(); renderWatchlist();
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
    currentPlayerId = pid;
    document.querySelector('.tab[data-tab="players"]').click();
    document.getElementById("playerList").classList.add("hidden");
    const prof = document.getElementById("playerProfile");
    prof.classList.remove("hidden");
    document.getElementById("profileName").textContent = p.name;
    document.getElementById("profileMeta").textContent =
      [p.club, p.position, (p.games||0)+" games", "Talent score: "+p.talentScore].filter(Boolean).join(" · ");
    const s = p.stats || {};
    const tiles = ["goals","disposals","contested","marks","tackles","clearances","inside50"].map(k => {
      const v = s[k]||0;
      const pg = p.games ? +(v/p.games).toFixed(1) : 0;
      return '<div class="tile"><div class="tile-label">'+k+'</div><div class="tile-value">'+pg+'</div><div class="muted">total '+v+'</div></div>';
    }).join("");
    document.getElementById("profileStats").innerHTML = '<div class="tiles">'+tiles+'</div>';

    // Sparkline: talent score per game (uses p.history if present)
    const hist = p.history || [];
    drawSparkline("profileChart", hist.map(h => h.talentScore || 0));

    const gEl = document.getElementById("profileGames");
    if (!hist.length) { gEl.innerHTML = emptyState("No per-game data available."); return; }
    let html = '<table class="data"><thead><tr><th>Date</th><th>Opp</th><th>G</th><th>D</th><th>CP</th><th>T</th><th>Clr</th><th>Score</th></tr></thead><tbody>';
    hist.forEach(h=>{
      html += '<tr><td>'+(h.date||"")+'</td><td>'+(h.opponent||"")+'</td><td>'+(h.goals||0)+'</td><td>'+(h.disposals||0)+'</td><td>'+(h.contested||0)+'</td><td>'+(h.tackles||0)+'</td><td>'+(h.clearances||0)+'</td><td><b>'+(h.talentScore||0)+'</b></td></tr>';
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
  function renderScout() {
    const sel = document.getElementById("scoutClub");
    const clubs = Array.from(new Set(players.map(p=>p.club).filter(Boolean))).sort();
    if (sel.options.length <= 1) {
      clubs.forEach(c=>{
        const o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o);
      });
    }
    renderScoutReport();
  }
  function renderScoutReport() {
    const club = document.getElementById("scoutClub").value;
    const el = document.getElementById("scoutReport");
    if (!club) { el.innerHTML = '<p class="muted">Pick a club to generate a scouting report.</p>'; return; }
    const squad = players.filter(p => p.club === club).sort((a,b)=>b.talentScore-a.talentScore);
    if (!squad.length) { el.innerHTML = emptyState(); return; }
    const recent = games.filter(g => g.home===club || g.away===club).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,5);
    let html = '<h3>Top 5 danger players</h3><table class="data"><thead><tr><th>Player</th><th>Pos</th><th>Score</th></tr></thead><tbody>';
    squad.slice(0,5).forEach(p=>{
      html += '<tr><td><a href="#" class="player-link" data-pid="'+p.id+'">'+p.name+'</a></td><td>'+(p.position||"")+'</td><td><b>'+p.talentScore+'</b></td></tr>';
    });
    html += '</tbody></table>';
    html += '<h3>Recent fixtures</h3>';
    if (!recent.length) html += emptyState("No recent fixtures.");
    else {
      html += '<table class="data"><thead><tr><th>Date</th><th>Round</th><th>Home</th><th>Away</th></tr></thead><tbody>';
      recent.forEach(g=>{
        html += '<tr><td>'+(g.date||"")+'</td><td>'+(g.round||"")+'</td><td>'+(g.home||"")+'</td><td>'+(g.away||"")+'</td></tr>';
      });
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  }
  document.getElementById("scoutClub").addEventListener("change", renderScoutReport);

  // ----- Watchlist -----
  function renderWatchlist() {
    const el = document.getElementById("watchlistView");
    const list = players.filter(p => watchlist.includes(p.id)).sort((a,b)=>b.talentScore-a.talentScore);
    if (!list.length) { el.innerHTML = emptyState("Your watchlist is empty."); return; }
    let html = '<table class="data"><thead><tr><th>Player</th><th>Club</th><th>Pos</th><th>Games</th><th>Score</th><th></th></tr></thead><tbody>';
    list.forEach(p=>{
      html += '<tr><td><a href="#" class="player-link" data-pid="'+p.id+'">'+p.name+'</a></td><td>'+(p.club||"")+'</td><td>'+(p.position||"")+'</td><td>'+(p.games||0)+'</td><td><b>'+p.talentScore+'</b></td><td><button class="star" data-pid="'+p.id+'">★</button></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  // ----- Settings -----
  function renderSettings() {
    document.getElementById("setLastSync").textContent = lastSync ? new Date(lastSync).toLocaleString() : "never";
  }
  document.getElementById("refreshBtn").addEventListener("click", loadData);

  // ----- Boot -----
  loadData();
})();
