/* ===================================
   VAFA TALENT TRACKER V2.0
   Old Brighton Women's
=================================== */

let players = [];
let watchlist = JSON.parse(
    localStorage.getItem("watchlist") || "[]"
);

/* ===================================
   NAVIGATION
=================================== */

document.querySelectorAll(".tab").forEach(tab => {

    tab.addEventListener("click", () => {

        document
            .querySelectorAll(".tab")
            .forEach(t => t.classList.remove("active"));

        document
            .querySelectorAll(".panel")
            .forEach(p => p.classList.remove("active"));

        tab.classList.add("active");

        document
            .getElementById(tab.dataset.tab)
            .classList.add("active");

    });

});


/* ===================================
   GRADE WEIGHTING
=================================== */

function gradeWeight(grade) {

    const weights = {
        "Premier": 100,
        "Premier B": 95,
        "Division 1": 90,
        "Division 2": 80,
        "Division 3": 70,
        "Division 4": 60
    };

    return weights[grade] || 60;

}


/* ===================================
   TALENT SCORE
=================================== */

function talentScore(player) {

    let performance =
        (player.bestCount * 4) +
        (player.goals * 2);

    let consistency =
        player.games
            ? (player.bestCount / player.games) * 20
            : 0;

    let durability =
        Math.min(player.games || 0, 10);

    let form =
        player.formScore || 10;

    let competition =
        gradeWeight(player.grade);

    let total =
        (performance * 0.40) +
        (consistency * 0.20) +
        (durability * 0.10) +
        (form * 0.15) +
        (competition * 0.15);

    return Math.round(total);
}


/* ===================================
   RECRUITABILITY
=================================== */

function recruitability(player) {

    let score = 50;

    if (player.clubRank > 8)
        score += 15;

    if (player.formTrend > 0)
        score += 15;

    if (player.age <= 25)
        score += 10;

    if (player.grade !== "Premier")
        score += 10;

    return Math.min(score, 100);

}


/* ===================================
   RECRUITMENT SCORE
=================================== */

function recruitmentScore(player) {

    const talent =
        talentScore(player);

    const recruit =
        recruitability(player);

    return Math.round(
        (talent * 0.7) +
        (recruit * 0.3)
    );

}


/* ===================================
   ENRICH PLAYERS
=================================== */

function buildScores() {

    players.forEach(player => {

        player.talentScore =
            talentScore(player);

        player.recruitability =
            recruitability(player);

        player.recruitmentScore =
            recruitmentScore(player);

    });

}


/* ===================================
   SHORTLIST
=================================== */

function renderShortlist() {

    const shortlist =
        [...players]
        .sort(
            (a, b) =>
                b.recruitmentScore -
                a.recruitmentScore
        )
        .slice(0, 20);

    document.getElementById(
        "shortlistTable"
    ).innerHTML = `

    <table class="data-table">

        <thead>

            <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Club</th>
                <th>Grade</th>
                <th>Talent</th>
                <th>Recruitment</th>
            </tr>

        </thead>

        <tbody>

        ${shortlist.map((p, i) => `

            <tr>

                <td>${i + 1}</td>

                <td>${p.name}</td>

                <td>${p.club}</td>

                <td>${p.grade}</td>

                <td>${p.talentScore}</td>

                <td>${p.recruitmentScore}</td>

            </tr>

        `).join("")}

        </tbody>

    </table>
    `;

}


/* ===================================
   HIDDEN GEMS
=================================== */

function renderHiddenGems() {

    const gems = players
        .filter(
            p =>
                p.grade !== "Premier" &&
                p.talentScore >= 80
        )
        .sort(
            (a, b) =>
                b.talentScore -
                a.talentScore
        )
        .slice(0, 10);

    document.getElementById(
        "hiddenGems"
    ).innerHTML = gems.map(p => `

        <div class="player-row">

            <strong>${p.name}</strong>

            <span>${p.club}</span>

            <span>${p.talentScore}</span>

        </div>

    `).join("");

}


/* ===================================
   TRENDING PLAYERS
=================================== */

function renderTrending() {

    const trending = players
        .sort(
            (a, b) =>
                (b.formTrend || 0) -
                (a.formTrend || 0)
        )
        .slice(0, 10);

    document.getElementById(
        "risingPlayers"
    ).innerHTML = trending.map(p => `

        <div class="player-row">

            ▲ ${p.name}
            (${p.formTrend || 0})

        </div>

    `).join("");

}


