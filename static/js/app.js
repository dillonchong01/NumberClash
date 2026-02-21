let roomCode = null;
let playerId = null;
let ws = null;
let currentRound = 0;
let hasSubmittedThisRound = false;
let gameStarted = false;
let roundTimer = null;
let timeRemaining = 15;
let usedNumbers = [];
let maxNumber = 10;
let roundTime = 15;

const roundSubtitle = document.getElementById("round-subtitle");

const createForm = document.getElementById("create-room-form");
if (createForm) {
    createForm.addEventListener("submit", (e) => {
        e.preventDefault();

        const numPlayers = document.getElementById("num_players").value;
        const numRounds = document.getElementById("num_rounds").value;
        const playerName = document.getElementById("creator_name").value;
        roundTime = parseInt(document.getElementById("round_time").value);

        fetch("/create_room", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ num_players: numPlayers, num_rounds: numRounds, player_name: playerName, round_time: roundTime })
        })
            .then((r) => r.json())
            .then((d) => {
                roomCode = d.room_code;
                playerId = d.player_id;
                enterGameUI();
                connectWebSocket();
            });
    });
}

const joinForm = document.getElementById("join-room-form");
if (joinForm) {
    joinForm.addEventListener("submit", (e) => {
        e.preventDefault();

        const code = document.getElementById("room_code").value;
        const name = document.getElementById("player_name").value;

        fetch("/join_room", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ room_code: code, player_name: name })
        })
            .then(async (r) => {
                const text = await r.text();
                try {
                    return JSON.parse(text);
                } catch {
                    throw new Error("Server returned: " + text);
                }
            })
            .then((d) => {
                if (d.status !== "joined") {
                    showNotification(d.message || "Failed to join room.", "error");
                    return;
                }

                roomCode = d.room_code;
                playerId = d.player_id;
                enterGameUI();
                connectWebSocket();
            })
            .catch((err) => showNotification("Error joining room: " + err.message, "error"));
    });
}

function enterGameUI() {
    document.getElementById("lobby").style.display = "none";
    document.getElementById("game-ui").style.display = "block";
    document.getElementById("room-code-display").textContent = roomCode;
    renderUsedNumbers();
}

function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${location.host}/ws`);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: "join", room_code: roomCode, player_id: playerId }));
    };

    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
    ws.onclose = () => showNotification("Connection lost!", "error");
}

function showCreateRoom() {
    document.getElementById("create-room").style.display = "block";
    document.getElementById("join-room").style.display = "none";
    document.getElementById("btn-create").classList.add("active");
    document.getElementById("btn-join").classList.remove("active");
}

function showJoinRoom() {
    document.getElementById("create-room").style.display = "none";
    document.getElementById("join-room").style.display = "block";
    document.getElementById("btn-create").classList.remove("active");
    document.getElementById("btn-join").classList.add("active");
}

function handleMessage(msg) {
    if (msg.type === "game_state") {
        currentRound = msg.state.current_round;
        gameStarted = msg.state.game_started;
        usedNumbers = msg.used_numbers || [];
        maxNumber = msg.state.num_rounds;
        roundTime = msg.state.round_time ?? roundTime;

        document.getElementById("current-round").textContent = currentRound;
        document.getElementById("total-rounds").textContent = msg.state.num_rounds;
        updatePlayerList(msg.state.players, msg.state.scores);
        renderUsedNumbers();

        if (gameStarted) {
            hideWaitingForPlayers();
            createNumberButtons(maxNumber);
            startRoundTimer();
            setRoundSubtitle("Pick your best available number.");
        } else {
            showWaitingForPlayers(msg.state.players.length, msg.state.num_players);
            setRoundSubtitle("Waiting for everyone to join...");
        }

        hasSubmittedThisRound = false;
    }

    if (msg.type === "player_update") {
        if (msg.num_rounds) maxNumber = msg.num_rounds;
        if (msg.round_time !== undefined) roundTime = msg.round_time;

        updatePlayerList(msg.players, msg.scores);
        gameStarted = msg.game_started;

        if (gameStarted) {
            hideWaitingForPlayers();
            createNumberButtons(maxNumber);
            startRoundTimer();
        } else {
            showWaitingForPlayers(msg.players.length, msg.num_players);
        }
    }

    if (msg.type === "used_numbers_update") {
        usedNumbers = msg.used_numbers || [];
        createNumberButtons(maxNumber);
        renderUsedNumbers();
    }

    if (msg.type === "auto_picked") {
        usedNumbers.push(msg.number);
        renderUsedNumbers();
        showNotification(`Time's up! Number ${msg.number} was auto-selected for you.`, "warning");
        setRoundSubtitle("You were auto-picked this round.");
    }

    if (msg.type === "round_result") {
        stopRoundTimer();
        hasSubmittedThisRound = false;
        updateScores(msg.scores);
        showRoundResults(msg);
    }

    if (msg.type === "next_round") {
        currentRound = msg.current_round;
        document.getElementById("current-round").textContent = currentRound;
        hasSubmittedThisRound = false;

        const resultsDiv = document.getElementById("round-results");
        if (resultsDiv) resultsDiv.style.display = "none";

        const waitingDiv = document.getElementById("waiting-message");
        if (waitingDiv) waitingDiv.style.display = "none";

        createNumberButtons(maxNumber);
        document.getElementById("number-buttons").style.display = "grid";
        startRoundTimer();
        setRoundSubtitle("New round started — choose carefully.");
    }

    if (msg.type === "game_over") {
        stopRoundTimer();
        showGameOver(msg);
    }
}

