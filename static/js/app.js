let roomCode = null;
let playerId = null;
let ws = null;
let currentRound = 0;
let hasSubmittedThisRound = false;
let gameStarted = false;
let roundTimer = null;
let timeRemaining = 15;
let usedNumbers = [];  // Track which numbers this player has already used
let maxNumber = 10;  // Max number available (will be set to num_rounds)

/* Create Room */
const createForm = document.getElementById("create-room-form");
if (createForm) {
    createForm.addEventListener("submit", e => {
        e.preventDefault();

        const numPlayers = document.getElementById("num_players").value;
        const numRounds = document.getElementById("num_rounds").value;
        const playerName = document.getElementById("creator_name").value;

        fetch("/create_room", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                num_players: numPlayers,
                num_rounds: numRounds,
                player_name: playerName
            })
        })
        .then(r => r.json())
        .then(d => {
            roomCode = d.room_code;
            playerId = d.player_id;

            // Hide lobby, show game UI
            document.getElementById("lobby").style.display = "none";
            document.getElementById("game-ui").style.display = "block";
            
            // Display room code at top
            document.getElementById("room-code-display").textContent = roomCode;

            // Connect WebSocket
            const protocol = location.protocol === "https:" ? "wss" : "ws";
            ws = new WebSocket(`${protocol}://${location.host}/ws`);

            ws.onopen = () => {
                ws.send(JSON.stringify({
                    type: "join",
                    room_code: roomCode,
                    player_id: playerId
                }));
            };

            ws.onmessage = e => {
                const msg = JSON.parse(e.data);
                handleMessage(msg);
            };

            ws.onclose = () => {
                showNotification("Connection lost!", "error");
            };
        });
    });
}


/* Join Room */
const joinForm = document.getElementById("join-room-form");
if (joinForm) {
    joinForm.addEventListener("submit", e => {
        e.preventDefault();

        const code = document.getElementById("room_code").value;
        const name = document.getElementById("player_name").value;

        fetch("/join_room", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                room_code: code,
                player_name: name
            })
        })
        .then(async r => {
            const text = await r.text();
            try {
                return JSON.parse(text);
            } catch {
                throw new Error("Server returned: " + text);
            }
        })
        .then(d => {
            if (d.status !== "joined") {
                showNotification(d.message || "Failed to join room.", "error");
                return;
            }

            roomCode = d.room_code;
            playerId = d.player_id;

            // Hide lobby, show game UI
            document.getElementById("lobby").style.display = "none";
            document.getElementById("game-ui").style.display = "block";
            
            // Display room code at top
            document.getElementById("room-code-display").textContent = roomCode;

            // Connect WebSocket
            const protocol = location.protocol === "https:" ? "wss" : "ws";
            ws = new WebSocket(`${protocol}://${location.host}/ws`);

            ws.onopen = () => {
                ws.send(JSON.stringify({
                    type: "join",
                    room_code: roomCode,
                    player_id: playerId
                }));
            };

            ws.onmessage = e => {
                const msg = JSON.parse(e.data);
                handleMessage(msg);
            };

            ws.onclose = () => {
                showNotification("Connection lost!", "error");
            };
        })
        .catch(err => {
            showNotification("Error joining room: " + err.message, "error");
        });
    });
}

