"""Play a 5-seat Town Rush match with the real engine and export what the preview needs.

    python3 tools/simulate_match.py ENGINE_DIR RUSH_AI_DIR OUT_DIR [seed] [town]

ENGINE_DIR: prototypes/town-rush of a checkout (codex/town-rush-launch-fixes matches live).
TOWN: a town id the engine knows (default: the engine's default town). The preview's Molde
      data was recorded with `... data 7 molde`.
Seats: the user's rush-ai (in-process, same interface as the CLI), two ReferenceBots and two
StarterBots. Outputs:
  game.json   the public feed (engine.feed.from_replay, exactly what /api/games serves) + looks
  shop.json   the shop floor layout, rules, and every order's items/address/timeline
  (game.json also gets meta.you, the seat whose shop opens as "Your shop")
  shop.json   also truckLoads[seat][truck] = [[tick, item indexes, "0110" loaded flags]] whenever
              the items queued on that truck or their loading change
  shop.bin    per tick, per seat: 20 robots x [x, y, action, item1, item2, item3] and
              5 trucks x [items loaded, items needed] for the orders queued on that truck
"""
import json
import os
import sys

ENGINE, RUSH, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SEED = int(sys.argv[4]) if len(sys.argv) > 4 else 7
TOWN = sys.argv[5] if len(sys.argv) > 5 else None
sys.path.insert(0, ENGINE)
sys.path.insert(1, RUSH)

from engine.bots import ReferenceBot, StarterBot          # noqa: E402
from engine.feed import from_replay                        # noqa: E402
from engine.replay import Recorder                         # noqa: E402
import engine.simulation as simulation                     # noqa: E402
from engine.simulation import match_start, observe, step   # noqa: E402
import ai as rush                                          # noqa: E402  (rush-ai/ai.py)

# The engine deals products out round-robin, so the preview shop mixed milk, bread and apples on
# every aisle. For this recording the floor is laid out by department instead (OTHER-CITIES.md,
# planned change 4): dairy in the fridges at the back, produce in the bins near the entrance,
# bread on the bakery rack, dry goods on the middle shelves. The engine's robots then really do
# pick milk from the dairy fridges. Same shelf cells, same count, same products as before.
# Each block is (x, ys, fixture, department, product types top to bottom).
DEPARTMENTS = [
    (3, [3, 4, 5], 'fridge', 'Dairy', ['milk', 'milk', 'yogurt']),
    (3, [7, 8], 'fridge', 'Dairy · cream & butter', ['cream', 'butter']),
    (7, [3, 4, 5], 'fridge', 'Cheese, eggs & juice', ['cheese', 'eggs', 'juice']),
    (7, [7, 8], 'shelf', 'Breakfast', ['cereal', 'oats']),
    (11, [3, 4, 5], 'shelf', 'Pantry', ['pasta', 'rice', 'pasta']),
    (11, [7, 8], 'shelf', 'Baking', ['flour', 'sugar']),
    (15, [3, 4, 5], 'bin', 'Vegetables', ['lettuce', 'tomatoes', 'peppers']),
    (15, [7, 8], 'rack', 'Bakery', ['bread', 'bread']),
    (19, [3, 4, 5], 'bin', 'Fruit', ['apples', 'bananas', 'bananas']),
    (19, [7, 8], 'bin', 'Root vegetables', ['carrots', 'onions']),
]


engine_shop = simulation.make_shop


def department_shop(rules):
    """engine.shop.make_shop with the department layout above, or the original elsewhere."""
    base = engine_shop(rules)
    placed = {str(x) + ',' + str(y): (type, fixture) for x, ys, fixture, _, types in DEPARTMENTS for y, type in zip(ys, types)}
    cells = [i['position'] for i in base['items']]
    if len(cells) != len(placed) or any(str(x) + ',' + str(y) not in placed for x, y in cells):
        return base
    for item in base['items']:
        item['type'], item['fixture'] = placed[str(item['position'][0]) + ',' + str(item['position'][1])]
    return base

simulation.make_shop = department_shop

LOOKS = {
    'Kale Storm': {'shape': 'box', 'color': 'plum', 'eyes': 'visor', 'carriage': 'canvas', 'head': 'high', 'visor': 'tint', 'decal': 'dots'},
    'Oat Runner': {'shape': 'bean', 'color': 'red', 'eyes': 'dots', 'carriage': 'box', 'head': 'flat', 'visor': 'none', 'decal': 'stripe'},
    'Rush AI': {'shape': 'round', 'color': 'lemon', 'eyes': 'sleepy', 'carriage': 'cooler', 'head': 'nose', 'visor': 'tint', 'decal': 'band'},
    'Cheddar Dash': {'shape': 'bean', 'color': 'oat', 'eyes': 'happy', 'carriage': 'box', 'head': 'nose', 'visor': 'shade', 'decal': 'stripe'},
    'Plum Pusher': {'shape': 'dome', 'color': 'ink', 'eyes': 'wink', 'carriage': 'flatbed', 'head': 'slant', 'visor': 'lights', 'decal': 'plain'},
}
# ids sort into seat (and shop) order
SEATS = [('p1', 'Kale Storm', ReferenceBot), ('p2', 'Oat Runner', StarterBot), ('p3', 'Rush AI', 'rush'),
         ('p4', 'Cheddar Dash', ReferenceBot), ('p5', 'Plum Pusher', StarterBot)]
ACTIONS = {'wait': 0, 'move_up': 1, 'move_down': 1, 'move_left': 1, 'move_right': 1, 'pick_up': 2, 'load': 3, 'drop_off': 3}

