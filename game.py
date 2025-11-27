from flask import Flask, render_template, request, jsonify
from flask_sock import Sock
import json
import random
import threading
import time

app = Flask(__name__)
sock = Sock(app)

rooms = {}
clients = {}
round_timers = {}


def create_room(num_players, num_rounds, round_time):
    """Create a new game room with specified settings."""
    room_code = str(random.randint(1000, 9999))
    while room_code in rooms:
        room_code = str(random.randint(1000, 9999))
    
    rooms[room_code] = {
        "players": [],
        "num_players": num_players,
        "num_rounds": num_rounds,
        "round_time": round_time,
        "current_round": 1,
        "scores": {},
        "player_numbers": {},
        "current_round_choices": {},
        "game_started": False,
        "round_in_progress": False,
        "used_numbers": {}
    }
    return room_code


def determine_winner(player_choices):
    """
    Determine the winner(s) of a round based on player choices.
    Returns empty list if there's a draw (multiple players with highest number).
    """
    if not player_choices:
        return [], 0
    
    highest = max(player_choices.values())
    winners = [pid for pid, choice in player_choices.items() if choice == highest]
    
    # In case of draw, no one gets a point
    if len(winners) > 1:
        return [], highest
    
    return winners, highest


def auto_pick_for_inactive_players(room_code):
    """Automatically pick random numbers for players who didn't submit in time."""
    if room_code not in rooms:
        return
        
    room = rooms[room_code]
    
    if not room.get("round_in_progress", False):
        return
    
    for player in room["players"]:
        pid = player["id"]
        if pid not in room["current_round_choices"]:
            max_number = room["num_rounds"]
            used_by_player = room["used_numbers"].get(pid, set())
            available_numbers = [n for n in range(1, max_number + 1) if n not in used_by_player]
            
            if available_numbers:
                random_choice = random.choice(available_numbers)
                room["current_round_choices"][pid] = random_choice
                room["used_numbers"][pid].add(random_choice)
                
                broadcast_to_player(room_code, pid, {
                    "type": "auto_picked",
                    "number": random_choice
                })
            else:
                room["current_round_choices"][pid] = 0
    
    process_round_end(room_code)


def start_round_timer(room_code):
    """Start a countdown timer for the current round."""
    if room_code not in rooms:
        return
    
    room = rooms[room_code]
    round_time = room.get("round_time", 15)
    
    def timer_callback():
        auto_pick_for_inactive_players(room_code)
    
    if room_code in round_timers:
        round_timers[room_code].cancel()
    
    timer = threading.Timer(float(round_time + 1), timer_callback)
    timer.daemon = True
    timer.start()
    round_timers[room_code] = timer


def process_round_end(room_code):
    """Process the end of a round, update scores, and determine next action."""
    if room_code not in rooms:
        return
        
    room = rooms[room_code]
    room["round_in_progress"] = False
    
    if room_code in round_timers:
        round_timers[room_code].cancel()
        del round_timers[room_code]
    
    choices = room["current_round_choices"]
    
    # Assign 0 to players who didn't submit (shouldn't happen after auto-pick)
    for player in room["players"]:
        pid = player["id"]
        if pid not in choices:
            choices[pid] = 0
    
    winners, highest = determine_winner(choices)
    
    # Award points only to winners (empty if draw)
    for w in winners:
        room["scores"][w] += 1
    
    for pid, choice in choices.items():
        room["player_numbers"][pid].append(choice)
    
    # Prepare player choices for display
    player_choices_display = {}
    for pid, choice in choices.items():
        player_name = room["players"][pid]["name"]
        player_choices_display[player_name] = choice
    
    winner_names = [room["players"][w]["name"] for w in winners] if winners else []
    
    broadcast(room_code, {
        "type": "round_result",
        "winners": winner_names,
        "highest": highest,
        "scores": room["scores"],
        "player_choices": player_choices_display,
        "current_round": room["current_round"],
        "is_draw": len(winners) == 0 and highest > 0
    })
    
    # Check if game is over
    if room["current_round"] >= room["num_rounds"]:
        def send_game_over():
            if room_code not in rooms:
                return

            max_score = max(room["scores"].values()) if room["scores"] else 0
            final_winners = [
                room["players"][pid]["name"]
                for pid, score in room["scores"].items()
                if score == max_score
            ]

            broadcast(room_code, {
                "type": "game_over",
                "winners": final_winners,
                "final_scores": room["scores"],
                "players": room["players"]
            })

        timer = threading.Timer(5.0, send_game_over)
        timer.daemon = True
        timer.start()
    else:
        # Start next round after 5 second delay
        def start_next_round():
            time.sleep(5)
            if room_code not in rooms:
                return
                
            room["current_round"] += 1
            room["current_round_choices"] = {}
            room["round_in_progress"] = True
            
            broadcast(room_code, {
                "type": "next_round",
                "current_round": room["current_round"]
            })
            
            start_round_timer(room_code)
        
        timer = threading.Timer(5.0, start_next_round)
        timer.daemon = True
        timer.start()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/room/<room_code>")
