// =============================================================
// OBGFC Talent Tracker — app.js
// =============================================================

const OBGFC = "Old Brighton Senior Women's";
const DATA_PLAYERS = "data/players.json";
const DATA_GAMES = "data/games.json";
const WATCH_KEY = "obgfc_watchlist_v1";
const NOTES_KEY = "obgfc_notes_v1";

let players = [];
let games = [];
let currentGrade = "all";
let currentOpponent = "";
let watchlist = new Set();
let notes = {};

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", async () => {
  loadWatchlist();
  loadNotes();
  setupTabs();
  setupFilters();
  setupModal();
  await loadData();
  enrichPlayersInPlace();
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

// ---------- Enrichment (derives missing fields if fetch script didn't supply them) ----------
function enrichPlayersInPlace() {
  players.forEach(p => {
    if (!Array.isArray(p.gameLog)) p.gameLog = [];

    // Fallback: derive timesInBest from gameLog if not provided
    if (p.timesInBest == null) {
      p.timesInBest = p.gameLog.filter(g => g.inBest === true || g.bestPlayer === true).length;
    }

    // Fallback: derive games count if missing
    if (p.games == null) {
      p.games = p.gameLog.length || 0;
    }

    // Fallback: derive goals if missing
    if (p.goals == null) {
      p.goals = p.gameLog.reduce((sum, g) => sum + (Number(g.goals) || 0), 0);
    }

    // Compute Form Indicator if missing (0–100)
    if (p.formIndicator == null) {
      p.formIndicator = computeFormIndicator(p);
    }
  });
}

function computeFormIndicator(p) {
  if (!Array.isArray(p.gameLog) || p.gameLog.length === 0) return 0;
  const sorted = [...p.gameLog].sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = sorted.slice(0, 3);
  if (recent.length === 0) return 0;
  const recentImpact = recent.reduce((s, g) =>
    s + ((g.inBest || g.bestPlayer) ? 1 : 0) + ((Number(g.goals) || 0) * 0.5), 0
  ) / recent.length;
  const seasonImpact = sorted.reduce((s, g) =>
    s + ((g.inBest || g.bestPlayer) ? 1 : 0) + ((Number(g.goals) || 0) * 0.5), 0
  ) / sorted.length;
  if (seasonImpact === 0 && recentImpact === 0) return 0;
  const ratio = seasonImpact === 0 ? 1 : recentImpact / seasonImpact;
  return Math.max(0, Math.min(100, Math.round(ratio * 50 + recentImpact * 25)));
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
      if (tab === "watchlist") renderWatchlist();
      if (tab === "dashboard") renderDashboard();
    });
  });
}

// ---------- Filters / Toolbar ----------
function setupFilters() {
  document.getElementById("gradeFilter").addEventListener("change", e => {
  currentGrade = e.target.value;
  populateOpponentFilter();   // ← add this line
  renderAll();
});
  document.getElementById("opponentSelect").addEventListener("change", e => {
    currentOpponent = e.target.value;
    renderOpponentComparison();
  });
  const search = document.getElementById("playerSearch");
  if (search) search.addEventListener("input", renderPlayersTable);
  const hide = document.getElementById("hideOBGFC");
  if (hide) hide.addEventListener("change", renderPlayersTable);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
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

  const relevantGames = (currentGrade === "all")
    ? games
    : games.filter(g => g.grade === currentGrade);

  relevantGames.forEach(g => {
    if (g.homeTeam && g.homeTeam !== OBGFC) teams.add(g.homeTeam);
    if (g.awayTeam && g.awayTeam !== OBGFC) teams.add(g.awayTeam);
  });

  // Rebuild dropdown
  const current = sel.value;
  sel.innerHTML = `<option value="">Select opponent…</option>`;
  Array.from(teams).sort().forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
  if (Array.from(teams).includes(current)) sel.value = current;
}

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
  return Math.round(score * 1000) / 10;
}
function withTalent(pool) {
  return pool.map(p => ({ ...p, talentScore: calcTalentScore(p, pool) }));
}

