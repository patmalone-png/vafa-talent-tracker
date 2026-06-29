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
    players = []; games = [];
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
      document.getElementById("printBriefBtn").style.display = (tab === "brief") ? "" : "none";
      if (tab === "opponent") { autoSelectNextOpponent(); renderOpponentComparison(); }
      if (tab === "players") renderPlayersTable();
      if (tab === "watchlist") renderWatchlist();
      if (tab === "dashboard") renderDashboard();
      if (tab === "obgfc") renderOBGFCPage();
      if (tab === "brief") { autoSelectNextOpponent(); renderCoachBrief(); }
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
    renderCoachBrief();
  });
  const search = document.getElementById("playerSearch");
  if (search) search.addEventListener("input", renderPlayersTable);
  const hide = document.getElementById("hideOBGFC");
  if (hide) hide.addEventListener("change", renderPlayersTable);
  const obgfcSearch = document.getElementById("obgfcSearch");
  if (obgfcSearch) obgfcSearch.addEventListener("input", renderOBGFCSquadTable);
  const obgfcSort = document.getElementById("obgfcSort");
  if (obgfcSort) obgfcSort.addEventListener("change", renderOBGFCSquadTable);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("printBriefBtn").addEventListener("click", () => window.print());
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
// Watchlist
// =============================================================
function loadWatchlist() {
  try { watchlist = new Set(JSON.parse(localStorage.getItem(WATCH_KEY) || "[]")); }
  catch { watchlist = new Set(); }
}
function saveWatchlist() { localStorage.setItem(WATCH_KEY, JSON.stringify([...watchlist])); updateWatchBadge(); }
function loadNotes() { try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); } catch { notes = {}; } }
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
// Ladder + Form Quality
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
  }));
  list.sort((a, b) => b.points - a.points || b.percentage - a.percentage);
  list.forEach((t, i) => { t.position = i + 1; });
  return list;
}

function getTeamLadderEntry(ladder, teamName) {
  return ladder.find(t => t.team === teamName) || null;
}

