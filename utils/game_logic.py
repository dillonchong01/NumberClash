def determine_winner(player_choices):
    highest = max(player_choices)
    winners = [i for i, choice in enumerate(player_choices) if choice == highest]
    return winners, highest