def game_room(room_code):
    if room_code not in rooms:
        return "Room not found", 404
    return render_template("game_room.html", room_code=room_code)


@app.route("/create_room", methods=["POST"])
def create_new_room():
    """Create a new game room and add the creator as the first player."""
    num_players = int(request.form["num_players"])
    num_rounds = int(request.form["num_rounds"])
    round_time = int(request.form.get("round_time", 15))
    player_name = request.form["player_name"]
    
    room_code = create_room(num_players, num_rounds, round_time)
    
    room = rooms[room_code]
    player_id = 0
    room["players"].append({"id": player_id, "name": player_name})
    room["scores"][player_id] = 0
    room["player_numbers"][player_id] = []
    room["used_numbers"][player_id] = set()
    
    return jsonify({
        "room_code": room_code,
        "player_id": player_id
    })


@app.route("/join_room", methods=["POST"])
def join_existing_room():
    """Add a player to an existing game room."""
    room_code = request.form["room_code"]
    player_name = request.form["player_name"]

    if room_code not in rooms:
        return jsonify({"status": "error", "message": "Room not found"})
    
    room = rooms[room_code]
    
    if len(room["players"]) >= room["num_players"]:
        return jsonify({"status": "error", "message": "Room is full"})
    
    player_id = len(room["players"])
    room["players"].append({"id": player_id, "name": player_name})
    room["scores"][player_id] = 0
    room["player_numbers"][player_id] = []
    room["used_numbers"][player_id] = set()
    
    # Start game when room is full
    if len(room["players"]) == room["num_players"]:
        room["game_started"] = True
        room["round_in_progress"] = True
        start_round_timer(room_code)
    
    return jsonify({
        "status": "joined",
        "player_id": player_id,
        "room_code": room_code
    })


@sock.route("/ws")
def ws(ws):
    """Handle WebSocket connections for real-time game updates."""
    room_code = None
    player_id = None

    try:
        while True:
            data = ws.receive()
            if data is None:
                break

            msg = json.loads(data)

            if msg["type"] == "join":
                room_code = msg["room_code"]
                player_id = msg["player_id"]
                clients[ws] = (room_code, player_id)

                room = rooms[room_code]
                safe_room = dict(room)
                safe_room["used_numbers"] = {
                    pid: list(nums) for pid, nums in room["used_numbers"].items()
                }

                ws.send(json.dumps({
                    "type": "game_state",
                    "state": safe_room,
                    "used_numbers": safe_room["used_numbers"].get(player_id, []),
                    "num_players": room["num_players"]
                }))
                                
                broadcast(room_code, {
                    "type": "player_update",
                    "players": room["players"],
                    "scores": room["scores"],
                    "game_started": room["game_started"],
                    "num_players": room["num_players"],
                    "num_rounds": room["num_rounds"],
                    "round_time": room["round_time"]
                })

            elif msg["type"] == "move":
                if ws not in clients:
                    continue
                    
                room_code, player_id = clients[ws]
                room = rooms[room_code]
                
                if not room.get("game_started", False):
                    continue
                
                if not room.get("round_in_progress", False):
                    continue
                
                number = msg["number"]

                if player_id not in room["current_round_choices"]:
                    if number in room["used_numbers"].get(player_id, set()):
                        continue
                    
                    room["current_round_choices"][player_id] = number
                    room["used_numbers"][player_id].add(number)

                    # Process round immediately if all players have chosen
                    if len(room["current_round_choices"]) == len(room["players"]):
                        process_round_end(room_code)

    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        if ws in clients:
            clients.pop(ws, None)


def broadcast(room_code, message):
    """Send a message to all players in a room."""
    dead = []
    for client_ws, (r, _) in list(clients.items()):
        if r == room_code:
            try:
                client_ws.send(json.dumps(message))
            except Exception as e:
                print(f"Broadcast error: {e}")
                dead.append(client_ws)

    for client_ws in dead:
        clients.pop(client_ws, None)


def broadcast_to_player(room_code, player_id, message):
    """Send a message to a specific player in a room."""
    for client_ws, (r, pid) in list(clients.items()):
        if r == room_code and pid == player_id:
            try:
                client_ws.send(json.dumps(message))
            except Exception as e:
                print(f"Broadcast to player error: {e}")
            break


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)