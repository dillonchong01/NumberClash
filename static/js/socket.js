const socket = io();

// Listening for game state
socket.on('game_state', function(data) {
    document.getElementById('current-round').textContent = data.current_round;
    document.getElementById('player-score').textContent = data.scores[playerId];
    displayNumberButtons(data.num_rounds);
});

// Function to display number buttons dynamically
function displayNumberButtons(numRounds) {
    const buttonContainer = document.getElementById('number-buttons');
    buttonContainer.innerHTML = '';  // Clear any previous buttons

    for (let i = 1; i <= numRounds; i++) {
        const button = document.createElement('button');
        button.textContent = i;
        button.onclick = function() {
            submitMove(i);
        };
        buttonContainer.appendChild(button);
    }
}

// Submit move
function submitMove(number) {
    socket.emit('player_move', roomCode, playerId, number);
}