/* ===================================
   PLAYERS
=================================== */

function renderPlayerList() {

    const container =
        document.getElementById(
            "playerList"
        );

    container.innerHTML =
        players
        .sort(
            (a, b) =>
                b.recruitmentScore -
                a.recruitmentScore
        )
        .map(p => `

            <div
                class="player-card"
                onclick="showPlayer('${p.id}')">

                <h3>${p.name}</h3>

                <p>

                    ${p.club}
                    |
                    ${p.grade}

                </p>

                <strong>

                    Recruitment Score:
                    ${p.recruitmentScore}

                </strong>

            </div>

        `).join("");

}


/* ===================================
   PLAYER PROFILE
=================================== */

window.showPlayer = function(playerId) {

    const player =
        players.find(
            p => p.id == playerId
        );

    if (!player) return;

    document
        .getElementById("profileName")
        .innerText = player.name;

    document
        .getElementById("profileMeta")
        .innerText =
        `${player.club} | ${player.grade}`;

    document
        .getElementById(
            "profileTalentScore"
        ).innerText =
        player.talentScore;

    document
        .getElementById(
            "profileRecruitmentScore"
        ).innerText =
        player.recruitmentScore;

    document
        .getElementById(
            "playerAssessment"
        ).innerHTML = buildAssessment(player);

};


/* ===================================
   ASSESSMENT
=================================== */

function buildAssessment(player) {

    if (player.recruitmentScore > 90) {

        return `
            <strong>
            HIGH PRIORITY TARGET
            </strong><br>
            Immediate follow up recommended.
        `;

    }

    if (player.recruitmentScore > 80) {

        return `
            Strong target.
            Watch over next 2 rounds.
        `;

    }

    return `
        Development prospect.
    `;

}


/* ===================================
   WATCHLIST
=================================== */

function renderWatchlist() {

    const table =
        document.getElementById(
            "watchlistTable"
        );

    table.innerHTML =
        watchlist.map(player => `

        <tr>

            <td>${player.name}</td>

            <td>${player.priority}</td>

            <td>${player.status}</td>

            <td>${player.nextAction}</td>

        </tr>

        `).join("");

}


/* ===================================
   CLUB ANALYSIS
=================================== */

function renderClubs() {

    const clubs = {};

    players.forEach(player => {

        if (!clubs[player.club]) {

            clubs[player.club] = {
                players: [],
                avg: 0
            };

        }

        clubs[player.club]
            .players
            .push(player);

    });

    Object.keys(clubs).forEach(club => {

        const talent =
            clubs[club]
            .players
            .map(
                p => p.talentScore
            );

        clubs[club].avg =
            Math.round(
                talent.reduce(
                    (a, b) => a + b,
                    0
                ) / talent.length
            );

    });

    const sorted =
        Object.entries(clubs)
        .sort(
            (a, b) =>
                b[1].avg -
                a[1].avg
        );

    document.getElementById(
        "clubTalentTable"
    ).innerHTML = `

        <table class="data-table">

            <thead>

                <tr>

                    <th>Club</th>
                    <th>Average Talent</th>

                </tr>

            </thead>

            <tbody>

            ${sorted.map(c => `

                <tr>

                    <td>${c[0]}</td>

                    <td>${c[1].avg}</td>

                </tr>

            `).join("")}

            </tbody>

        </table>

    `;

}


/* ===================================
   DASHBOARD NUMBERS
=================================== */

function renderKPIs() {

    document.getElementById(
        "totalPlayers"
    ).innerText =
        players.length;

    document.getElementById(
        "eliteTargets"
    ).innerText =
        players.filter(
            p => p.recruitmentScore >= 90
        ).length;

    document.getElementById(
        "priorityTargets"
    ).innerText =
        players.filter(
            p => p.recruitmentScore >= 80
        ).length;

    document.getElementById(
        "watchlistCount"
    ).innerText =
        watchlist.length;

}


/* ===================================
   INITIALISE
=================================== */

function init(playerData) {

    players = playerData;

    buildScores();

    renderKPIs();

    renderShortlist();

    renderHiddenGems();

    renderTrending();

    renderPlayerList();

    renderWatchlist();

    renderClubs();

}