/* Toggle between Create and Join */
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
        maxNumber = msg.state.num_rounds;  // Set max number to num_rounds
        
        document.getElementById("current-round").textContent = currentRound;
        document.getElementById("total-rounds").textContent = msg.state.num_rounds;
        
        updatePlayerList(msg.state.players, msg.state.scores);
        
        if (gameStarted) {
            createNumberButtons(maxNumber);
            startRoundTimer();
        } else {
            showWaitingForPlayers(msg.state.players.length, msg.state.num_players);
        }
        
        hasSubmittedThisRound = false;
    }

    if (msg.type === "player_update") {
        // Update maxNumber if we have num_rounds info
        if (msg.num_rounds) {
            maxNumber = msg.num_rounds;
        }
        
        updatePlayerList(msg.players, msg.scores);
        
        if (msg.game_started && !gameStarted) {
            gameStarted = true;
            createNumberButtons(maxNumber);
            startRoundTimer();
            hideWaitingForPlayers();
        } else if (!msg.game_started) {
            showWaitingForPlayers(msg.players.length, msg.num_players);
        }
    }
    
    if (msg.type === "used_numbers_update") {
        usedNumbers = msg.used_numbers || [];
        createNumberButtons(maxNumber);
    }
    
    if (msg.type === "auto_picked") {
        usedNumbers.push(msg.number);
        showNotification(`Time's up! Number ${msg.number} was auto-selected for you.`, "warning");
    }

    if (msg.type === "round_result") {
        stopRoundTimer();
        hasSubmittedThisRound = false;
        
        // Update scores
        updateScores(msg.scores);
        
        // Show round results with 5s display
        showRoundResults(msg);
    }

    if (msg.type === "next_round") {
        currentRound = msg.current_round;
        document.getElementById("current-round").textContent = currentRound;
        hasSubmittedThisRound = false;
        
        // Hide results and show number buttons again
        const resultsDiv = document.getElementById("round-results");
        if (resultsDiv) {
            resultsDiv.style.display = "none";
        }
        
        const waitingDiv = document.getElementById("waiting-message");
        if (waitingDiv) {
            waitingDiv.style.display = "none";
        }
        
        // Re-enable number buttons for new round (used numbers will stay disabled)
        createNumberButtons(maxNumber);
        document.getElementById("number-buttons").style.display = "grid";
        
        // Start new timer
        startRoundTimer();
    }

    if (msg.type === "game_over") {
        stopRoundTimer();
        showGameOver(msg);
    }
}


function startRoundTimer() {
    stopRoundTimer();
    timeRemaining = 15;
    updateTimerDisplay();
    
    roundTimer = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        
        if (timeRemaining <= 0) {
            stopRoundTimer();
        }
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
    
    if (timerBar && timerText) {
        const percentage = (timeRemaining / 15) * 100;
        timerBar.style.width = percentage + "%";
        timerText.textContent = `${timeRemaining}s`;
        
        if (timeRemaining <= 5) {
            timerBar.style.backgroundColor = "#ef4444";
        } else {
            timerBar.style.backgroundColor = "#8b5cf6";
        }
    }
}


function showWaitingForPlayers(current, total) {
    const numberButtons = document.getElementById("number-buttons");
    numberButtons.style.display = "none";
    
    let waitingDiv = document.getElementById("waiting-for-players");
    if (!waitingDiv) {
        waitingDiv = document.createElement("div");
        waitingDiv.id = "waiting-for-players";
        waitingDiv.className = "waiting-players-message";
        document.querySelector(".game-area").insertBefore(
            waitingDiv, 
            document.getElementById("number-buttons")
        );
    }
    
    waitingDiv.innerHTML = `
        <div class="waiting-icon">⏳</div>
        <h3>${current}/${total} Players</h3>
        <p>Waiting for players to join...</p>
        <div class="loading-dots">
            <span></span><span></span><span></span>
        </div>
    `;
    waitingDiv.style.display = "block";
}


function hideWaitingForPlayers() {
    const waitingDiv = document.getElementById("waiting-for-players");
    if (waitingDiv) {
        waitingDiv.style.display = "none";
    }
}


function updatePlayerList(players, scores) {
    const container = document.getElementById("players-list");
    container.innerHTML = "";
    
    players.forEach((player, index) => {
        const playerDiv = document.createElement("div");
        playerDiv.className = "player-card";
        if (player.id === playerId) {
            playerDiv.classList.add("current-player");
        }
        const score = scores[player.id] || 0;
        playerDiv.innerHTML = `
            <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
            <div class="player-info">
                <div class="player-name">${player.name}${player.id === playerId ? " (You)" : ""}</div>
                <div class="player-score">
                    <span class="score-label">Score:</span>
                    <span class="score-value">${score}</span>
                </div>
            </div>
        `;
        container.appendChild(playerDiv);
    });
}


