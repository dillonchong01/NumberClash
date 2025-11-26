const socket = io();

// Listening for game state
socket.on('game_state', function(data) {
    document.getElementById('current-round').textContent = data.current_round;
    document.getElementById('player-score').textContent = data.scores[playerId];
});

socket.on('round_result', function(data) {
    document.getElementById('round-result').textContent = `Winners: ${data.winners}`;
});

// Submit move
document.getElementById('submit-move').addEventListener('click', function() {
    const playerChoice = document.getElementById('player-choice').value;
    socket.emit('player_move', roomCode, playerId, playerChoice);
});