function rateResult(result, opponentEntry, ladderSize) {function rateResult(result, opponentEntry,  ladder data)", cls: "rq-neutral", tier: "unknown", venueAdj: 0 };
  }
  const oppStrength = 1 - ((opponentEntry.position - 1) / (ladderSize - 1));
  const tier = oppStrength >= 0.66 ? "strong" : oppStrength >= 0.33 ? "mid" : "weak";
  const margin = Math.abs(result.margin || 0);
  const bigMargin = margin > 40;
  const isHome = result.isHome === true;
  const isAway = result.isHome === false;

  let score = 0, label = "", cls = "rq-neutral";

  if (result.result === "W") {
    if (tier === "strong") {
      score = bigMargin ? +3 : +2;
      label = bigMargin ? "Statement win vs top side" : "Quality win vs top side";
      cls = "rq-great";
    } else if (tier === "mid") {
      score = +1; label = "Solid win vs mid-table"; cls = "rq-good";
    } else {
      score = 0; label = "Expected win vs bottom side"; cls = "rq-neutral";
    }
  } else if (result.result === "L") {
    if (tier === "weak") {
      score = bigMargin ? -3 : -2;
      label = bigMargin ? "Embarrassing loss vs bottom side" : "Bad loss vs bottom side";
      cls = "rq-bad";
    } else if (tier === "mid") {
      score = -1; label = "Concerning loss vs mid-table"; cls = "rq-poor";
    } else {
      score = 0; label = "Tough loss vs top side"; cls = "rq-neutral";
    }
  } else {
    if (tier === "strong") { score = +1; label = "Creditable draw vs top side"; cls = "rq-good"; }
    else if (tier === "weak") { score = -1; label = "Disappointing draw vs bottom side"; cls = "rq-poor"; }
    else { score = 0; label = "Even draw vs mid-table"; cls = "rq-neutral"; }
  }

  // -------- Venue adjustment --------
  // Wins on the road are harder; losses at home are worse.
  let venueAdj = 0;
  if (isAway && result.result === "W") venueAdj = +1;            // away wins always carry weight
  else if (isHome && result.result === "L" && tier === "weak") venueAdj = -1;  // home loss to a bottom side compounds the failure
  else if (isHome && result.result === "L" && tier === "mid") venueAdj = -0.5; // home loss to mid is concerning
  else if (isAway && result.result === "L" && tier === "strong") venueAdj = +0.5; // away loss to top side is even more excusable
  else if (isAway && result.result === "D" && tier === "strong") venueAdj = +1;  // away draw vs top = quality
  else if (isHome && result.result === "D" && tier === "weak") venueAdj = -1;    // home draw vs bottom = poor

  const finalScore = score + venueAdj;

  // Upgrade/downgrade label if venue adjustment is meaningful
  let venueNote = "";
  if (venueAdj >= 1) venueNote = " (away)";
  else if (venueAdj <= -1) venueNote = " (at home)";
  else if (venueAdj > 0) venueNote = " (away)";
  else if (venueAdj < 0) venueNote = " (at home)";

  // Promote class if venue adjustment shifts result tier
  if (finalScore >= 3 && cls !== "rq-great") cls = "rq-great";
  else if (finalScore <= -3 && cls !== "rq-bad") cls = "rq-bad";

  return {
    score: finalScore,
    label: label + venueNote,
    cls,
    tier,
    venueAdj,
    venue: isHome ? "H" : isAway ? "A" : "?",
  };
}
  if (!opponentEntry || !ladderSize || ladderSize < 2) {


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
// Emerging Players
// =============================================================
function findEmergingPlayers(pool, n = 6) {
  const enriched = withTalent(pool).map(p => {
    const f = p.formIndicator || 0;
    const b = p.timesInBest || 0;
    const g = p.games || 0;
    return { ...p, emergeScore: (f * 1.0) + (b * 6) - (g * 1.5) };
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
// Team Form
// =============================================================
function getTeamLastN(allGames, teamName, n = 3) {
  if (!allGames || !Array.isArray(allGames)) return [];
  return allGames
    .filter(g => g.homeTeam === teamName || g.awayTeam === teamName)
    .filter(g =>
      g.homeScore != null && g.awayScore != null &&
      !(g.homeScore === 0 && g.awayScore === 0) &&
      (g.status ? g.status === "FINAL" : true)
    )
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, n);
}

function getTeamFormSummary(allGames, teamName, n = 3) {
  const lastN = getTeamLastN(allGames, teamName, n);
  if (lastN.length === 0) {
    return { results: [], wins: 0, losses: 0, draws: 0, marginAvg: 0, trend: "No data", emoji: "❔", gamesCounted: 0 };
  }
  let wins = 0, losses = 0, draws = 0, marginTotal = 0;
  const results = lastN.map(g => {
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
    return { date: g.date, opponent, teamScore, oppScore, margin, result: r, isHome, venue: isHome ? "H" : "A" };
  });
  const marginAvg = Math.round(marginTotal / lastN.length);
  let trend = "Mixed form", emoji = "➖";
  if (wins >= 2 && marginAvg > 0) { trend = "In form"; emoji = "🔥"; }
  else if (losses >= 2 && marginAvg < 0) { trend = "Out of form"; emoji = "❄️"; }
  return { results, wins, losses, draws, marginAvg, trend, emoji, gamesCounted: lastN.length };
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

function findMatchupGrade(opponent) {
  const oppGames = games.filter(g => g.homeTeam === opponent || g.awayTeam === opponent);
  if (oppGames.length === 0) return null;
  const counts = {};
  oppGames.forEach(g => { if (g.grade) counts[g.grade] = (counts[g.grade] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// =============================================================
// Renderers
// =============================================================
function renderAll() {
  updateWatchBadge();
  renderDashboard();
  renderOBGFCPage();
  renderPlayersTable();
  renderWatchlist();
  renderOpponentComparison();
  renderCoachBrief();
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
    container.innerHTML = `<div class="empty">No emerging players to surface yet.</div>`; return;
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

// =============================================================
// OBGFC Tab
// =============================================================
function renderOBGFCPage() {
  renderOBGFCSummary();
  renderOBGFCFormBlock();
  renderOBGFCSquadTable();
}

function renderOBGFCSummary() {
  const bar = document.getElementById("obgfcSummaryBar");
  if (!bar) return;
  const squad = players.filter(p => p.team === OBGFC);
  const games = squad.reduce((s, p) => Math.max(s, p.games || 0), 0);
  const totalBest = squad.reduce((s, p) => s + (p.timesInBest || 0), 0);
  const totalGoals = squad.reduce((s, p) => s + (p.goals || 0), 0);
  const avgForm = squad.length ? Math.round(squad.reduce((s, p) => s + (p.formIndicator || 0), 0) / squad.length) : 0;
  bar.innerHTML = `
    <div class="summary-pill"><span>Squad</span><strong>${squad.length}</strong></div>
    <div class="summary-pill"><span>Games</span><strong>${games}</strong></div>
    <div class="summary-pill"><span>Total Bests</span><strong>${totalBest}</strong></div>
    <div class="summary-pill"><span>Total Goals</span><strong>${totalGoals}</strong></div>
    <div class="summary-pill"><span>Avg Form</span><strong>${avgForm}</strong></div>
  `;
}

function renderOBGFCFormBlock() {
  const block = document.getElementById("obgfcFormBlock");
  if (!block) return;
  const obgfcGrade = findMatchupGrade(OBGFC);
  const ladder = buildLadder(games, obgfcGrade);
  const form = getTeamFormSummary(games, OBGFC, 5);
  const ladderEntry = getTeamLadderEntry(ladder, OBGFC);
  const ratedResults = form.results.map(r => ({
    ...r, quality: rateResult(r, getTeamLadderEntry(ladder, r.opponent), ladder.length)
  }));
  const chips = ratedResults.map(r => {
    const cls = r.result === "W" ? "chip-w" : r.result === "L" ? "chip-l" : "chip-d";
    return `<span class="form-chip ${cls}" title="${r.date} vs ${escapeHtml(r.opponent)} (${r.teamScore}-${r.oppScore}) — ${r.quality.label}">${r.result}<span class="quality-mark ${r.quality.cls}"></span></span>`;
  }).join("");
  const quality = summariseFormQuality(ratedResults.map(r => r.quality));
  const ladderInfo = ladderEntry
    ? `<div class="ladder-pos">📊 #${ladderEntry.position} of ${ladder.length} · ${ladderEntry.w}W-${ladderEntry.l}L-${ladderEntry.d}D · ${ladderEntry.percentage}%</div>`
    : "";
  block.innerHTML = `
    <div class="form-card card-obgfc">
      <div class="form-header">
        <h3><span class="dot-obgfc"></span>${escapeHtml(OBGFC)}</h3>
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

function renderOBGFCSquadTable() {
  const tbody = document.querySelector("#obgfcTable tbody");
  if (!tbody) return;
  const search = (document.getElementById("obgfcSearch")?.value || "").toLowerCase();
  const sortBy = document.getElementById("obgfcSort")?.value || "talent";
  const squad = withTalent(players).filter(p => p.team === OBGFC);
  const sortKey = {
    talent: p => -(p.talentScore || 0),
    best: p => -(p.timesInBest || 0),
    goals: p => -(p.goals || 0),
    form: p => -(p.formIndicator || 0),
    games: p => -(p.games || 0),
    name: p => p.name || "",
  }[sortBy];
  const pool = squad
    .filter(p => !search || (p.name || "").toLowerCase().includes(search))
    .sort((a, b) => {
      const va = sortKey(a), vb = sortKey(b);
      if (typeof va === "string") return va.localeCompare(vb);
      return va - vb;
    });

  if (pool.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No OBGFC players in the data yet.</td></tr>`; return;
  }

  tbody.innerHTML = pool.map(p => {
    const log = [...(p.gameLog || [])].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    const recent = log.map(g => {
      const inBest = g.inBest || g.bestPlayer;
      const cls = inBest ? "chip-w" : (g.goals > 0 ? "chip-d" : "chip-l");
      const lbl = inBest ? "B" : (g.goals > 0 ? `${g.goals}` : "·");
      return `<span class="mini-chip ${cls}" title="${escapeHtml(g.date)} vs ${escapeHtml(g.opponent)}: ${inBest ? "in best" : ""}${g.goals ? ` ${g.goals} goals` : (inBest ? "" : " no impact")}">${lbl}</span>`;
    }).join("");
    return `
      <tr>
        <td><button class="star-btn ${isWatched(p) ? "on" : ""}" data-key="${escapeAttr(playerKey(p))}">★</button></td>
        <td><a href="#" class="player-link" data-player="${escapeAttr(playerKey(p))}">${escapeHtml(p.name)}</a></td>
        <td class="num">${p.games || 0}</td>
        <td class="num">${p.timesInBest || 0}</td>
        <td class="num">${p.goals || 0}</td>
        <td class="num">${Math.round(p.formIndicator || 0)}</td>
        <td class="num"><strong>${(p.talentScore || 0).toFixed(1)}</strong></td>
        <td><div class="recent-mini">${recent || '<em class="muted">—</em>'}</div></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".star-btn").forEach(b =>
    b.addEventListener("click", () => {
      const p = players.find(x => playerKey(x) === b.dataset.key);
      if (p) { toggleWatch(p); renderOBGFCSquadTable(); renderPlayersTable(); renderWatchlist(); }
    })
  );
  tbody.querySelectorAll(".player-link").forEach(a =>
    a.addEventListener("click", e => { e.preventDefault(); openProfileByKey(a.dataset.player); })
  );
}

// =============================================================
// Players Table
// =============================================================
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
    tbody.innerHTML = `<tr><td colspan="9" class="empty">No players match the current filter.</td></tr>`; return;
  }
  tbody.innerHTML = pool.map(p => `
    <tr class="${p.team === OBGFC ? "row-obgfc" : ""}">
      <td class="cell-watch">
        <button class="star-btn ${isWatched(p) ? "on" : ""}" data-key="${escapeAttr(playerKey(p))}">★</button>
      </td>
      <td>
        ${p.team === OBGFC ? '<span class="dot-obgfc"></span>' : ""}
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
      if (p) { toggleWatch(p); renderPlayersTable(); renderWatchlist(); renderOBGFCSquadTable(); }
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
    tbody.innerHTML = `<tr><td colspan="10" class="empty">No players in your watchlist yet.</td></tr>`; return;
  }
  tbody.innerHTML = pool.map(p => {
    const k = playerKey(p);
    const note = notes[k] || "";
    return `
      <tr class="${p.team === OBGFC ? "row-obgfc" : ""}">
        <td><button class="star-btn on" data-key="${escapeAttr(k)}">★</button></td>
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
      if (p) { toggleWatch(p); renderWatchlist(); renderPlayersTable(); renderOBGFCSquadTable(); }
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
// Modal
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
    toggleWatch(p); renderPlayersTable(); renderWatchlist(); renderOBGFCSquadTable(); openProfileByKey(k);
  });
}

// =============================================================
// Opponent Comparison
// =============================================================
function renderOpponentComparison() {
  const root = document.getElementById("tab-opponent");
  if (!root) return;
  const opponent = currentOpponent;
  if (!opponent) {
    root.innerHTML = `<div class="empty">Select an opponent to view the comparison.</div>`; return;
  }
  const matchupGrade = findMatchupGrade(opponent);
  const ladder = buildLadder(games, matchupGrade);
  const obgfcForm = getTeamFormSummary(games, OBGFC, 3);
  const oppForm = getTeamFormSummary(games, opponent, 3);
  const pool = withTalent(players);
  const obgfcTop5 = topPlayersForTeam(pool, OBGFC, 5);
  const oppTop5 = topPlayersForTeam(pool, opponent, 5);
  const banner = (autoSelectedMeta && autoSelectedMeta.opponent === opponent)
    ? `<div class="auto-banner">
         ${autoSelectedMeta.type === "upcoming"
           ? `📅 Auto-loaded next match: <strong>${escapeHtml(opponent)}</strong> on ${escapeHtml(autoSelectedMeta.date)}`
           : `📋 No upcoming match — showing most recent opponent: <strong>${escapeHtml(opponent)}</strong> (${escapeHtml(autoSelectedMeta.date)})`}
       </div>` : "";
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
    ...r, quality: rateResult(r, getTeamLadderEntry(ladder, r.opponent), ladderSize)
  }));
  const chips = ratedResults.map(r => {
    const cls = r.result === "W" ? "chip-w" : r.result === "L" ? "chip-l" : "chip-d";
    return `<span class="form-chip ${cls}" title="${r.date} vs ${escapeHtml(r.opponent)} (${r.teamScore}-${r.oppScore}) — ${r.quality.label}">${r.result}<span class="quality-mark ${r.quality.cls}"></span></span>`;
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
// Coach's Brief
// =============================================================
function renderCoachBrief() {
  const root = document.getElementById("briefContent");
  if (!root) return;
  if (!currentOpponent) {
    root.innerHTML = `<div class="empty">Switch to the Opponent Comparison tab first, or pick an opponent above — the brief auto-loads OBGFC's next match.</div>`;
    return;
  }
  const opponent = currentOpponent;
  const matchupGrade = findMatchupGrade(opponent);
  const ladder = buildLadder(games, matchupGrade);
  const ladderEntry = getTeamLadderEntry(ladder, opponent);
  const obgfcEntry = getTeamLadderEntry(ladder, OBGFC);
  const ladderSize = ladder.length;

  // Last 5 games for opponent
  const oppLast5 = getTeamLastN(games, opponent, 5);
  const ratedLast5 = oppLast5.map(g => {
    const isHome = g.homeTeam === opponent;
    const teamScore = isHome ? Number(g.homeScore) : Number(g.awayScore);
    const oppScore = isHome ? Number(g.awayScore) : Number(g.homeScore);
    const oppOf = isHome ? g.awayTeam : g.homeTeam;
    const margin = teamScore - oppScore;
    const result = margin > 0 ? "W" : margin < 0 ? "L" : "D";
    const r = { date: g.date, opponent: oppOf, teamScore, oppScore, margin, result };
    return { ...r, quality: rateResult(r, getTeamLadderEntry(ladder, oppOf), ladderSize) };
  });
  const last3Form = getTeamFormSummary(games, opponent, 3);

  // Their key threats
  const oppTop5 = topPlayersForTeam(withTalent(players), opponent, 5);

  // Match meta
  const matchDate = autoSelectedMeta?.date || "TBC";
  const matchType = autoSelectedMeta?.type === "upcoming" ? "Upcoming match" : "Most recent encounter";

  // Form explainer
  const formExplainer = buildFormExplainer(ratedLast5.slice(0, 3));

  // Ladder context
  let ladderRead = "";
  if (ladderEntry) {
    const posPercent = Math.round((1 - (ladderEntry.position - 1) / Math.max(1, ladderSize - 1)) * 100);
    if (posPercent >= 70) ladderRead = `<strong>${escapeHtml(opponent)}</strong> sit at <strong>#${ladderEntry.position} of ${ladderSize}</strong> in ${escapeHtml(matchupGrade || "this grade")} — a genuine top-tier outfit (${ladderEntry.percentage}% scoring ratio, ${ladderEntry.w}W-${ladderEntry.l}L-${ladderEntry.d}D).`;
    else if (posPercent >= 40) ladderRead = `<strong>${escapeHtml(opponent)}</strong> are mid-table at <strong>#${ladderEntry.position} of ${ladderSize}</strong> in ${escapeHtml(matchupGrade || "this grade")} (${ladderEntry.percentage}% scoring ratio, ${ladderEntry.w}W-${ladderEntry.l}L-${ladderEntry.d}D) — a winnable matchup if we execute.`;
    else ladderRead = `<strong>${escapeHtml(opponent)}</strong> sit at <strong>#${ladderEntry.position} of ${ladderSize}</strong> in ${escapeHtml(matchupGrade || "this grade")} — bottom-tier outfit (${ladderEntry.percentage}% scoring ratio, ${ladderEntry.w}W-${ladderEntry.l}L-${ladderEntry.d}D). Expectation is a comfortable win.`;
  }

  // Matchup verdict
  let verdict = { cls: "brief-callout", text: "Even contest on paper." };
  if (obgfcEntry && ladderEntry) {
    const diff = ladderEntry.position - obgfcEntry.position;
    if (diff > 4) verdict = { cls: "brief-callout callout-good", text: `Ladder strongly favours OBGFC (#${obgfcEntry.position} vs #${ladderEntry.position}). This is a four-pointer we should win — focus on execution and percentage building.` };
    else if (diff > 1) verdict = { cls: "brief-callout callout-good", text: `OBGFC slightly favoured (#${obgfcEntry.position} vs #${ladderEntry.position}). Start well and the result follows.` };
    else if (diff < -4) verdict = { cls: "brief-callout callout-warn", text: `Ladder strongly favours opponent (#${ladderEntry.position} vs #${obgfcEntry.position}). Set up to nullify their strengths and hunt mistakes — an upset here is gold.` };
    else if (diff < -1) verdict = { cls: "brief-callout callout-warn", text: `Opponent slightly favoured (#${ladderEntry.position} vs #${obgfcEntry.position}). Disciplined first half is the key.` };
    else verdict = { cls: "brief-callout", text: `Closely matched (#${obgfcEntry.position} vs #${ladderEntry.position}) — game on paper. First 10 minutes will set the tone.` };
  }

  // Last 5 results table
  const last5Rows = ratedLast5.length ? ratedLast5.map(r => `
    <tr>
      <td>${escapeHtml(r.date || "")}</td>
      <td>${escapeHtml(r.opponent || "")}</td>
      <td class="result-${r.result.toLowerCase()}">${r.result}</td>
      <td class="num">${r.teamScore}–${r.oppScore}</td>
      <td class="num">${r.margin > 0 ? "+" : ""}${r.margin}</td>
      <td><span class="quality-tag ${r.quality.cls}">${escapeHtml(r.quality.label)}</span></td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="empty">No completed games on record.</td></tr>`;

  // Threats grid
  const threats = oppTop5.map(p => `
    <div class="brief-threat-card">
      <h4>${escapeHtml(p.name)}</h4>
      <div class="threat-meta">${escapeHtml(p.team || "")}</div>
      <div class="threat-stats">
        <span>GP ${p.games || 0}</span>
        <span>Best ${p.timesInBest || 0}</span>
        <span>Goals ${p.goals || 0}</span>
        <span>Form ${Math.round(p.formIndicator || 0)}</span>
        <span><strong>Talent ${(p.talentScore || 0).toFixed(1)}</strong></span>
      </div>
    </div>
  `).join("");

  root.innerHTML = `
    <div class="brief-wrap">
      <div class="brief-header">
        <h1>Coach's Brief — OBGFC vs ${escapeHtml(opponent)}</h1>
        <div class="brief-sub">${escapeHtml(matchType)} · ${escapeHtml(matchDate)} · ${escapeHtml(matchupGrade || "")}</div>
      </div>

      <div class="brief-section">
        <h2>🎯 Bottom line up front</h2>
        <div class="${verdict.cls}">${verdict.text}</div>
      </div>

      <div class="brief-section">
        <h2>📊 Ladder context</h2>
        <p>${ladderRead || "No ladder data available."}</p>
      </div>

      <div class="brief-section">
        <h2>📅 Last 5 games for ${escapeHtml(opponent)}</h2>
        <table class="brief-results-table">
          <thead>
            <tr><th>Date</th><th>Opponent</th><th>Result</th><th class="num">Score</th><th class="num">Margin</th><th>Quality</th></tr>
          </thead>
          <tbody>${last5Rows}</tbody>
        </table>
      </div>

      <div class="brief-section">
        <h2>🔥 Form read — last 3 games</h2>
        <p><strong>${escapeHtml(opponent)}:</strong> ${last3Form.emoji} <strong>${escapeHtml(last3Form.trend)}</strong> · ${last3Form.wins}W-${last3Form.losses}L-${last3Form.draws}D · Avg margin ${last3Form.marginAvg > 0 ? "+" : ""}${last3Form.marginAvg}</p>
        ${formExplainer}
      </div>

      <div class="brief-section">
        <h2>⚠️ Players to neutralise</h2>
        <div class="brief-threats">${threats || '<div class="empty">No player data.</div>'}</div>
      </div>

      <div class="brief-section">
        <h2>📝 Coach's notes</h2>
        <div class="brief-callout">
          Print this brief and add hand-written tactical notes for the match committee — strong sides need their top players covered early, mid-table outfits often fade in the third quarter, and bottom sides will throw the kitchen sink at the first 10 minutes.
        </div>
      </div>
    </div>
  `;
}

function buildFormExplainer(rated) {
  if (!rated || rated.length === 0) return '<p class="muted">No recent results to explain.</p>';
  const rows = rated.map(r => `
    <div class="explainer-row">
      <span class="dot ${r.quality.cls}"></span>
      <div>
        <strong>${r.result === "W" ? "Win" : r.result === "L" ? "Loss" : "Draw"}</strong>
        ${r.margin !== 0 ? ` by ${Math.abs(r.margin)}` : ""}
        vs <strong>${escapeHtml(r.opponent)}</strong>
        — <em>${escapeHtml(r.quality.label)}</em>.
        ${describeQuality(r)}
      </div>
    </div>
  `).join("");
  return `<div class="brief-form-explainer">${rows}</div>`;
}

function describeQuality(r) {
  const t = r.quality.tier;
  const venue = r.isHome ? "at home" : "away";
  const venueAdj = r.quality.venueAdj || 0;

  if (r.result === "W") {
    if (t === "strong") {
      if (!r.isHome) return `Beating a top-half side ${venue} is a real statement — confidence is earned, not given.`;
      return `Beating a top side at home is the expectation when it matters — execution paid off.`;
    }
    if (t === "mid") {
      if (!r.isHome) return `Picking up the win ${venue} against a mid-table side is solid — road wins always carry extra weight.`;
      return `Held serve at home against a mid-table side — expected, executed.`;
    }
    if (!r.isHome) return `Win on the road, even against a bottom side, is never a given.`;
    return `Home win against a bottom side — flatters the form line a touch.`;
  }

  if (r.result === "L") {
    if (t === "strong") {
      if (!r.isHome) return `Loss to a top side ${venue} is highly excusable — focus is on the next one.`;
      return `Loss to a top side at home is disappointing but not alarming — they're meant to beat us.`;
    }
    if (t === "mid") {
      if (r.isHome) return `Losing at home to a mid-table side raises real questions — home form is concerning.`;
      return `Mid-table loss on the road — frustrating but recoverable.`;
    }
    if (r.isHome) return `Losing at home to a bottom side is a five-alarm fire — major vulnerability to exploit.`;
    return `Loss to a bottom side, even away, is a red flag worth pressing on.`;
  }

  if (t === "strong") {
    if (!r.isHome) return `Drawing with a top side on their deck is genuinely creditable — they'd have expected the win.`;
    return `Holding a top side to a draw at home is a missed opportunity to push them.`;
  }
  if (t === "weak") {
    if (r.isHome) return `Drawing with a bottom side at home suggests form may be soft — they should be putting these sides away.`;
    return `Disappointing draw with a bottom side on the road.`;
  }
  return `Coin-flip result against an evenly matched opponent — venue ${venue}.`;
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