function updateScores(scores) {
    const playerCards = document.querySelectorAll(".player-card");
    playerCards.forEach((card, index) => {
        const scoreValue = card.querySelector(".score-value");
        if (scoreValue && scores[index] !== undefined) {
            scoreValue.textContent = scores[index];
        }
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
        
        // Check if this number has been used before
        if (usedNumbers.includes(i)) {
            btn.className += " used-number";
            btn.disabled = true;
        } else {
            btn.onclick = () => submitMove(i);
        }
        
        container.appendChild(btn);
    }
}


function submitMove(n) {
    if (!gameStarted) {
        showNotification("Game hasn't started yet!", "error");
        return;
    }
    
    if (hasSubmittedThisRound) {
        showNotification("You've already submitted your choice!", "error");
        return;
    }
    
    if (usedNumbers.includes(n)) {
        showNotification("You've already used this number!", "error");
        return;
    }

    ws.send(JSON.stringify({
        type: "move",
        number: n
    }));

    hasSubmittedThisRound = true;
    usedNumbers.push(n);  // Add to local used numbers immediately
    
    // Disable all buttons and highlight selected
    const buttons = document.querySelectorAll(".number-button");
    buttons.forEach(btn => {
        if (parseInt(btn.textContent) === n) {
            btn.classList.add("selected");
        }
        btn.disabled = true;
    });
    
    // Show waiting message
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
}


function showRoundResults(msg) {
    // Stop timer
    stopRoundTimer();
    
    // Hide waiting message and buttons
    const waitingDiv = document.getElementById("waiting-message");
    if (waitingDiv) {
        waitingDiv.style.display = "none";
    }
    
    const buttonsDiv = document.getElementById("number-buttons");
    if (buttonsDiv) {
        buttonsDiv.style.display = "none";
    }

    let resultsDiv = document.getElementById("round-results");
    if (!resultsDiv) {
        resultsDiv = document.createElement("div");
        resultsDiv.id = "round-results";
        document.querySelector(".game-area").appendChild(resultsDiv);
    }

    resultsDiv.innerHTML = `
        <div class="round-winner-announcement">
            <div class="trophy-icon">🏆</div>
            <h3>Round ${msg.current_round} Winner${msg.winners.length > 1 ? 's' : ''}</h3>
            <div class="winner-names">${msg.winners.join(", ")}</div>
            <div class="highest-number">Highest: <span>${msg.highest}</span></div>
        </div>
        <div class="choices-grid">
            ${Object.entries(msg.player_choices).map(([name, choice]) => 
                `<div class="choice-item ${choice === msg.highest ? 'winning-choice' : ''}">
                    <span class="choice-name">${name}</span>
                    <span class="choice-number">${choice}</span>
                </div>`
            ).join("")}
        </div>
        <div class="next-round-timer">
            <p>Next round in 5 seconds...</p>
        </div>
    `;
    resultsDiv.style.display = "block";
}


function showGameOver(msg) {
    const gameUI = document.getElementById("game-ui");
    gameUI.innerHTML = `
        <div class="game-over-container">
            <div class="game-over-header">
                <div class="crown-icon">👑</div>
                <h2>Game Over!</h2>
            </div>
            <div class="final-winner">
                <h3>Winner${msg.winners.length > 1 ? 's' : ''}</h3>
                <div class="winner-names">${msg.winners.join(", ")}</div>
            </div>
            <div class="final-scores-container">
                <h4>Final Scores</h4>
                <div class="final-scores">
                    ${msg.players.map(player => 
                        `<div class="score-item ${msg.winners.includes(player.name) ? 'winner-score' : ''}">
                            <div class="score-player">
                                <div class="player-avatar small">${player.name.charAt(0).toUpperCase()}</div>
                                <span>${player.name}</span>
                            </div>
                            <div class="score-points">${msg.final_scores[player.id]}</div>
                        </div>`
                    ).join("")}
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
    
    setTimeout(() => {
        notification.classList.add("show");
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove("show");
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}