// ---------- Watchlist persistence ----------
function loadWatchlist() {
  try { watchlist = new Set(JSON.parse(localStorage.getItem(WATCH_KEY) || "[]")); }
  catch { watchlist = new Set(); }
}
function saveWatchlist() {
  localStorage.setItem(WATCH_KEY, JSON.stringify([...watchlist]));
  updateWatchBadge();
}
function loadNotes() {
  try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); }
  catch { notes = {}; }
}
function saveNotes() { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
function playerKey(p) { return `${p.name}__${p.team}`; }
function isWatched(p) { return watchlist.has(playerKey(p)); }
function toggleWatch(p) {
  const k = playerKey(p);
  if (watchlist.has(k)) watchlist.delete(k); else watchlist.add(k);
  saveWatchlist();
}
function updateWatchBadge() {
  const b = document.getElementById("watchCount");
  if (b) b.textContent = watchlist.size;
}

// ---------- Renderers ----------
function renderAll() {
  updateWatchBadge();
  renderDashboard();
  renderPlayersTable();
  renderWatchlist();
  renderOpponentComparison();
}

function renderDashboard() {
  const pool = withTalent(filteredPlayers());
  fillLeaderboard("lb-talent", pool, "talentScore", v => v.toFixed(1));
  fillLeaderboard("lb-best", pool, "timesInBest");
  fillLeaderboard("lb-goals", pool, "goals");
  fillLeaderboard("lb-form", pool, "formIndicator", v => Math.round(v));
}

function fillLeaderboard(cardId, pool, key, fmt = v => v) {
  const body = document.querySelector(`#${cardId} .lb-body`);
  if (!body) return;
  const top = [...pool]
    .filter(p => (p[key] ?? 0) > 0)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0))
    .slice(0, 5);
  if (top.length === 0) { body.innerHTML = `<div class="empty">No data</div>`; return; }
  body.innerHTML = top.map((p, i) => `
    <div class="lb-row ${p.team === OBGFC ? "is-obgfc" : ""}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">
        <a href="#" data-player="${escapeAttr(playerKey(p))}" class="player-link">${escapeHtml(p.name)}</a>
        <small>${escapeHtml(p.team || "")}</small>
      </span>
      <span class="lb-val">${fmt(p[key] || 0)}</span>
    </div>
  `).join("");
  body.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
}

function renderPlayersTable() {
  const tbody = document.querySelector("#playersTable tbody");
  if (!tbody) return;
  const search = (document.getElementById("playerSearch")?.value || "").toLowerCase();
  const hideOBGFC = document.getElementById("hideOBGFC")?.checked;
  const pool = withTalent(filteredPlayers())
    .filter(p => !(hideOBGFC && p.team === OBGFC))
    .filter(p => !search || (p.name || "").toLowerCase().includes(search) || (p.team || "").toLowerCase().includes(search))
    .sort((a, b) => (b.talentScore || 0) - (a.talentScore || 0));

  if (pool.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">No players match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = pool.map(p => `
    <tr class="${p.team === OBGFC ? "row-obgfc" : ""}">
      <td class="cell-watch">
        <button class="star-btn ${isWatched(p) ? "on" : ""}" data-key="${escapeAttr(playerKey(p))}" title="Toggle watchlist">★</button>
      </td>
      <td>
        ${p.team === OBGFC ? '<span class="dot-obgfc" title="OBGFC player"></span>' : ""}
        <a href="#" class="player-link" data-player="${escapeAttr(playerKey(p))}">${escapeHtml(p.name)}</a>
      </td>
      <td>${escapeHtml(p.team || "")}</td>
      <td>${escapeHtml(p.grade || "")}</td>
      <td class="num">${p.games || 0}</td>
      <td class="num">${p.timesInBest || 0}</td>
      <td class="num">${p.goals || 0}</td>
      <td class="num">${Math.round(p.formIndicator || 0)}</td>
      <td class="num"><strong>${(p.talentScore || 0).toFixed(1)}</strong></td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".star-btn").forEach(b =>
    b.addEventListener("click", e => {
      const k = b.dataset.key;
      const p = players.find(x => playerKey(x) === k);
      if (p) { toggleWatch(p); renderPlayersTable(); renderWatchlist(); }
    })
  );
  tbody.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
}

