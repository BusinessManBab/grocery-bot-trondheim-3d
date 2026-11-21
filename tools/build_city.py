"""Build the data files the 2D/3D map preview needs for one town.

    python3 tools/build_city.py buildings --map data/game-map.json [--osm cache.json]
    python3 tools/build_city.py terrain   --map data/game-map.json [--tiles dir] [--step 8]
    python3 tools/build_city.py replay    --game game.json [--names "A,B,C"]
    python3 tools/build_city.py landcover --map data/game-map.json [--osm cache.json]

All coordinates are [lon, lat] * 1e5 integers, like game-map.json. Outputs go to --out (default data/).

buildings  OSM building footprints in the map bounds (one Overpass query, cached with --osm),
           matched to every delivery address in game-map.json "homes" -> data/buildings.json
terrain    Terrarium elevation tiles (AWS Open Data, no key) sampled to a grid over the bounds
           -> data/terrain.bin (Uint16 decimetres above the lowest point) + data/terrain.json
landcover  OSM forest/wood (trees) and fields, meadows, residential, industrial... (no trees) in the
           bounds -> data/landcover.json, which the 3D view uses to plant forests
replay     a finished game from /api/games/CODE?since=0 -> data/game.json, player names replaced

Needs Python 3.9+; terrain also needs Pillow (pip install pillow).
Map data (c) OpenStreetMap contributors (ODbL). Elevation: Mapzen Terrarium tiles.
"""
import argparse
import array
import json
import math
import os
import urllib.parse
import urllib.request

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]   # tried in turn
USER_AGENT = "map-build-script"
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
BOT_NAMES = ["Kale Storm", "Oat Runner", "Rush AI", "Cheddar Dash", "Plum Pusher", "Milk Rocket", "Pasta Pilot",
             "Yogurt Yeti", "Turbo Turnip", "Rye Rider"]
HEIGHTS = {'apartments': 13, 'commercial': 10, 'retail': 8, 'industrial': 9, 'warehouse': 9, 'church': 16, 'school': 11,
           'office': 13, 'hospital': 15, 'garage': 3, 'garages': 3, 'shed': 3, 'hut': 3, 'cabin': 4, 'roof': 4,
           'house': 7, 'detached': 7, 'semidetached_house': 7, 'terrace': 8, 'residential': 8}


def load(path):
    with open(path) as f:
        return json.load(f)


def save(path, data):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))


# ---- buildings --------------------------------------------------------------------------
def height(tags):
    for key, scale, add in (('height', 1, 0), ('building:levels', 3, 1)):
        try:
            if key in tags:
                return max(3, min(40, float(tags[key].split()[0]) * scale + add))
        except ValueError:
            pass
    return HEIGHTS.get(tags.get('building'), 6)


def inside(pt, ring):
    x, y = pt
    c = False
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i], ring[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
    return c


def edge_distance(pt, ring, sq):
    best = 1e18
    for i in range(len(ring)):
        (ax, ay), (bx, by) = ring[i - 1], ring[i]
        ax, bx, px = ax * sq, bx * sq, pt[0] * sq
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(ax + t * dx - px, ay + t * dy - pt[1]))
    return best


def overpass(query):
    """Overpass is often busy (429/502/504): try each server a few times before giving up."""
    import time
    last = None
    for attempt in range(3):
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, urllib.parse.urlencode({'data': query}).encode(), {'User-Agent': USER_AGENT})
                return json.loads(urllib.request.urlopen(req, timeout=180).read())
            except Exception as error:     # noqa: BLE001 - report the last one
                last = error
                print(f'  {url}: {error}; trying again')
        time.sleep(20 * (attempt + 1))
    raise SystemExit(f'Overpass did not answer: {last}')


