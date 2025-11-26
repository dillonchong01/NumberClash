from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room, leave_room, emit
import random
import time

app = Flask(__name__)
socketio = SocketIO(app, async_mode='gevent')

# Store game rooms in memory
rooms = {}

# Room creation logic
def create_room(num_players, num_rounds):
    room_code = str(random.randint(1000, 9999))  # Generate 4-digit code
    rooms[room_code] = {
        "players": [],
        "num_players": num_players,
        "num_rounds": num_rounds,
        "current_round": 0,
        "scores": {i: 0 for i in range(num_players)},
        "player_numbers": {i: [] for i in range(num_players)},  # Numbers chosen by players
        "started": False
    }
    return room_code

# Game round logic
def determine_winner(player_choices):
    highest = max(player_choices)
    winners = [i for i, choice in enumerate(player_choices) if choice == highest]
    return winners, highest

@app.route('/')
def index():
    return render_template('index.html')

# Create room endpoint
@app.route('/create_room', methods=['POST'])
def create_new_room():
    num_players = int(request.form['num_players'])
    num_rounds = int(request.form['num_rounds'])
    room_code = create_room(num_players, num_rounds)
    return jsonify({'room_code': room_code})

# Join room endpoint
@app.route('/join_room', methods=['POST'])
def join_existing_room():
    room_code = request.form['room_code']
    player_name = request.form['player_name']
    
    if room_code in rooms and len(rooms[room_code]["players"]) < rooms[room_code]["num_players"]:
        player_id = len(rooms[room_code]["players"])
        rooms[room_code]["players"].append(player_name)
        return jsonify({'status': 'joined', 'player_id': player_id, 'room_code': room_code})
    else:
        return jsonify({'status': 'error', 'message': 'Room is full or doesn’t exist'})

# SocketIO event when a player joins a room
@socketio.on('join_game')
def handle_join_game(room_code, player_id):
    join_room(room_code)
    emit('game_state', rooms[room_code], room=room_code)
    if len(rooms[room_code]["players"]) == rooms[room_code]["num_players"]:
        start_game(room_code)

# Start the game
def start_game(room_code):
    rooms[room_code]["started"] = True
    emit('start_game', {'message': 'Game is starting!'}, room=room_code)

# Handle player move
@socketio.on('player_move')
def handle_player_move(room_code, player_id, number):
    rooms[room_code]["player_numbers"][player_id].append(number)
    
    if len(rooms[room_code]["player_numbers"][player_id]) == rooms[room_code]["num_rounds"]:
        # All players have picked their numbers
        all_choices = [rooms[room_code]["player_numbers"][i][-1] for i in range(len(rooms[room_code]["players"]))]
        winners, highest = determine_winner(all_choices)
        for winner in winners:
            rooms[room_code]["scores"][winner] += 1
        emit('round_result', {'winners': winners, 'highest': highest, 'scores': rooms[room_code]["scores"]}, room=room_code)
        
        # Move to next round or end the game if all rounds are over
        rooms[room_code]["current_round"] += 1
        if rooms[room_code]["current_round"] >= rooms[room_code]["num_rounds"]:
            emit('game_over', {'winner': max(rooms[room_code]["scores"], key=rooms[room_code]["scores"].get)}, room=room_code)
        else:
            emit('next_round', {'current_round': rooms[room_code]["current_round"]}, room=room_code)

# Vercel serverless deployment entry point
def handler(environ, start_response):
    return app(environ, start_response)

# Run the app (For local development)
if __name__ == '__main__':
    socketio.run(app, debug=True)
