// =============================================================
// OBGFC Talent Tracker — app.js
// =============================================================

const OBGFC = "Old Brighton Senior Women's";
const DATA_PLAYERS = "data/players.json";
const DATA_GAMES = "data/games.json";
const WATCH_KEY = "obgfc_watchlist_v1";
const NOTES_KEY = "obgfc_notes_v1";

// ---------- State ----------
let players = [];
let games = [];
let currentGrade = "all";
let currentOpponent = "";
let watchlist = new Set();
let notes = {};
let autoSelectedMeta = null;

// =============================================================
// Boot
// =============================================================
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
    players = [];
    games = [];
  }
}

// =============================================================
// Enrichment
// =============================================================
function enrichPlayersInPlace() {
  players.forEach(p => {
    if (!Array.isArray(p.gameLog)) p.gameLog = [];
    if (p.timesInBest == null) {
      p.timesInBest = p.gameLog.filter(g => g.inBest === true || g.bestPlayer === true).length;
    }
    if (p.games == null) p.games = p.gameLog.length || 0;
    if (p.goals == null) {
      p.goals = p.gameLog.reduce((sum, g) => sum + (Number(g.goals) || 0), 0);
    }
    if (p.formIndicator == null) p.formIndicator = computeFormIndicator(p);
  });
}

function computeFormIndicator(p) {
  if (!Array.isArray(p.gameLog) || p.gameLog.length === 0) return 0;
  const sorted = [...p.gameLog].sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = sorted.slice(0, 3);
  if (recent.length === 0) return 0;
  const impact = g => ((g.inBest || g.bestPlayer) ? 1 : 0) + ((Number(g.goals) || 0) * 0.5);
  const recentImpact = recent.reduce((s, g) => s + impact(g), 0) / recent.length;
  const seasonImpact = sorted.reduce((s, g) => s + impact(g), 0) / sorted.length;
  if (seasonImpact === 0 && recentImpact === 0) return 0;
  const ratio = seasonImpact === 0 ? 1 : recentImpact / seasonImpact;
  return Math.max(0, Math.min(100, Math.round(ratio * 50 + recentImpact * 25)));
}

// =============================================================
// Tabs
// =============================================================
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.add("active");
      document.getElementById("opponentFilterWrap").style.display = (tab === "opponent") ? "" : "none";
      if (tab === "opponent") { autoSelectNextOpponent(); renderOpponentComparison(); }
      if (tab === "players") renderPlayersTable();
      if (tab === "watchlist") renderWatchlist();
      if (tab === "dashboard") renderDashboard();
    });
  });
}