state = simulation.create_match(seed=SEED, difficulty='medium', players=[{'id': i, 'name': n} for i, n, _ in SEATS],
                                match_id='PREVIEW', town=TOWN)
bots = {}
for pid, _, kind in SEATS:
    start = match_start(state, pid)
    bots[pid] = rush.make_bot(start) if kind == 'rush' else kind(start)
products = state['rules']['products']
order_seat = {pid: i for i, (pid, _, _) in enumerate(SEATS)}
frames = bytearray()
history = {}          # order id -> [[tick, status, seat]]
truck_loads = [[[] for _ in range(5)] for _ in SEATS]   # seat -> truck -> [[tick, item indexes, loaded "0101"]] on change


def load_of(truck):
    """The items queued on a docked truck, in order, and which of them robots have loaded."""
    items, done = [], ''
    for oid in truck['queue']:
        order = state['orders'].get(oid)
        if not order:
            continue
        left = list(order['items_delivered'])
        for item in order['items_required']:
            items.append(products.index(item))
            done += '1' if item in left else '0'
            if item in left:
                left.remove(item)
    return items, done


def capture():
    for pid, _, _ in SEATS:
        player = state['players'][pid]
        for bot in player['bots']:
            inv = [products.index(t) + 1 for t in bot['inventory']][:3]
            frames.extend([bot['position'][0], bot['position'][1], ACTIONS.get(bot['last_action'], 0), *(inv + [0] * (3 - len(inv)))])
        for t, truck in enumerate(player['trucks']):
            items, done = load_of(truck)
            log = truck_loads[order_seat[pid]][t]
            if not log or log[-1][1] != items or log[-1][2] != done:
                log.append([state['tick'], items, done])
            queued = [state['orders'][o] for o in truck['queue'] if o in state['orders']]
            loaded = sum(len(o['items_delivered']) for o in queued)
            needed = sum(len(o['items_required']) for o in queued)
            frames.extend([min(255, loaded), min(255, needed)])
    for oid, o in state['orders'].items():
        now = [state['tick'], o['status'], order_seat.get(o['by'], -1)]
        h = history.setdefault(oid, [])
        if not h or h[-1][1:] != now[1:]:
            h.append(now)


recorder = Recorder(state)
capture()
while not state['finished']:
    actions = {}
    for pid, bot in bots.items():
        try:
            actions[pid] = bot.actions(observe(state, pid))
        except Exception as error:      # a bot bug must not stop the recording
            print(f"tick {state['tick']} {pid}: {error!r}", file=sys.stderr)
            actions[pid] = []
    state = step(state, actions)
    recorder.append(actions, state)
    capture()
    if state['tick'] % 100 == 0:
        print('tick', state['tick'], {p['name']: p['score'] for p in state['players'].values()}, flush=True)

feed = from_replay(recorder.data).since(0)
for player in feed['meta']['players']:
    player['look'] = {**LOOKS[player['name']], 'name': 'Grocery Bot'}
feed['meta']['you'] = next(i for i, (_, name, _) in enumerate(SEATS) if name == 'Rush AI')   # whose shop opens as "Your shop"
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'game.json'), 'w') as f:
    json.dump(feed, f, separators=(',', ':'))

rules = state['rules']
orders = {}
for oid, o in state['orders'].items():
    orders[oid] = {
        'items': o['items_required'], 'address': o['address'].get('address') or o['address'].get('id'),
        'placed': o['released_tick'], 'expires': o['expires_tick'], 'deadline': o.get('deadline_tick'),
        'firstLoad': o.get('first_load_tick'), 'ready': o.get('ready_at_tick'),
        'deliveredAt': round(o['delivered_at'] / rules['tick_seconds'], 2) if o.get('delivered_at') is not None else None,
        'satisfaction': o.get('satisfaction'), 'points': o.get('points'), 'reward': o['reward'], 'rushBonus': o.get('rush_bonus'),
        'lateSeconds': o.get('late_seconds'), 'history': history.get(oid, []),
    }
shop = state['shop']
with open(os.path.join(OUT, 'shop.json'), 'w') as f:
    json.dump({'seed': SEED, 'grid': shop['grid'], 'items': [[i['position'][0], i['position'][1], products.index(i['type'])] for i in shop['items']],
               'fixtures': [[i['position'][0], i['position'][1], i.get('fixture', 'shelf')] for i in shop['items']],
               'departments': [{'name': name, 'fixture': fixture, 'x': x, 'cells': [[x, y] for y in ys]}
                               for x, ys, fixture, name, _ in DEPARTMENTS],
               'bays': [b['bay'] for b in shop['bays']], 'loadCells': [b['load_cells'] for b in shop['bays']], 'spawn': shop['spawn'],
               'products': products, 'botsPerPlayer': rules['bots_per_player'], 'trucksPerPlayer': rules['trucks_per_player'],
               'botCapacity': rules['bot_capacity'], 'tickSeconds': rules['tick_seconds'], 'lateStepTicks': rules['late_step_ticks'],
               'lateStepPercent': rules['late_step_percent'], 'seats': len(SEATS), 'frameBytes': rules['bots_per_player'] * 6 + rules['trucks_per_player'] * 2,
               'ticks': state['tick'] + 1, 'truckLoads': truck_loads, 'orders': orders}, f, separators=(',', ':'))
with open(os.path.join(OUT, 'shop.bin'), 'wb') as f:
    f.write(bytes(frames))
print('final', {p['name']: (p['score'], p['delivered']) for p in state['players'].values()}, 'bin', len(frames))