function renderWatchlist() {
  const tbody = document.querySelector("#watchlistTable tbody");
  if (!tbody) return;
  const pool = withTalent(players).filter(isWatched);
  if (pool.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty">No players in your watchlist yet. Star a player from the Players tab.</td></tr>`;
    return;
  }
  tbody.innerHTML = pool.map(p => {
    const k = playerKey(p);
    const note = notes[k] || "";
    return `
      <tr class="${p.team === OBGFC ? "row-obgfc" : ""}">
        <td><button class="star-btn on" data-key="${escapeAttr(k)}" title="Remove">★</button></td>
        <td>
          ${p.team === OBGFC ? '<span class="dot-obgfc"></span>' : ""}
          <a href="#" class="player-link" data-player="${escapeAttr(k)}">${escapeHtml(p.name)}</a>
        </td>
        <td>${escapeHtml(p.team || "")}</td>
        <td>${escapeHtml(p.grade || "")}</td>
        <td class="num">${p.games || 0}</td>
        <td class="num">${p.timesInBest || 0}</td>
        <td class="num">${p.goals || 0}</td>
        <td class="num">${Math.round(p.formIndicator || 0)}</td>
        <td class="num"><strong>${(p.talentScore || 0).toFixed(1)}</strong></td>
        <td><input type="text" class="note-input" data-key="${escapeAttr(k)}" value="${escapeAttr(note)}" placeholder="Add note…" /></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".star-btn").forEach(b =>
    b.addEventListener("click", () => {
      const p = players.find(x => playerKey(x) === b.dataset.key);
      if (p) { toggleWatch(p); renderWatchlist(); renderPlayersTable(); }
    })
  );
  tbody.querySelectorAll(".note-input").forEach(inp =>
    inp.addEventListener("change", () => { notes[inp.dataset.key] = inp.value; saveNotes(); })
  );
  tbody.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
}

// ---------- Player Profile Modal ----------
function setupModal() {
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document.getElementById("profileModal").addEventListener("click", e => {
    if (e.target.id === "profileModal") closeModal();
  });
}
function closeModal() { document.getElementById("profileModal").style.display = "none"; }
function openProfileByKey(key) {
  const p = players.find(x => playerKey(x) === key);
  if (!p) return;
  const enriched = withTalent(players).find(x => playerKey(x) === key) || p;
  const log = [...(p.gameLog || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const rows = log.length ? log.map(g => `
    <tr>
      <td>${escapeHtml(g.date || "")}</td>
      <td>${escapeHtml(g.opponent || "")}</td>
      <td class="num">${g.goals ?? 0}</td>
      <td>${(g.inBest || g.bestPlayer) ? "✅" : ""}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty">No game log available.</td></tr>`;

  const k = playerKey(p);
  document.getElementById("modalBody").innerHTML = `
    <h2>
      ${p.team === OBGFC ? '<span class="dot-obgfc"></span>' : ""}
      ${escapeHtml(p.name)}
    </h2>
    <p class="muted">${escapeHtml(p.team || "")} · ${escapeHtml(p.grade || "")}</p>
    <div class="profile-stats">
      <div><span>GP</span><strong>${p.games || 0}</strong></div>
      <div><span>Best</span><strong>${p.timesInBest || 0}</strong></div>
      <div><span>Goals</span><strong>${p.goals || 0}</strong></div>
      <div><span>Form</span><strong>${Math.round(p.formIndicator || 0)}</strong></div>
      <div><span>Talent</span><strong>${(enriched.talentScore || 0).toFixed(1)}</strong></div>
    </div>
    <div class="profile-actions">
      <button class="btn-secondary" id="modalWatchBtn">${isWatched(p) ? "★ Remove from watchlist" : "☆ Add to watchlist"}</button>
    </div>
    <h3>Game log</h3>
    <table class="data-table">
      <thead><tr><th>Date</th><th>Opponent</th><th class="num">Goals</th><th>Best</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  document.getElementById("profileModal").style.display = "flex";
  document.getElementById("modalWatchBtn").addEventListener("click", () => {
    toggleWatch(p);
    renderPlayersTable(); renderWatchlist();
    openProfileByKey(k);
  });
}

// ---------- Team Form (last 3 games) ----------
function getTeamLast3(allGames, teamName) {
  if (!allGames || !Array.isArray(allGames)) return [];
  return allGames
    .filter(g => g.homeTeam === teamName || g.awayTeam === teamName)
    .filter(g =>
      g.homeScore != null && g.awayScore != null &&
      !(g.homeScore === 0 && g.awayScore === 0) &&     // skip "null both" / unplayed
      (g.status ? g.status === "FINAL" : true)         // honour status when present
    )
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
  const pool = withTalent(players);
  const obgfcTop5 = topPlayersForTeam(pool, OBGFC, 5);
  const oppTop5   = topPlayersForTeam(pool, opponent, 5);

  root.innerHTML = `
    <div class="section">
      <h2>OBGFC vs ${escapeHtml(opponent)}</h2>
      <div class="form-grid">
        ${renderFormCard(OBGFC, obgfcForm, true)}
        ${renderFormCard(opponent, oppForm, false)}
      </div>
      <div class="compare-grid">
        ${renderTopPlayersTable(`${OBGFC} – Top 5`, obgfcTop5, true)}
        ${renderTopPlayersTable(`${escapeHtml(opponent)} – Top 5`, oppTop5, false)}
      </div>
      <div class="matchup-note">${buildMatchupNote(obgfcForm, oppForm)}</div>
    </div>
  `;

  root.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
}

function renderFormCard(teamName, form, isOBGFC) {
  const chips = form.results.map(r => {
    const cls = r.result === "W" ? "chip-w" : r.result === "L" ? "chip-l" : "chip-d";
    return `<span class="form-chip ${cls}" title="${r.date} vs ${escapeHtml(r.opponent)} (${r.teamScore}-${r.oppScore})">${r.result}</span>`;
  }).join("");
  return `
    <div class="form-card ${isOBGFC ? "card-obgfc" : ""}">
      <div class="form-header">
        <h3>${isOBGFC ? '<span class="dot-obgfc"></span>' : ""}${escapeHtml(teamName)}</h3>
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

function renderTopPlayersTable(title, list, isOBGFC) {
  if (!list || list.length === 0) {
    return `<div class="top-table"><h3>${title}</h3><div class="empty">No data</div></div>`;
  }
  const rows = list.map(p => `
    <tr class="${isOBGFC ? "row-obgfc" : ""}">
      <td>${isOBGFC ? '<span class="dot-obgfc"></span>' : ""}<a href="#" class="player-link" data-player="${escapeAttr(playerKey(p))}">${escapeHtml(p.name)}</a></td>
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
        <thead><tr><th>Player</th><th class="num">GP</th><th class="num">Best</th><th class="num">Goals</th><th class="num">Talent</th></tr></thead>
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

// ---------- Export CSV ----------
function exportCsv() {
  const pool = withTalent(filteredPlayers())
    .sort((a, b) => (b.talentScore || 0) - (a.talentScore || 0));
  const headers = ["Watchlist","Name","Team","Grade","Games","TimesInBest","Goals","FormIndicator","TalentScore","Notes"];
  const rows = pool.map(p => [
    isWatched(p) ? "Yes" : "",
    p.name || "",
    p.team || "",
    p.grade || "",
    p.games || 0,
    p.timesInBest || 0,
    p.goals || 0,
    Math.round(p.formIndicator || 0),
    (p.talentScore || 0).toFixed(1),
    notes[playerKey(p)] || ""
  ]);
  const csv = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `obgfc-talent-${stamp}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- Utility ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]
  ));
}
function escapeAttr(s) { return escapeHtml(s); }