function startRoundTimer() {
    stopRoundTimer();
    timeRemaining = parseInt(roundTime);
    updateTimerDisplay();

    roundTimer = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();

        if (timeRemaining <= 0) stopRoundTimer();
    }, 1000);
}

function stopRoundTimer() {
    if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
    }
}

function updateTimerDisplay() {
    const timerBar = document.getElementById("timer-bar");
    const timerText = document.getElementById("timer-text");

    if (!timerBar || !timerText) return;

    const totalTime = parseInt(roundTime);
    const percentage = Math.max((timeRemaining / totalTime) * 100, 0);
    timerBar.style.width = percentage + "%";
    timerText.textContent = `${Math.max(timeRemaining, 0)}s remaining`;

    const lowThreshold = totalTime * 0.33;
    const medThreshold = totalTime * 0.66;

    if (timeRemaining <= lowThreshold) {
        timerBar.style.background = "linear-gradient(90deg, #ef4444 0%, #b91c1c 100%)";
    } else if (timeRemaining <= medThreshold) {
        timerBar.style.background = "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)";
    } else {
        timerBar.style.background = "linear-gradient(90deg, #8b5cf6 0%, #22d3ee 100%)";
    }
}

function setRoundSubtitle(text) {
    if (roundSubtitle) roundSubtitle.textContent = text;
}

function showWaitingForPlayers(current, total) {
    const numberButtons = document.getElementById("number-buttons");
    numberButtons.style.display = "none";

    let waitingDiv = document.getElementById("waiting-for-players");
    if (!waitingDiv) {
        waitingDiv = document.createElement("div");
        waitingDiv.id = "waiting-for-players";
        waitingDiv.className = "waiting-players-message";
        document.querySelector(".game-area").appendChild(waitingDiv);
    }

    waitingDiv.innerHTML = `
        <div class="waiting-icon">⏳</div>
        <h3>${current}/${total} Players</h3>
        <p>Waiting for players to join...</p>
        <div class="loading-dots"><span></span><span></span><span></span></div>
    `;
    waitingDiv.style.display = "block";
}

function hideWaitingForPlayers() {
    const waitingDiv = document.getElementById("waiting-for-players");
    if (waitingDiv) waitingDiv.style.display = "none";
}

function updatePlayerList(players, scores) {
    const container = document.getElementById("players-list");
    container.innerHTML = "";

    players.forEach((player) => {
        const playerDiv = document.createElement("div");
        playerDiv.className = "player-card";
        playerDiv.dataset.playerId = player.id;
        if (player.id === playerId) playerDiv.classList.add("current-player");

        const score = scores[player.id] || 0;
        playerDiv.innerHTML = `
            <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div class="player-info">
                <div class="player-name">${player.name}${player.id === playerId ? " (You)" : ""}</div>
                <div class="player-score"><span class="score-label">Score:</span><span class="score-value">${score}</span></div>
            </div>
        `;
        container.appendChild(playerDiv);
    });
}

function updateScores(scores) {
    document.querySelectorAll(".player-card").forEach((card) => {
        const pid = parseInt(card.dataset.playerId);
        const scoreValue = card.querySelector(".score-value");
        if (scoreValue && scores[pid] !== undefined) scoreValue.textContent = scores[pid];
    });
}

function createNumberButtons(max) {
    const container = document.getElementById("number-buttons");
    container.innerHTML = "";
    container.style.display = "grid";

    for (let i = 1; i <= max; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.className = "number-button";

        if (usedNumbers.includes(i)) {
            btn.classList.add("used-number");
            btn.disabled = true;
        } else {
            btn.onclick = () => submitMove(i);
        }

        container.appendChild(btn);
    }
}

