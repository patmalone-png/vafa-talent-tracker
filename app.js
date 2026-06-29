// =============================================================
// OBGFC Talent Tracker — app.js
// =============================================================

const OBGFC = "Old Brighton";
const DATA_PLAYERS = "data/players.json";
const DATA_GAMES = "data/games.json";

let players = [];
let games = [];
let currentGrade = "all";
let currentOpponent = "";

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupFilters();
  await loadData();
  populateGradeFilter();
  populateOpponentFilter();
  renderAll();
});

async function loadData() {
  try {
    const [pRes, gRes] = await Promise.all([fetch(DATA_PLAYERS), fetch(DATA_GAMES)]);
    players = pRes.ok ? await pRes.json() : [];
    games = gRes.ok ? await gRes.json() : [];
    const meta = document.getElementById("dataMeta");
    if (meta) meta.textContent = `${players.length} players · ${games.length} games`;
  } catch (err) {
    console.error("Data load failed:", err);
    players = []; games = [];
  }
}

// ---------- Tabs ----------
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.add("active");

      const oppWrap = document.getElementById("opponentFilterWrap");
      oppWrap.style.display = (tab === "opponent") ? "" : "none";

      if (tab === "opponent") renderOpponentComparison();
      if (tab === "players") renderPlayersTable();
      if (tab === "dashboard") renderDashboard();
    });
  });
}

// ---------- Filters ----------
function setupFilters() {
  document.getElementById("gradeFilter").addEventListener("change", (e) => {
    currentGrade = e.target.value;
    renderAll();
  });
  document.getElementById("opponentSelect").addEventListener("change", (e) => {
    currentOpponent = e.target.value;
    renderOpponentComparison();
  });
  const search = document.getElementById("playerSearch");
  if (search) search.addEventListener("input", renderPlayersTable);
}

function populateGradeFilter() {
  const sel = document.getElementById("gradeFilter");
  const grades = Array.from(new Set(players.map(p => p.grade).filter(Boolean))).sort();
  grades.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
}

function populateOpponentFilter() {
  const sel = document.getElementById("opponentSelect");
  const teams = new Set();
  games.forEach(g => {
    if (g.homeTeam && g.homeTeam !== OBGFC) teams.add(g.homeTeam);
    if (g.awayTeam && g.awayTeam !== OBGFC) teams.add(g.awayTeam);
  });
  Array.from(teams).sort().forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
}

// ---------- Filtering helpers ----------
function filteredPlayers() {
  if (currentGrade === "all") return players;
  return players.filter(p => p.grade === currentGrade);
}

// ---------- Talent Score ----------
function calcTalentScore(p, pool) {
  if (!p) return 0;
  const maxBest  = Math.max(1, ...pool.map(x => x.timesInBest || 0));
  const maxGoals = Math.max(1, ...pool.map(x => x.goals || 0));
  const maxGames = Math.max(1, ...pool.map(x => x.games || 0));
  const bestN  = (p.timesInBest || 0) / maxBest;
  const goalsN = (p.goals || 0) / maxGoals;
  const gamesN = (p.games || 0) / maxGames;
  const formN  = Math.max(0, Math.min(1, (p.formIndicator || 0) / 100));
  const score = (bestN * 0.40) + (goalsN * 0.25) + (gamesN * 0.15) + (formN * 0.20);
  return Math.round(score * 1000) / 10; // 0–100, 1 dp
}

function enrichWithTalent(pool) {
  return pool.map(p => ({ ...p, talentScore: calcTalentScore(p, pool) }));
}

// ---------- Renderers ----------
function renderAll() {
  renderDashboard();
  renderPlayersTable();
  renderOpponentComparison();
}

function renderDashboard() {
  const pool = enrichWithTalent(filteredPlayers());

  fillLeaderboard("lb-talent", pool, "talentScore", v => v.toFixed(1));
  fillLeaderboard("lb-best", pool, "timesInBest");
  fillLeaderboard("lb-goals", pool, "goals");
  fillLeaderboard("lb-form", pool, "formIndicator", v => `${Math.round(v)}`);
}

function fillLeaderboard(cardId, pool, key, fmt = v => v) {
  const body = document.querySelector(`#${cardId} .lb-body`);
  if (!body) return;
  const top = [...pool]
    .filter(p => (p[key] ?? 0) > 0)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0))
    .slice(0, 5);

  if (top.length === 0) {
    body.innerHTML = `<div class="empty">No data</div>`;
    return;
  }

  body.innerHTML = top.map((p, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(p.name)}<small>${escapeHtml(p.team || "")}</small></span>
      <span class="lb-val">${fmt(p[key] || 0)}</span>
    </div>
  `).join("");
}

function renderPlayersTable() {
  const tbody = document.querySelector("#playersTable tbody");
  if (!tbody) return;
  const search = (document.getElementById("playerSearch")?.value || "").toLowerCase();
  const pool = enrichWithTalent(filteredPlayers())
    .filter(p => {
      if (!search) return true;
      return (p.name || "").toLowerCase().includes(search)
          || (p.team || "").toLowerCase().includes(search);
    })
    .sort((a, b) => (b.talentScore || 0) - (a.talentScore || 0));

  if (pool.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No players match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = pool.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.team || "")}</td>
      <td>${escapeHtml(p.grade || "")}</td>
      <td class="num">${p.games || 0}</td>
      <td class="num">${p.timesInBest || 0}</td>
      <td class="num">${p.goals || 0}</td>
      <td class="num">${Math.round(p.formIndicator || 0)}</td>
      <td class="num"><strong>${(p.talentScore || 0).toFixed(1)}</strong></td>
    </tr>
  `).join("");
}

