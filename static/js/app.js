document.getElementById('create-room-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const numPlayers = document.getElementById('num_players').value;
    const numRounds = document.getElementById('num_rounds').value;
    
    fetch('/create_room', {
        method: 'POST',
        body: new URLSearchParams({ num_players: numPlayers, num_rounds: numRounds }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    .then(response => response.json())
    .then(data => {
        alert(`Room created! Your room code is: ${data.room_code}`);
    });
});

document.getElementById('join-room-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const roomCode = document.getElementById('room_code').value;
    const playerName = document.getElementById('player_name').value;

    fetch('/join_room', {
        method: 'POST',
        body: new URLSearchParams({ room_code: roomCode, player_name: playerName }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'joined') {
            const socket = io();
            socket.emit('join_game', data.room_code, data.player_id);
        } else {
            alert('Error: Room is full or does not exist');
        }
    });
});