def buildings(args):
    town = load(args.map)
    x0, y0, x1, y1 = town['bounds']
    sq = math.cos(math.radians((y0 + y1) / 2 / 1e5))
    if args.osm and os.path.exists(args.osm):
        osm = load(args.osm)
    else:
        box = f"{y0 / 1e5},{x0 / 1e5},{y1 / 1e5},{x1 / 1e5}"
        query = f'[out:json][timeout:120];way["building"]({box});out geom;'
        osm = overpass(query)
        if args.osm:
            save(args.osm, osm)
    blds = []
    for e in osm['elements']:
        g = e.get('geometry')
        if not g or len(g) < 4:
            continue
        ring = [(round(p['lon'] * 1e5), round(p['lat'] * 1e5)) for p in g]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            blds.append({'ring': ring, 'h': height(e.get('tags', {})), 'c': (cx, cy)})
    homes, used = [], set()
    for h in town['homes']:
        near = [i for i, b in enumerate(blds) if abs(b['c'][0] - h[0]) < 120 and abs(b['c'][1] - h[1]) < 70]
        hit = next((i for i in near if inside(h, blds[i]['ring'])), None)
        if hit is None and near:
            i = min(near, key=lambda i: edge_distance(h, blds[i]['ring'], sq))
            if edge_distance(h, blds[i]['ring'], sq) < 25:
                hit = i
        if hit is not None and hit not in used:
            used.add(hit)
            homes.append({'p': h, 'ring': blds[hit]['ring'], 'h': min(blds[hit]['h'], 14)})
        else:   # no mapped footprint: a 10 x 9 m house at the address
            hx, hy = 5 / 1.11 / sq, 4.5 / 1.11
            homes.append({'p': h, 'h': 7, 'generic': True, 'ring': [(round(h[0] - hx), round(h[1] - hy)), (round(h[0] + hx), round(h[1] - hy)),
                                                                   (round(h[0] + hx), round(h[1] + hy)), (round(h[0] - hx), round(h[1] + hy))]})
    flat = lambda ring: [c for p in ring for c in p]
    save(os.path.join(args.out, 'buildings.json'), {
        'attribution': 'Buildings: OpenStreetMap contributors (ODbL)',
        'homes': [{'p': h['p'], 'h': round(h['h']), 'ring': flat(h['ring'])} for h in homes],
        'buildings': [[round(b['h'])] + flat(b['ring']) for i, b in enumerate(blds) if i not in used]})
    matched = sum(1 for h in homes if not h.get('generic'))
    print(f"{len(blds)} buildings; {matched} of {len(homes)} homes matched to a real footprint")


# ---- landcover ----------------------------------------------------------------------------
WOOD = {'forest', 'wood', 'scrub'}
OPEN = {'farmland', 'meadow', 'grass', 'residential', 'industrial', 'commercial', 'retail', 'cemetery', 'allotments', 'orchard',
        'construction', 'railway', 'heath', 'grassland', 'bare_rock', 'wetland'}