// ---------- Team Form (last 3 games) ----------
function getTeamLast3(allGames, teamName) {
  if (!allGames || !Array.isArray(allGames)) return [];
  return allGames
    .filter(g => g.homeTeam === teamName || g.awayTeam === teamName)
    .filter(g => g.homeScore != null && g.awayScore != null)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 3);
}

function getTeamFormSummary(allGames, teamName) {
  const last3 = getTeamLast3(allGames, teamName);
  if (last3.length === 0) {
    return { results: [], wins: 0, losses: 0, draws: 0, marginAvg: 0, trend: "No data", emoji: "❔", gamesCounted: 0 };
  }
  let wins = 0, losses = 0, draws = 0, marginTotal = 0;
  const results = last3.map(g => {
    const isHome = g.homeTeam === teamName;
    const teamScore = isHome ? Number(g.homeScore) : Number(g.awayScore);
    const oppScore  = isHome ? Number(g.awayScore) : Number(g.homeScore);
    const opponent  = isHome ? g.awayTeam : g.homeTeam;
    const margin    = teamScore - oppScore;
    marginTotal += margin;
    let r = "D";
    if (margin > 0) { r = "W"; wins++; }
    else if (margin < 0) { r = "L"; losses++; }
    else { draws++; }
    return { date: g.date, opponent, teamScore, oppScore, margin, result: r };
  });
  const marginAvg = Math.round(marginTotal / last3.length);
  let trend = "Mixed form", emoji = "➖";
  if (wins >= 2 && marginAvg > 0)        { trend = "In form";     emoji = "🔥"; }
  else if (losses >= 2 && marginAvg < 0) { trend = "Out of form"; emoji = "❄️"; }
  return { results, wins, losses, draws, marginAvg, trend, emoji, gamesCounted: last3.length };
}

// ---------- Opponent Comparison ----------
function renderOpponentComparison() {
  const root = document.getElementById("tab-opponent");
  if (!root) return;
  const opponent = currentOpponent;

  if (!opponent) {
    root.innerHTML = `<div class="empty">Select an opponent to view the comparison.</div>`;
    return;
  }

  const obgfcForm = getTeamFormSummary(games, OBGFC);
  const oppForm   = getTeamFormSummary(games, opponent);

  const pool = enrichWithTalent(players);
  const obgfcTop5 = topPlayersForTeam(pool, OBGFC, 5);
  const oppTop5   = topPlayersForTeam(pool, opponent, 5);

  root.innerHTML = `
    <div class="section">
      <h2>OBGFC vs ${escapeHtml(opponent)}</h2>

      <div class="form-grid">
        ${renderFormCard(OBGFC, obgfcForm)}
        ${renderFormCard(opponent, oppForm)}
      </div>

      <div class="compare-grid">
        ${renderTopPlayersTable(`${OBGFC} – Top 5`, obgfcTop5)}
        ${renderTopPlayersTable(`${escapeHtml(opponent)} – Top 5`, oppTop5)}
      </div>

      <div class="matchup-note">
        ${buildMatchupNote(obgfcForm, oppForm)}
      </div>
    </div>
  `;
}

function renderFormCard(teamName, form) {
  const chips = form.results.map(r => {
    const cls = r.result === "W" ? "chip-w" : r.result === "L" ? "chip-l" : "chip-d";
    return `<span class="form-chip ${cls}" title="${r.date} vs ${escapeHtml(r.opponent)} (${r.teamScore}-${r.oppScore})">${r.result}</span>`;
  }).join("");

  return `
    <div class="form-card">
      <div class="form-header">
        <h3>${escapeHtml(teamName)}</h3>
        <span class="form-trend">${form.emoji} ${form.trend}</span>
      </div>
      <div class="form-chips">${chips || '<em>No recent games</em>'}</div>
      <div class="form-meta">
        <span>W ${form.wins} – L ${form.losses} – D ${form.draws}</span>
        <span>Avg margin: ${form.marginAvg > 0 ? "+" : ""}${form.marginAvg}</span>
        <span>Last ${form.gamesCounted} games</span>
      </div>
    </div>
  `;
}

function renderTopPlayersTable(title, list) {
  if (!list || list.length === 0) {
    return `<div class="top-table"><h3>${title}</h3><div class="empty">No data</div></div>`;
  }
  const rows = list.map(p => `
    <tr>
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${p.games || 0}</td>
      <td class="num">${p.timesInBest || 0}</td>
      <td class="num">${p.goals || 0}</td>
      <td class="num">${(p.talentScore || 0).toFixed(1)}</td>
    </tr>
  `).join("");

  return `
    <div class="top-table">
      <h3>${title}</h3>
      <table>
        <thead>
          <tr><th>Player</th><th class="num">GP</th><th class="num">Best</th><th class="num">Goals</th><th class="num">Talent</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function topPlayersForTeam(allPlayers, teamName, n) {
  return (allPlayers || [])
    .filter(p => p.team === teamName)
    .sort((a, b) => (b.talentScore || 0) - (a.talentScore || 0))
    .slice(0, n);
}

function buildMatchupNote(obgfc, opp) {
  const diff = (obgfc.marginAvg || 0) - (opp.marginAvg || 0);
  let lean = "Even contest based on recent form.";
  if (diff > 15) lean = "OBGFC clearly the form side — press the advantage early.";
  else if (diff > 5) lean = "OBGFC slight edge on form — game on our terms if we start well.";
  else if (diff < -15) lean = "Opponent in strong form — disciplined defensive setup required.";
  else if (diff < -5) lean = "Opponent has the form edge — neutralise early, build into the game.";
  return `<strong>Form read:</strong> ${lean}`;
}

// ---------- Utility ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]
  ));
}