// =============================================================
// Filters
// =============================================================
function setupFilters() {
  document.getElementById("gradeFilter").addEventListener("change", e => {
    currentGrade = e.target.value;
    populateOpponentFilter();
    autoSelectedMeta = null;
    renderAll();
  });
  document.getElementById("opponentSelect").addEventListener("change", e => {
    currentOpponent = e.target.value;
    autoSelectedMeta = null;
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
  sel.innerHTML = `<option value="all">All Grades</option>`;
  grades.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
}

function populateOpponentFilter() {
  const sel = document.getElementById("opponentSelect");
  const teams = new Set();
  const relevantGames = (currentGrade === "all") ? games : games.filter(g => g.grade === currentGrade);
  relevantGames.forEach(g => {
    if (g.homeTeam && g.homeTeam !== OBGFC) teams.add(g.homeTeam);
    if (g.awayTeam && g.awayTeam !== OBGFC) teams.add(g.awayTeam);
  });
  const previous = sel.value;
  sel.innerHTML = `<option value="">Select opponent…</option>`;
  Array.from(teams).sort().forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
  if (Array.from(teams).includes(previous)) sel.value = previous;
  else currentOpponent = "";
}

function filteredPlayers() {
  if (currentGrade === "all") return players;
  return players.filter(p => p.grade === currentGrade);
}

// =============================================================
// Talent Score
// =============================================================
function calcTalentScore(p, pool) {
  if (!p) return 0;
  const maxBest = Math.max(1, ...pool.map(x => x.timesInBest || 0));
  const maxGoals = Math.max(1, ...pool.map(x => x.goals || 0));
  const maxGames = Math.max(1, ...pool.map(x => x.games || 0));
  const bestN = (p.timesInBest || 0) / maxBest;
  const goalsN = (p.goals || 0) / maxGoals;
  const gamesN = (p.games || 0) / maxGames;
  const formN = Math.max(0, Math.min(1, (p.formIndicator || 0) / 100));
  return Math.round(((bestN * 0.40) + (goalsN * 0.25) + (gamesN * 0.15) + (formN * 0.20)) * 1000) / 10;
}

function withTalent(pool) {
  return pool.map(p => ({ ...p, talentScore: calcTalentScore(p, pool) }));
}

// =============================================================
// Watchlist persistence
// =============================================================
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

// =============================================================
// Ladder computation
// =============================================================
function buildLadder(allGames, gradeFilter = null) {
  const stats = {};
  allGames.forEach(g => {
    if (gradeFilter && g.grade !== gradeFilter) return;
    if (g.status && g.status !== "FINAL") return;
    if (g.homeScore == null || g.awayScore == null) return;
    if (g.homeScore === 0 && g.awayScore === 0) return;

    [
      { name: g.homeTeam, score: g.homeScore, oppScore: g.awayScore },
      { name: g.awayTeam, score: g.awayScore, oppScore: g.homeScore }
    ].forEach(t => {
      if (!t.name) return;
      if (!stats[t.name]) {
        stats[t.name] = { team: t.name, grade: g.grade, w: 0, l: 0, d: 0, pf: 0, pa: 0, games: 0, points: 0 };
      }
      const s = stats[t.name];
      s.games++;
      s.pf += Number(t.score) || 0;
      s.pa += Number(t.oppScore) || 0;
      if (t.score > t.oppScore) { s.w++; s.points += 4; }
      else if (t.score < t.oppScore) { s.l++; }
      else { s.d++; s.points += 2; }
    });
  });

  const list = Object.values(stats).map(s => ({
    ...s,
    percentage: s.pa === 0 ? 0 : Math.round((s.pf / s.pa) * 100 * 10) / 10,
    winRate: s.games === 0 ? 0 : (s.w + s.d * 0.5) / s.games
  }));
  list.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
  list.forEach((t, i) => { t.position = i + 1; });
  return list;
}

function getTeamLadderEntry(ladder, teamName) {
  return ladder.find(t => t.team === teamName) || null;
}

// =============================================================
// Form Quality rater
// =============================================================
function rateResult(result, opponentEntry, ladderSize) {
  if (!opponentEntry || !ladderSize || ladderSize < 2) {
    return { score: 0, label: "Unrated (no ladder data)", cls: "rq-neutral" };
  }
  const oppStrength = 1 - ((opponentEntry.position - 1) / (ladderSize - 1));
  const tier = oppStrength >= 0.66 ? "strong" : oppStrength >= 0.33 ? "mid" : "weak";
  const margin = Math.abs(result.margin || 0);
  const bigMargin = margin > 40;

  if (result.result === "W") {
    if (tier === "strong") return { score: bigMargin ? +3 : +2, label: bigMargin ? "Statement win vs top side" : "Quality win vs top side", cls: "rq-great" };
    if (tier === "mid")    return { score: +1, label: "Solid win vs mid-table", cls: "rq-good" };
    return { score: 0, label: "Expected win vs bottom side", cls: "rq-neutral" };
  }
  if (result.result === "L") {
    if (tier === "weak")   return { score: bigMargin ? -3 : -2, label: bigMargin ? "Embarrassing loss vs bottom side" : "Bad loss vs bottom side", cls: "rq-bad" };
    if (tier === "mid")    return { score: -1, label: "Concerning loss vs mid-table", cls: "rq-poor" };
    return { score: 0, label: "Tough loss vs top side", cls: "rq-neutral" };
  }
  if (tier === "strong")   return { score: +1, label: "Creditable draw vs top side", cls: "rq-good" };
  if (tier === "weak")     return { score: -1, label: "Disappointing draw vs bottom side", cls: "rq-poor" };
  return { score: 0, label: "Even draw vs mid-table", cls: "rq-neutral" };
}

function summariseFormQuality(rated) {
  if (rated.length === 0) return { total: 0, label: "—", cls: "rq-neutral" };
  const total = rated.reduce((s, r) => s + r.score, 0);
  if (total >= 4)  return { total, label: "Form genuinely earned vs strong opposition", cls: "rq-great" };
  if (total >= 1)  return { total, label: "Form backed by quality results", cls: "rq-good" };
  if (total === 0) return { total, label: "Form on par with ladder expectations", cls: "rq-neutral" };
  if (total >= -2) return { total, label: "Form weaker than ladder position suggests", cls: "rq-poor" };
  return { total, label: "Form masks poor results vs lesser teams", cls: "rq-bad" };
}

// =============================================================
// Emerging Players ("Players You Should Know")
// =============================================================
function findEmergingPlayers(pool, n = 6) {
  const enriched = withTalent(pool).map(p => {
    const f = p.formIndicator || 0;
    const g = p.games || 0;
    const b = p.timesInBest || 0;
    const emergeScore = (f * 1.0) + (b * 6) - (g * 1.5);
    return { ...p, emergeScore };
  });
  return enriched
    .filter(p => (p.formIndicator || 0) >= 40)
    .filter(p => (p.games || 0) >= 3 && (p.games || 0) <= 7)
    .filter(p => (p.timesInBest || 0) >= 1)
    .sort((a, b) => b.emergeScore - a.emergeScore)
    .slice(0, n);
}

function emergingTag(p) {
  const f = p.formIndicator || 0;
  const b = p.timesInBest || 0;
  const g = p.games || 0;
  const ratio = g > 0 ? b / g : 0;
  if (ratio >= 0.5 && g <= 6) return "🔥 Breakout best player";
  if (f >= 75) return "📈 Trending up sharply";
  if (b >= 3) return "⭐ Consistent impact";
  if ((p.goals || 0) >= 5) return "🎯 Emerging goal threat";
  return "👀 One to watch";
}

// =============================================================
// Renderers
// =============================================================
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
  renderEmergingPlayers();
}

function renderEmergingPlayers() {
  const container = document.getElementById("emergingGrid");
  if (!container) return;
  const pool = findEmergingPlayers(filteredPlayers(), 6);
  if (pool.length === 0) {
    container.innerHTML = `<div class="empty">No emerging players to surface yet — need at least 3 games played.</div>`;
    return;
  }
  container.innerHTML = pool.map(p => `
    <div class="emerging-card ${p.team === OBGFC ? "card-obgfc" : ""}">
      <div class="emerging-head">
        ${p.team === OBGFC ? '<span class="dot-obgfc"></span>' : ""}
        <a href="#" class="player-link" data-player="${escapeAttr(playerKey(p))}">${escapeHtml(p.name)}</a>
      </div>
      <div class="emerging-team">${escapeHtml(p.team || "")}</div>
      <div class="emerging-stats">
        <div><span>Form</span><strong>${Math.round(p.formIndicator || 0)}</strong></div>
        <div><span>GP</span><strong>${p.games || 0}</strong></div>
        <div><span>Best</span><strong>${p.timesInBest || 0}</strong></div>
        <div><span>Goals</span><strong>${p.goals || 0}</strong></div>
      </div>
      <div class="emerging-tag">${emergingTag(p)}</div>
    </div>
  `).join("");
  container.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
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
    .filter(p => !search ||
      (p.name || "").toLowerCase().includes(search) ||
      (p.team || "").toLowerCase().includes(search))
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
    b.addEventListener("click", () => {
      const p = players.find(x => playerKey(x) === b.dataset.key);
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

// =============================================================
// Player Profile Modal
// =============================================================
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
  const rows = log.length
    ? log.map(g => `
        <tr>
          <td>${escapeHtml(g.date || "")}</td>
          <td>${escapeHtml(g.opponent || "")}</td>
          <td class="num">${g.goals ?? 0}</td>
          <td>${(g.inBest || g.bestPlayer) ? "✅" : ""}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="empty">No game log available.</td></tr>`;
  const k = playerKey(p);
  document.getElementById("modalBody").innerHTML = `
    <h2>${p.team === OBGFC ? '<span class="dot-obgfc"></span>' : ""}${escapeHtml(p.name)}</h2>
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
    toggleWatch(p); renderPlayersTable(); renderWatchlist(); openProfileByKey(k);
  });
}

// =============================================================
// Team Form
// =============================================================
function getTeamLast3(allGames, teamName) {
  if (!allGames || !Array.isArray(allGames)) return [];
  return allGames
    .filter(g => g.homeTeam === teamName || g.awayTeam === teamName)
    .filter(g =>
      g.homeScore != null && g.awayScore != null &&
      !(g.homeScore === 0 && g.awayScore === 0) &&
      (g.status ? g.status === "FINAL" : true)
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
    const oppScore = isHome ? Number(g.awayScore) : Number(g.homeScore);
    const opponent = isHome ? g.awayTeam : g.homeTeam;
    const margin = teamScore - oppScore;
    marginTotal += margin;
    let r = "D";
    if (margin > 0) { r = "W"; wins++; }
    else if (margin < 0) { r = "L"; losses++; }
    else { draws++; }
    return { date: g.date, opponent, teamScore, oppScore, margin, result: r };
  });
  const marginAvg = Math.round(marginTotal / last3.length);
  let trend = "Mixed form", emoji = "➖";
  if (wins >= 2 && marginAvg > 0) { trend = "In form"; emoji = "🔥"; }
  else if (losses >= 2 && marginAvg < 0) { trend = "Out of form"; emoji = "❄️"; }
  return { results, wins, losses, draws, marginAvg, trend, emoji, gamesCounted: last3.length };
}

// =============================================================
// Auto-select next opponent
// =============================================================
function findNextOBGFCOpponent() {
  const today = new Date().toISOString().slice(0, 10);
  const obgfcGames = games.filter(g => {
    const isOurs = g.homeTeam === OBGFC || g.awayTeam === OBGFC;
    const gradeMatch = (currentGrade === "all") || (g.grade === currentGrade);
    return isOurs && gradeMatch;
  });
  const upcoming = obgfcGames
    .filter(g => g.date && g.date >= today)
    .filter(g => g.status !== "FINAL")
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (upcoming.length > 0) {
    const next = upcoming[0];
    return { opponent: next.homeTeam === OBGFC ? next.awayTeam : next.homeTeam, date: next.date, type: "upcoming" };
  }
  const past = obgfcGames.filter(g => g.date).sort((a, b) => new Date(b.date) - new Date(a.date));
  if (past.length > 0) {
    const last = past[0];
    return { opponent: last.homeTeam === OBGFC ? last.awayTeam : last.homeTeam, date: last.date, type: "recent" };
  }
  return null;
}

function autoSelectNextOpponent() {
  if (currentOpponent) return;
  const next = findNextOBGFCOpponent();
  if (!next) return;
  const sel = document.getElementById("opponentSelect");
  if (Array.from(sel.options).some(o => o.value === next.opponent)) {
    sel.value = next.opponent;
    currentOpponent = next.opponent;
    autoSelectedMeta = next;
  }
}

// =============================================================
// Opponent Comparison
// =============================================================
function findMatchupGrade(opponent) {
  // Find the most common grade in recent games involving the opponent
  const oppGames = games.filter(g => g.homeTeam === opponent || g.awayTeam === opponent);
  if (oppGames.length === 0) return null;
  const gradeCounts = {};
  oppGames.forEach(g => {
    if (g.grade) gradeCounts[g.grade] = (gradeCounts[g.grade] || 0) + 1;
  });
  return Object.entries(gradeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function renderOpponentComparison() {
  const root = document.getElementById("tab-opponent");
  if (!root) return;
  const opponent = currentOpponent;
  if (!opponent) {
    root.innerHTML = `<div class="empty">Select an opponent to view the comparison.</div>`;
    return;
  }

  const matchupGrade = findMatchupGrade(opponent);
  const ladder = buildLadder(games, matchupGrade);
  const obgfcForm = getTeamFormSummary(games, OBGFC);
  const oppForm = getTeamFormSummary(games, opponent);

  const pool = withTalent(players);
  const obgfcTop5 = topPlayersForTeam(pool, OBGFC, 5);
  const oppTop5 = topPlayersForTeam(pool, opponent, 5);

  const banner = (autoSelectedMeta && autoSelectedMeta.opponent === opponent)
    ? `<div class="auto-banner">
         ${autoSelectedMeta.type === "upcoming"
           ? `📅 Auto-loaded next match: <strong>${escapeHtml(opponent)}</strong> on ${escapeHtml(autoSelectedMeta.date)}`
           : `📋 No upcoming match — showing most recent opponent: <strong>${escapeHtml(opponent)}</strong> (${escapeHtml(autoSelectedMeta.date)})`}
       </div>`
    : "";

  root.innerHTML = `
    <div class="section">
      ${banner}
      <h2>OBGFC vs ${escapeHtml(opponent)}</h2>
      <div class="form-grid">
        ${renderFormCard(OBGFC, obgfcForm, true, ladder)}
        ${renderFormCard(opponent, oppForm, false, ladder)}
      </div>
      <div class="compare-grid">
        ${renderTopPlayersTable(`${escapeHtml(OBGFC)} – Top 5`, obgfcTop5, true)}
        ${renderTopPlayersTable(`${escapeHtml(opponent)} – Top 5`, oppTop5, false)}
      </div>
      <div class="matchup-note">${buildMatchupNote(obgfcForm, oppForm, ladder)}</div>
    </div>
  `;

  root.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
}

function renderFormCard(teamName, form, isOBGFC, ladder) {
  const ladderEntry = getTeamLadderEntry(ladder, teamName);
  const ladderSize = ladder.length;
  const ratedResults = form.results.map(r => ({
    ...r,
    quality: rateResult(r, getTeamLadderEntry(ladder, r.opponent), ladderSize)
  }));
  const chips = ratedResults.map(r => {
    const cls = r.result === "W" ? "chip-w" : r.result === "L" ? "chip-l" : "chip-d";
    const tooltip = `${r.date} vs ${escapeHtml(r.opponent)} (${r.teamScore}-${r.oppScore}) — ${r.quality.label}`;
    return `<span class="form-chip ${cls}" title="${tooltip}">${r.result}<span class="quality-mark ${r.quality.cls}"></span></span>`;
  }).join("");
  const quality = summariseFormQuality(ratedResults.map(r => r.quality));
  const ladderInfo = ladderEntry
    ? `<div class="ladder-pos">📊 #${ladderEntry.position} of ${ladderSize} · ${ladderEntry.w}W-${ladderEntry.l}L-${ladderEntry.d}D · ${ladderEntry.percentage}%</div>`
    : "";

  return `
    <div class="form-card ${isOBGFC ? "card-obgfc" : ""}">
      <div class="form-header">
        <h3>${isOBGFC ? '<span class="dot-obgfc"></span>' : ""}${escapeHtml(teamName)}</h3>
        <span class="form-trend">${form.emoji} ${form.trend}</span>
      </div>
      ${ladderInfo}
      <div class="form-chips">${chips || '<em>No recent games</em>'}</div>
      <div class="form-meta">
        <span>W ${form.wins} – L ${form.losses} – D ${form.draws}</span>
        <span>Avg margin: ${form.marginAvg > 0 ? "+" : ""}${form.marginAvg}</span>
        <span>Last ${form.gamesCounted} games</span>
      </div>
      <div class="form-quality ${quality.cls}">
        <strong>Quality of form:</strong> ${quality.label}
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
      <td>
        ${isOBGFC ? '<span class="dot-obgfc"></span>' : ""}
        <a href="#" class="player-link" data-player="${escapeAttr(playerKey(p))}">${escapeHtml(p.name)}</a>
      </td>
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

function buildMatchupNote(obgfc, opp, ladder) {
  const obgfcEntry = getTeamLadderEntry(ladder, OBGFC);
  const oppEntry = getTeamLadderEntry(ladder, currentOpponent);
  const formDiff = (obgfc.marginAvg || 0) - (opp.marginAvg || 0);

  let formRead = "Even contest based on recent form.";
  if (formDiff > 15) formRead = "OBGFC clearly the form side — press the advantage early.";
  else if (formDiff > 5) formRead = "OBGFC slight edge on form — game on our terms if we start well.";
  else if (formDiff < -15) formRead = "Opponent in strong form — disciplined defensive setup required.";
  else if (formDiff < -5) formRead = "Opponent has the form edge — neutralise early, build into the game.";

  let ladderRead = "";
  if (obgfcEntry && oppEntry) {
    const posDiff = oppEntry.position - obgfcEntry.position;
    if (posDiff > 4) ladderRead = ` Ladder favours OBGFC (#${obgfcEntry.position} vs #${oppEntry.position}) — match expectation is a win.`;
    else if (posDiff > 1) ladderRead = ` OBGFC slightly favoured by ladder (#${obgfcEntry.position} vs #${oppEntry.position}).`;
    else if (posDiff < -4) ladderRead = ` Ladder favours opponent (#${oppEntry.position} vs #${obgfcEntry.position}) — upset would be huge.`;
    else if (posDiff < -1) ladderRead = ` Opponent slightly favoured by ladder (#${oppEntry.position} vs #${obgfcEntry.position}).`;
    else ladderRead = ` Closely matched on ladder (#${obgfcEntry.position} vs #${oppEntry.position}) — coin-flip on paper.`;
  }
  return `<strong>Form read:</strong> ${formRead}${ladderRead}`;
}

// =============================================================
// Export CSV
// =============================================================
function exportCsv() {
  const pool = withTalent(filteredPlayers())
    .sort((a, b) => (b.talentScore || 0) - (a.talentScore || 0));
  const headers = ["Watchlist", "Name", "Team", "Grade", "Games", "TimesInBest", "Goals", "FormIndicator", "TalentScore", "Notes"];
  const rows = pool.map(p => [
    isWatched(p) ? "Yes" : "",
    p.name || "", p.team || "", p.grade || "",
    p.games || 0, p.timesInBest || 0, p.goals || 0,
    Math.round(p.formIndicator || 0),
    (p.talentScore || 0).toFixed(1),
    notes[playerKey(p)] || ""
  ]);
  const csv = [headers, ...rows].map(r => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `obgfc-talent-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// =============================================================
// Utility
// =============================================================
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function escapeAttr(s) { return escapeHtml(s); }
