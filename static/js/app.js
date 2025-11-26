let roomCode = null;
let playerId = null;
let ws = null;
let currentRound = 0;
let hasSubmittedThisRound = false;
let gameStarted = false;
let roundTimer = null;
let timeRemaining = 15;
let usedNumbers = [];  // Track which numbers this player has already used

/* Create Room */
const createForm = document.getElementById("create-room-form");
if (createForm) {
    createForm.addEventListener("submit", e => {
        e.preventDefault();

        const numPlayers = document.getElementById("num_players").value;
        const numRounds = document.getElementById("num_rounds").value;

        fetch("/create_room", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                num_players: numPlayers,
                num_rounds: numRounds
            })
        })
        .then(r => r.json())
        .then(d => {
            alert("Room Code: " + d.room_code + "\n\nShare this code with other players to start the game!");
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
        .then(r => r.json())
        .then(d => {
            if (d.status !== "joined") {
                alert(d.message || "Failed to join room.");
                return;
            }

            roomCode = d.room_code;
            playerId = d.player_id;

            // Hide lobby, show game UI
            document.getElementById("create-room").style.display = "none";
            document.getElementById("join-room").style.display = "none";
            document.getElementById("game-ui").style.display = "block";

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
                alert("Connection lost!");
            };
        })
        .catch(err => {
            alert("Error joining room: " + err.message);
        });
    });
}


function handleMessage(msg) {
    if (msg.type === "game_state") {
        currentRound = msg.state.current_round;
        gameStarted = msg.state.game_started;
        usedNumbers = msg.used_numbers || [];
        
        document.getElementById("current-round").textContent = currentRound;
        document.getElementById("total-rounds").textContent = msg.state.num_rounds;
        
        updatePlayerList(msg.state.players, msg.state.scores);
        
        if (gameStarted) {
            createNumberButtons(10);
            startRoundTimer();
        } else {
            showWaitingForPlayers(msg.state.players.length, msg.state.num_players);
        }
        
        hasSubmittedThisRound = false;
    }

    if (msg.type === "player_update") {
        updatePlayerList(msg.players, msg.scores);
        
        if (msg.game_started && !gameStarted) {
            gameStarted = true;
            createNumberButtons(10);
            startRoundTimer();
            hideWaitingForPlayers();
        } else if (!msg.game_started) {
            const numPlayers = msg.players.length;
            const totalSlots = Object.keys(msg.scores).length > 0 ? 
                Math.max(...Object.keys(msg.scores).map(Number)) + 1 : numPlayers;
            showWaitingForPlayers(numPlayers, totalSlots);
        }
    }
    
    if (msg.type === "used_numbers_update") {
        usedNumbers = msg.used_numbers || [];
        createNumberButtons(10);
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
        createNumberButtons(10);
        document.getElementById("number-buttons").style.display = "flex";
        
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
    const timerDiv = document.getElementById("round-timer");
    if (timerDiv) {
        timerDiv.textContent = "";
    }
}


function updateTimerDisplay() {
    let timerDiv = document.getElementById("round-timer");
    if (!timerDiv) {
        timerDiv = document.createElement("div");
        timerDiv.id = "round-timer";
        timerDiv.className = "timer-display";
        document.querySelector(".game-header").appendChild(timerDiv);
    }
    
    timerDiv.textContent = `Time remaining: ${timeRemaining}s`;
    
    if (timeRemaining <= 5) {
        timerDiv.style.color = "#dc3545";
        timerDiv.style.fontWeight = "bold";
    } else {
        timerDiv.style.color = "#667eea";
        timerDiv.style.fontWeight = "normal";
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
        <h3>${current}/${total} Players</h3>
        <p>Waiting for players to join...</p>
        <p>The game will start automatically when all players join!</p>
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
    container.innerHTML = "<h3>Players:</h3>";
    
    players.forEach(player => {
        const playerDiv = document.createElement("div");
        playerDiv.className = "player-item";
        const score = scores[player.id] || 0;
        playerDiv.innerHTML = `
            <span class="player-name">${player.name}${player.id === playerId ? " (You)" : ""}</span>
            <span class="player-score">Score: ${score}</span>
        `;
        container.appendChild(playerDiv);
    });
}


function updateScores(scores) {
    const playerItems = document.querySelectorAll(".player-item");
    playerItems.forEach((item, index) => {
        const scoreSpan = item.querySelector(".player-score");
        if (scoreSpan && scores[index] !== undefined) {
            scoreSpan.textContent = `Score: ${scores[index]}`;
        }
    });
}


function createNumberButtons(max) {
    const container = document.getElementById("number-buttons");
    container.innerHTML = "";
    container.style.display = "flex";

    for (let i = 1; i <= max; i++) {
        const btn = document.createElement("button");
        btn.textContent = i;
        btn.className = "number-button";
        
        // Check if this number has been used before
        if (usedNumbers.includes(i)) {
            btn.className += " used-number";
            btn.disabled = true;
            btn.title = "Already used";
        } else {
            btn.onclick = () => submitMove(i);
        }
        
        container.appendChild(btn);
    }
}


function submitMove(n) {
    if (!gameStarted) {
        alert("Game hasn't started yet!");
        return;
    }
    
    if (hasSubmittedThisRound) {
        alert("You've already submitted your choice for this round!");
        return;
    }
    
    if (usedNumbers.includes(n)) {
        alert("You've already used this number in a previous round!");
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
            btn.style.backgroundColor = "#28a745";
            btn.style.color = "white";
            btn.style.borderColor = "#28a745";
        }
        btn.disabled = true;
    });
    
    // Show waiting message
    let waitingDiv = document.getElementById("waiting-message");
    if (!waitingDiv) {
        waitingDiv = document.createElement("div");
        waitingDiv.id = "waiting-message";
        document.getElementById("game-ui").appendChild(waitingDiv);
    }
    waitingDiv.textContent = `You chose ${n}. Waiting for other players...`;
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
        document.getElementById("game-ui").appendChild(resultsDiv);
    }

    resultsDiv.innerHTML = `
        <div class="round-winner-announcement">
            <h3>🏆 Round ${msg.current_round} Winner${msg.winners.length > 1 ? 's' : ''}: ${msg.winners.join(", ")} 🏆</h3>
            <p class="highest-number">Highest Number: <strong>${msg.highest}</strong></p>
        </div>
        <h4>All Players' Choices:</h4>
        <ul class="choices-list">
            ${Object.entries(msg.player_choices).map(([name, choice]) => 
                `<li>
                    <span class="choice-name">${name}</span>
                    <span class="choice-number ${choice === msg.highest ? 'winning-choice' : ''}">${choice}</span>
                </li>`
            ).join("")}
        </ul>
        <p class="next-round-message">Next round starting in 5 seconds...</p>
    `;
    resultsDiv.style.display = "block";
}


function showGameOver(msg) {
    const gameUI = document.getElementById("game-ui");
    gameUI.innerHTML = `
        <div class="game-over-container">
            <h2>🎮 Game Over! 🎮</h2>
            <h3 class="final-winner">Winner(s): ${msg.winners.join(", ")}</h3>
            <h4>Final Scores:</h4>
            <ul class="final-scores">
                ${msg.players.map(player => 
                    `<li class="${msg.winners.includes(player.name) ? 'winner-score' : ''}">
                        ${player.name}: <strong>${msg.final_scores[player.id]} points</strong>
                    </li>`
                ).join("")}
            </ul>
            <button class="btn btn-primary" onclick="location.reload()">Play Again</button>
        </div>
    `;
}