function submitMove(n) {
    if (!gameStarted) return showNotification("Game hasn't started yet!", "error");
    if (hasSubmittedThisRound) return showNotification("You've already submitted your choice!", "error");
    if (usedNumbers.includes(n)) return showNotification("You've already used this number!", "error");

    ws.send(JSON.stringify({ type: "move", number: n }));

    hasSubmittedThisRound = true;
    usedNumbers.push(n);
    renderUsedNumbers();

    document.querySelectorAll(".number-button").forEach((btn) => {
        if (parseInt(btn.textContent) === n) btn.classList.add("selected");
        btn.disabled = true;
    });

    let waitingDiv = document.getElementById("waiting-message");
    if (!waitingDiv) {
        waitingDiv = document.createElement("div");
        waitingDiv.id = "waiting-message";
        waitingDiv.className = "waiting-message";
        document.querySelector(".game-area").appendChild(waitingDiv);
    }

    waitingDiv.innerHTML = `
        <div class="check-icon">✓</div>
        <p>You chose <strong>${n}</strong></p>
        <p class="waiting-text">Waiting for other players...</p>
    `;
    waitingDiv.style.display = "block";
    setRoundSubtitle(`Choice locked in: ${n}. Waiting for others.`);
}

function renderUsedNumbers() {
    const container = document.getElementById("used-number-history");
    if (!container) return;

    container.innerHTML = "";
    if (!usedNumbers.length) {
        container.innerHTML = '<span class="hint">None yet</span>';
        return;
    }

    usedNumbers
        .slice()
        .sort((a, b) => a - b)
        .forEach((num) => {
            const chip = document.createElement("span");
            chip.className = "used-chip";
            chip.textContent = num;
            container.appendChild(chip);
        });
}

function showRoundResults(msg) {
    stopRoundTimer();

    const waitingDiv = document.getElementById("waiting-message");
    if (waitingDiv) waitingDiv.style.display = "none";

    const buttonsDiv = document.getElementById("number-buttons");
    if (buttonsDiv) buttonsDiv.style.display = "none";

    let resultsDiv = document.getElementById("round-results");
    if (!resultsDiv) {
        resultsDiv = document.createElement("div");
        resultsDiv.id = "round-results";
        document.querySelector(".game-area").appendChild(resultsDiv);
    }

    const isDraw = msg.is_draw || msg.winners.length === 0;
    const winnerLabel = isDraw ? "Round Draw" : `Round ${msg.current_round} Winner${msg.winners.length > 1 ? "s" : ""}`;
    const winnerNames = isDraw ? "No unique highest number" : msg.winners.join(", ");
    setRoundSubtitle(isDraw ? "Draw round — get ready for the next one." : `Round won by ${winnerNames}.`);

    resultsDiv.innerHTML = `
        <div class="round-winner-announcement">
            <div class="trophy-icon">${isDraw ? "🤝" : "🏆"}</div>
            <h3>${winnerLabel}</h3>
            <div class="winner-names">${winnerNames}</div>
            <div class="highest-number">Highest: <span>${msg.highest}</span></div>
        </div>
        <div class="choices-grid">
            ${Object.entries(msg.player_choices)
                .map(([name, choice]) => `<div class="choice-item ${!isDraw && choice === msg.highest ? "winning-choice" : ""}"><span class="choice-name">${name}</span><span class="choice-number">${choice}</span></div>`)
                .join("")}
        </div>
        <div class="next-round-timer"><p>Next round in 5 seconds...</p></div>
    `;
    resultsDiv.style.display = "block";
}

function showGameOver(msg) {
    const gameUI = document.getElementById("game-ui");
    gameUI.innerHTML = `
        <div class="game-over-container">
            <div class="game-over-header"><div class="crown-icon">👑</div><h2>Game Over!</h2></div>
            <div class="final-winner"><h3>Winner${msg.winners.length > 1 ? "s" : ""}</h3><div class="winner-names">${msg.winners.join(", ")}</div></div>
            <div class="final-scores-container">
                <h4>Final Scores</h4>
                <div class="final-scores">
                    ${msg.players
                        .map((player) => `<div class="score-item ${msg.winners.includes(player.name) ? "winner-score" : ""}"><div class="score-player"><div class="player-avatar small">${player.name.charAt(0).toUpperCase()}</div><span>${player.name}</span></div><div class="score-points">${msg.final_scores[player.id]}</div></div>`)
                        .join("")}
                </div>
            </div>
            <button class="btn btn-primary" onclick="location.reload()">Play Again</button>
        </div>
    `;
}

function showNotification(message, type = "info") {
    const notification = document.createElement("div");
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.classList.add("show"), 10);
    setTimeout(() => {
        notification.classList.remove("show");
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

const roomCodeButton = document.getElementById("room-code-display");
if (roomCodeButton) {
    roomCodeButton.addEventListener("click", async () => {
        const code = roomCodeButton.textContent.trim();
        if (!code || code === "----") return;

        try {
            await navigator.clipboard.writeText(code);
            showNotification(`Room code ${code} copied`, "info");
        } catch {
            showNotification("Could not copy room code.", "warning");
        }
    });
}