def rings_of(element):
    if element['type'] == 'way':
        return [[(round(p['lon'] * 1e5), round(p['lat'] * 1e5)) for p in element.get('geometry', [])]]
    parts = [[(round(p['lon'] * 1e5), round(p['lat'] * 1e5)) for p in m['geometry']] for m in element.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
    out = []
    while parts:
        ring = parts.pop()
        grown = True
        while ring[0] != ring[-1] and grown:
            grown = False
            for i, part in enumerate(parts):
                if part[0] == ring[-1]:
                    ring += part[1:]
                elif part[-1] == ring[-1]:
                    ring += part[-2::-1]
                else:
                    continue
                parts.pop(i)
                grown = True
                break
        out.append(ring)
    return out


def thin(ring, step=4):
    """Drop points closer than `step` (about 4 m) to the last kept one."""
    kept = [ring[0]]
    for p in ring[1:]:
        if abs(p[0] - kept[-1][0]) + abs(p[1] - kept[-1][1]) >= step:
            kept.append(p)
    return kept


def landcover(args):
    town = load(args.map)
    x0, y0, x1, y1 = town['bounds']
    if args.osm and os.path.exists(args.osm):
        osm = load(args.osm)
    else:
        box = f"{y0 / 1e5},{x0 / 1e5},{y1 / 1e5},{x1 / 1e5}"
        kinds = '|'.join(sorted(WOOD | OPEN))
        osm = overpass(f'[out:json][timeout:120];(way["landuse"~"^({kinds})$"]({box});way["natural"~"^({kinds})$"]({box});'
                       f'relation["landuse"~"^({kinds})$"]({box});relation["natural"~"^({kinds})$"]({box}););out geom;')
        if args.osm:
            save(args.osm, osm)
    out = {'attribution': 'Land cover: OpenStreetMap contributors (ODbL)', 'wood': [], 'open': []}
    for e in osm['elements']:
        tags = e.get('tags', {})
        kind = tags.get('landuse') or tags.get('natural')
        target = 'wood' if kind in WOOD else 'open' if kind in OPEN else None
        if not target:
            continue
        for ring in rings_of(e):
            ring = thin(ring)
            if len(ring) >= 4:
                out[target].append([c for p in ring for c in p])
    save(os.path.join(args.out, 'landcover.json'), out)
    print(f"{len(out['wood'])} wooded areas, {len(out['open'])} open areas (fields, meadows, built-up land)")


# ---- terrain ----------------------------------------------------------------------------
def terrain(args):
    from PIL import Image
    town = load(args.map)
    b0, b1, b2, b3 = town['bounds']
    z, n = 15, 2 ** 15
    sq = math.cos(math.radians((b1 + b3) / 2 / 1e5))
    tiles = args.tiles or '.cache/tiles'
    os.makedirs(tiles, exist_ok=True)
    cache = {}

    def pixel(lon, lat):
        return ((lon + 180) / 360 * n * 256, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256)

    def raw(ix, iy):
        tx, ty = ix // 256, iy // 256
        if (tx, ty) not in cache:
            path = os.path.join(tiles, f'{z}_{tx}_{ty}.png')
            if not os.path.exists(path):
                urllib.request.urlretrieve(TERRARIUM.format(z=z, x=tx, y=ty), path)
            cache[(tx, ty)] = Image.open(path).convert('RGB').load()
        r, g, b = cache[(tx, ty)][ix % 256, iy % 256]
        return r * 256 + g + b / 256 - 32768

    def elevation(lon, lat):
        x, y = pixel(lon, lat)
        x, y = x - .5, y - .5
        ix, iy = math.floor(x), math.floor(y)
        fx, fy = x - ix, y - iy
        h = (raw(ix, iy) * (1 - fx) * (1 - fy) + raw(ix + 1, iy) * fx * (1 - fy) + raw(ix, iy + 1) * (1 - fx) * fy + raw(ix + 1, iy + 1) * fx * fy)
        return max(0.0, h)      # Terrarium has seabed depths under the sea; the sea surface is 0 m

    cols = int(round((b2 - b0) * sq / args.step)) + 1
    rows = int(round((b3 - b1) / args.step)) + 1
    grid = [elevation((b0 + c * (b2 - b0) / (cols - 1)) / 1e5, (b3 - r * (b3 - b1) / (rows - 1)) / 1e5)
            for r in range(rows) for c in range(cols)]          # row 0 north, column 0 west
    lo, hi = min(grid), max(grid)
    with open(os.path.join(args.out, 'terrain.bin'), 'wb') as f:
        f.write(array.array('H', [round((v - lo) * 10) for v in grid]).tobytes())
    save(os.path.join(args.out, 'terrain.json'), {'cols': cols, 'rows': rows, 'base': round(lo, 1), 'top': round(hi, 1), 'unit': 'decimetre',
                                                   'source': 'Mapzen Terrarium tiles (AWS Open Data), z15', 'order': 'row-major, north row first, west column first'})
    print(f"{cols} x {rows} grid, {lo:.0f} m to {hi:.0f} m ({hi - lo:.0f} m of relief)")


# ---- replay -----------------------------------------------------------------------------
def replay(args):
    game = load(args.game)
    if not game.get('finished') or 'meta' not in game:
        raise SystemExit('not a finished game: download /api/games/CODE?since=0 after the game ends')
    names = [s.strip() for s in args.names.split(',')] if args.names else BOT_NAMES
    for i, player in enumerate(game['meta']['players']):
        player['name'] = names[i % len(names)]
        player['id'] = 'seat-%d' % i
    game['meta']['code'] = 'PREVIEW'
    save(os.path.join(args.out, 'game.json'), game)
    print(f"{len(game['meta']['players'])} players, {len(game['frames'])} frames")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('step_name', choices=['buildings', 'terrain', 'replay', 'landcover'])
    parser.add_argument('--map', default='data/game-map.json')
    parser.add_argument('--game')
    parser.add_argument('--names', help='comma-separated names, in seat order')
    parser.add_argument('--osm', help='cache file for the Overpass answer')
    parser.add_argument('--tiles', help='folder to keep elevation tiles in (default .cache/tiles, not published)')
    parser.add_argument('--step', type=float, default=8, help='terrain grid spacing in map units (~1.1 m each)')
    parser.add_argument('--out', default='data')
    args = parser.parse_args()
    {'buildings': buildings, 'terrain': terrain, 'replay': replay, 'landcover': landcover}[args.step_name](args)


if __name__ == '__main__':
    main()
