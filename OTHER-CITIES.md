# Making the 2D/3D hills map for another town

This repo shows one Grocery Bot game on the Kongsberg map, in 2D (the live game page) and 3D
(real terrain, real buildings, forests, bridges and a flowing river). It also has a shop window,
which shows the robots inside a shop, and an order card, which shows what a clicked order
contains. Nothing in the page code is specific to Kongsberg: everything town-specific lives in
`data/`. To do another town, you swap in that town's data files and publish a copy of the repo.

**What's on the map:**
- terrain from real elevation data (see Steps 4 and "Settings");
- real buildings in a **cartoon style that follows what each building really is** (house,
  apartments, shop, industrial, garage, church), with each order's house highlighted (Step 3 and
  "Cartoon buildings");
- **forests on empty land and mapped woodland, with green under them on the 2D map**
  (Step 4b and "Forests");
- bridges over the water ("Bridges");
- river streaks showing the current ("How the river direction is worked out");
- the shop window and the order card ("Shop window and order card").

Agreed but not built yet: see "Planned changes".

**Updates:**
- **2026-11-21, guide:** new section "The 3D map's style" (map layers, roads, lighting, 3D shops,
  3D trucks, order-house highlights, sizing, camera, labels and clicks). "Planned changes" marked
  as built.
- **2026-11-21, shop like the v1 store:** the shop window's floor now copies the v1 grocerybot.no
  store:
  - four departments from the back wall to the robots' door, each a double row of fixtures back
    to back around a spine, the shop's full depth with one cross aisle: **DAIRY** (fridges: milk,
    yogurt, cream, butter, cheese, eggs, juice), **PANTRY** (shelves: pasta, rice, flour, sugar,
    oats, cereal), **PRODUCE** (bins: apples, bananas, tomatoes, carrots, onions, peppers,
    lettuce), **BAKERY** (racks: bread);
  - one sign per department, and the same products side by side;
  - two-tile aisles so 20 robots don't jam.

  The match was recorded again. Plum Pusher's trucks (and every cab and carriage) now get roof
  faces that follow their real shape: flatbed crates instead of one floating slab, and the
  slanted and nose cabs get their own roof shapes and light bar.
- **2026-11-21, shop window:**
  - clicking a player in the Standings opens their shop window;
  - the shop window's trucks are each player's own trucks, the same as on the map;
  - the shop is laid out like a real store: dairy and drinks fridges at the back, pantry and
    breakfast shelves in the middle, the bakery and fruit and vegetable bins by the door, with
    department signs;
  - a new match was recorded with that layout.

  Details under "Shop window and order card" and "Planned changes" 2–4 (now done).
- **2026-11-21, cartoon buildings:** every building, order homes included, is styled from its OSM
  type:
  - houses get steep pitched roofs (gabled or hipped) with thick eaves, a chimney, a front door
    and framed windows on wooden cladding;
  - apartment blocks get window rows with balconies, a flat roof with a rim and a rooftop box;
  - shops and offices get big shop windows and a sign band;
  - industrial buildings get corrugated walls;
  - garages and sheds get garage doors and low roofs;
  - the church gets a tower and spire.

  The town totals 624k vertices and about 5 draw calls, and runs at the same 58–60 fps as
  before. Method in "Cartoon buildings". The buildings data step now also writes each building's
  OSM type and roof/colour tags.
- **2026-11-21, trees:** about 18,300 forest trees (spruce and birch) on OSM forest and woodland,
  and on empty land more than ~35 m from buildings. Fields, built-up land, parks, roads and water
  stay clear. Green is painted under every tree on the 2D map and the 3D ground, so wooded areas
  show in 2D too. Still 60 fps. New data step: `build_city.py landcover`. Details in "Forests".
- **2026-11-21:** bridges; the shop window uses the v1 store animation and is bigger; order card;
  realistic-shop and other planned changes written up.

Tested so far: Kongsberg end to end. Oslo's data files build with these steps (89 of 90
delivery homes matched a real building, terrain 0–102 m), but no Oslo page has been published
yet, because there is no Oslo replay (see step 2).

---

## What goes in `data/`

| File | What it is | Where it comes from |
|---|---|---|
| `game-map.json` | The town's flat map: bounds, roads, water, green areas, delivery homes, labels | The game repo's town pipeline (step 1) |
| `game.json` | One finished game played **on that same map** | The game server's `/api/games/CODE?since=0` (step 2) |
| `buildings.json` | OSM building footprints, with each delivery home matched to its real building, plus each building's OSM type, `roof:shape`, `building:colour` and `roof:colour` (for the cartoon style) | `tools/build_city.py buildings` |
| `terrain.bin` + `terrain.json` | Elevation grid over the map bounds | `tools/build_city.py terrain` |
| `landcover.json` | OSM forest and woodland (trees go here) and fields, meadows and built-up land (no trees). Optional: without it there is no forest | `tools/build_city.py landcover` |
| `shop.json` + `shop.bin` | Inside the shops: robot positions, what they carry, truck loading; every order's items, address and timeline. Optional: without them the page simply has no shop window or order card | The full engine replay of the same game (see "Shop window and order card") |

Everything else (`index.html`, `src/`, `static/`, `assets/`) stays as it is.

You need Python 3.9+ and Pillow (`pip install pillow`) for the terrain step, `git`, and the `gh2`
GitHub login (account BusinessManBab) to publish.

---

## Steps

`T` is the town id, the same id the game repo uses (`oslo`, `bergen`, `trondheim`, …).

### 0. Copy this repo

```sh
git clone https://github.com/BusinessManBab/grocery-bot-3d-hills-preview.git grocery-bot-T-3d
cd grocery-bot-T-3d
git remote remove origin
```

### 1. The town's map: `data/game-map.json`

Each town in `astar-as/grocery-bot` lives in `prototypes/town-rush/public/data/towns/T/`.
Its flat map, `game-map.json`, is built by `tools/build-town-game-map.py`. See
`prototypes/town-rush/NEW_TOWN_GUIDE.md`, step 8. If the town branch already has it, copy it out:

```sh
git -C /path/to/grocery-bot show origin/town/T:prototypes/town-rush/public/data/towns/T/game-map.json > data/game-map.json
```

On 2026-11-21, `town/oslo` had one. The other town branches (bergen, bodo, molde, tromso,
trondheim, grimstad) still had to run `build-town-game-map.py --town T --fetch` first.

A per-town `game-map.json` carries the town's `name` and `labels`. The page uses them
automatically: the name goes under "Grocery Bot Town" at the top left and in the tab title, and the
labels become the place names on the map. Kongsberg's file has neither, so it falls back to
`src/game-map-labels.js`.

### 2. A replay on that map: `data/game.json`

The page plays a stored game. It must be played on **this** town's map, because shop positions and
order addresses come from the game and must line up with the map.

1. Get a finished game in the public feed format. Open `https://<server>/api/games/CODE?since=0`
   after the game has ended and save it as `game.json`. It has `finished: true`, `meta`
   (players, shops, looks) and one frame per tick.
2. Replace the players' real names before publishing (the page is public):

   ```sh
   python3 tools/build_city.py replay --game ~/Downloads/game.json
   # or choose the names, in seat order:
   python3 tools/build_city.py replay --game ~/Downloads/game.json --names "Rush AI,Kale Storm,Oat Runner"
   ```

**Known gap (2026-11-21):** v2.grocerybot.no only runs Kongsberg, and no branch has both the
other towns (`public/data/towns/T/`) and the public feed (`engine/feed.py`, which serves
`/api/games`). The town branches were cut before the feed existed. To get a replay for another
town, either wait until that town runs on the live site, or merge the town folder into a branch
that has the feed (`codex/town-rush-launch-fixes` matches live). Then run a game locally
(`python3 -m gameserver`) and save `http://localhost:<port>/api/games/CODE?since=0`.

### 3. Buildings: `data/buildings.json`

```sh
python3 tools/build_city.py buildings --osm .cache/osm-buildings.json
```

This makes one Overpass query for every `building=*` way in the map bounds. The answer is cached
in the `--osm` file, so later runs work offline and give the same result. The script retries and
falls back to a second Overpass server, because the main one often answers 429/502 when busy.

It prints how many delivery homes matched a real footprint. A home matches a building that
contains its address, or failing that, the nearest building edge within about 25 m. Homes with
no match become a plain 10 × 9 m house. Kongsberg matched 79 of 83 and Oslo 89 of 90. If far
fewer match, the `homes` in `game-map.json` are probably not on buildings (for example, road
points); check them before going on.

Heights come from OSM `height` or `building:levels` when present, else a typical height for
the building type. In the 3D view, buildings near a shop are left out so the shop model is not
buried in the real store.

### 4. Terrain: `data/terrain.bin` + `data/terrain.json`

```sh
python3 tools/build_city.py terrain
```

This downloads Terrarium elevation tiles (AWS Open Data, free, no key; zoom 15, about 5 m per
pixel) into `.cache/tiles/` (git-ignored) and samples a grid every 8 map units (about 9 m) over
the bounds. It prints the height range: Kongsberg is 123–352 m and Oslo 0–102 m.

The tiles have seabed depths under the sea. The script clamps everything below 0 m to 0 m, so the
sea surface stays flat.

### 4b. Land cover for the forest: `data/landcover.json`

```sh
python3 tools/build_city.py landcover --osm .cache/osm-landcover.json
```

This makes one Overpass query (cached like the buildings one) for these areas in the map bounds:
- **Trees:** `landuse=forest`, `natural=wood`/`scrub`.
- **Never trees:** fields, meadows, grass, residential, industrial, commercial and retail land,
  cemeteries, railways, wetland and bare rock.

Kongsberg has 21 wooded and 48 open areas.

### 5. Bump the cache version

GitHub Pages' CDN serves old JavaScript for up to 10 minutes. Raise `?v=N` everywhere it appears:

```sh
grep -rn "v=[0-9]" index.html src/game-view.js     # then raise N in both places
```

### 6. Look at it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000/ and http://localhost:8000/?view=3d
```

Use a computer with a real graphics card (any normal laptop or desktop is fine). On a server
without a GPU, WebGL falls back to software rendering, which is very slow. For headless
screenshots, rent a cheap GPU box (a GTX 1660 on vast.ai is about $0.05/h). Use Chromium flags
`--use-gl=angle --use-angle=gl-egl` and the `mcr.microsoft.com/playwright:v1.49.0-jammy` image.

Things to check (see the next section for what to change):

- [ ] 2D: the map, shops, trucks and orders look like the live game page
- [ ] 3D overview: the board shows the whole map, and the hills read at the default tilt
- [ ] Every shop stands on the ground and is not buried in buildings
- [ ] Order houses turn the claiming player's colour (open orders are cream and brown)
- [ ] No trees in water
- [ ] River streaks run downstream, and the sea or lakes have none
- [ ] Place labels are in the right spots
- [ ] Phone width: the 2D/3D switch does not cover anything important
- [ ] The shop window opens on "Your shop", switches when you click another shop or a standings
      row, closes with × and comes back when you click a shop or a row
- [ ] The shop window's trucks look like that player's trucks on the map
- [ ] The shop window shows the v1 store layout: DAIRY, PANTRY, PRODUCE, BAKERY double rows from
      the back wall, one sign each, the same products side by side
- [ ] Every look's trucks look clean in the shop window (check flatbed, slanted and nose cabs)
- [ ] In the shop window, robots carry and load items, trucks back in and drive off, and truck
      tags fill up as the replay plays
- [ ] Roads cross rivers on raised bridges with railings, and the road surface shows on the deck
- [ ] Buildings look like what they are (pitched-roof houses with chimneys and doors, apartment
      blocks with balconies, flat-roofed shops and sheds, church with a spire), and 3D fps is unchanged
- [ ] The empty hillsides around town are forest in 3D, with green under them on the 2D map
      (and on the 3D ground). Fields, town, parks, roads and water have no forest trees
- [ ] Clicking an order house opens the order card with the right items, times and happiness

### 7. Publish

```sh
git add -A
git commit -m "T: 2D/3D hills map"
gh2 repo create BusinessManBab/grocery-bot-T-3d --public --source . --push
gh2 api -X POST repos/BusinessManBab/grocery-bot-T-3d/pages -f 'source[branch]=main' -f 'source[path]=/'
# about a minute later: https://businessmanbab.github.io/grocery-bot-T-3d/
```

---

## Shop window and order card

**What players see:**
- **Shop window (bottom right):** opens when the map loads, about 540 px wide on desktop
  (`min(540px, 42vw)`) and full width on phones. It is the **v1 grocerybot.no homepage
  animation**, Erik's isometric store from `public/static/arena.js` on `main`, ported to
  `src/shop-iso.js`. It is driven by the recorded match instead of the homepage's canned replay,
  so it shows what is really happening in that shop at that tick:
  - **The store:** the same floor, walls, red bay markings and Grocery Bot sign, laid out like a
    real grocery store, with red department signs as on the v1 homepage:
    - four departments from the back wall to the robots' door, as in the v1 store: **Dairy**
      (fridges), **Pantry** (shelves), **Produce** (bins), **Bakery** (bread racks);
    - each department is a double row of fixtures back to back around a spine, across the
      shop's depth with one cross aisle, and one sign over it;
    - the same products sit next to each other.

    Fixtures and signs come from the shop layout (`shop.json` → `departments`, `fixtures`). See
    "A realistic shop" under "Planned changes".
  - **The robots:** Grocery Bots in the player's own look (shape, colour, eyes). They walk tile to
    tile, look the way they last moved, hop when they pick, carry what they picked in their basket,
    and cheer when they load it into a truck.
  - **The trucks:** each player's **own trucks, exactly as on the map**. The side of each truck
    is the same `looks.js` truck art the 2D and 3D map trucks use (carriage, cab, visor, decal,
    colour), with roof faces in the look's colours. Each backs into its bay when it comes
    home, with hazard lights, and drives off with its door closing when it leaves. The tag above it
    has one square per queued item, filled as robots load it (`+N` past 10 items), and the loaded
    goods show inside the cargo box.
  - **The footer:** counts working robots, orders being packed, and trucks home or out.
  - **The standings** shrink to fit above the window (`--shop-h`).
- **Its title:** "Your shop" for the viewer's own seat (`meta.you` in `game.json`), otherwise
  "<name>'s shop".
- **Switching and closing:** clicking any shop on the map (2D or 3D), or **any player in the
  Standings**, switches the window to that shop. A standings click also focuses that player's
  fleet, as before. × closes the window, and clicking any shop or standings row brings it back.
- **Order card (left):** clicking a house with an order opens it. It shows the order number and
  street address, its status (open; claimed and being picked, loaded or ready; on the way;
  delivered; expired), the items, when it was ordered and how long ago (game clock, like the
  HUD), when it is due or how late it is, the customer's happiness (100% on time, 5% off per
  late step, as the engine scores it) and the points.
- **Card details:** the status line links to that shop's window. The clicked house is
  highlighted (a ring in 2D, a bigger pin and a pulsing glow in 3D). Esc or × closes the card.

**Where the data comes from:**

The public feed (`/api/games/CODE`) only has truck positions, scores and order status, so the
panels need the **full engine replay** of the same game. `tools/simulate_match.py` plays a whole
match with the real engine and writes `game.json`, `shop.json` and `shop.bin` together, so all
three match:

```sh
# ENGINE_DIR: prototypes/town-rush of a grocery-bot checkout (codex/town-rush-launch-fixes matches live)
python3 tools/simulate_match.py /path/to/grocery-bot/prototypes/town-rush /path/to/rush-ai data 7
```

That is how this preview was made: your `rush-ai` bot (in-process, the same code the CLI runs)
against two reference and two starter bots, seed 7, about 30 seconds of CPU. To change the line-up,
names or looks, edit `SEATS` and `LOOKS` at the top of the script.

For a real game instead of a simulated one, `shop.json` and `shop.bin` can be built from that
game's full replay (`/api/rooms/CODE/replay`, format `grocerybot-replay-v1`). It holds every
player's view per tick, including the robots. On 2026-11-21 that endpoint answered 500 on the live
site for the ranked game I tried, which is why this preview uses a simulated match.

**For another town:** the engine on `codex/town-rush-launch-fixes` only knows Kongsberg. For
another town, run the script against a branch whose engine can load that town (the multi-town
layout), and pass the town's map to `create_match(map_data=...)`. The script does not take a town
option yet.

**Formats** (also documented at the top of `tools/simulate_match.py`):

- `shop.json`:
  - the floor: `grid {width, height, walls}`; `items [[x, y, product index]]` (shelf cells);
    `bays [[x, y]]`; `loadCells`; `spawn`; `products`
  - the departments: `departments [{name, x, y, fixture}]` (one per shelf block, at its first
    cell) and `fixtures {"x,y": fridge|shelf|bin|rack}`. Both are optional; without them the
    window guesses a fixture from each product.
  - the rules the card uses: `botsPerPlayer`, `trucksPerPlayer`, `tickSeconds`, `lateStepTicks`,
    `lateStepPercent`
  - the binary layout: `seats`, `ticks`, `frameBytes`
  - `orders {id: {items, address, placed, expires, deadline, firstLoad, ready, deliveredAt,
    satisfaction, points, reward, rushBonus, history [[tick, status, seat]]}}`
- `shop.json` → `truckLoads[seat][truck]`: `[[tick, item indexes, "0110"]]`, written whenever the
  items queued on that truck, or which of them are loaded, change. It fills the truck tags.
  Truck arrivals and departures come from the public feed's truck states (home = idle, picking,
  loading or ready).
- `shop.bin`: for each tick (0 = before the first move), for each seat in feed order, the robots
  as `[x, y, action (0 wait, 1 move, 2 pick, 3 load), item1, item2, item3]` (item = product index
  + 1, 0 = empty), then the trucks as `[items loaded, items needed]` for the orders queued on
  that truck. 130 bytes per seat per tick with 20 robots and 5 trucks, about 390 kB for 5 seats
  and 600 ticks.

**For the live game page:** the same panels need the server to send this data. The smallest change
is a second feed next to `/api/games/CODE` (e.g. `/api/games/CODE/shops?since=N`) carrying these
frames and the order details, plus `meta.you` from the signed-in account. During a live game it
should only show what rivals can already see, or only start once the game is over, because
showing rivals' robots, claims and items live would leak strategy.

## Planned changes (all four now built)

These started as agreed requirements written before building them. All four have since been built
on the preview; each says how, then keeps the original spec for reference.

### 1. Buildings with real-world detail, without making the 3D view lag: done

Built on 2026-11-21 as the cartoon buildings; see "Cartoon buildings" below.

### 2. The shop window uses the same trucks that drive on the map: done

Built on 2026-11-21. In `src/shop-iso.js`, `truckMarkup` draws the player's side-view truck art
(`truckArt(look)` from `looks.js`, the art the map trucks use) on the visible side of the isometric
truck with an affine transform:
- svg x −74 (rear) … 70 (cab) runs along the truck, u = 0 … −3.1 cells;
- svg y 38 is the ground;
- height scales by 0.344.

Roof faces follow each look's real shape:
- cab roofs only where each cab is flat (`CAB_ROOFS`: flat, high, nose with its lower hood,
  slanted), in the player's colour, plus a dark bar for the `lights` visor;
- box and cooler carriages get a white roof (the cooler also its unit on top), canvas carriages a
  cloth roof;
- flatbeds get the wooden bed with each crate's top in its colour, lowest first.

The first version used one flat slab for every cab and covered flatbeds, which looked scuffed on
Plum Pusher's slanted, flatbed truck. The rolling rear door, the loaded goods and the order tag are kept.
`setPlayer` switches the art when the window switches shop. Checked against the map for every
look: plum canvas with dots, yellow cooler with the nose cab, black flatbed with roof lights, and
so on.

### 3. Clicking a player in the standings opens their shop window: done

Built on 2026-11-21. The standings row click in `src/game-view.js` focuses the fleet as before
and calls `panels.showShop(player.seat)`. The window switches to that player ("Your shop" on your
own row) and reopens if it was closed. Checked for all five rows.

### 4. A realistic shop: groceries where they belong: done in the preview (v1 store layout)

Built in the preview on 2026-11-21 and then changed to copy the v1 grocerybot.no store (the
reference image).

**Layout:** `tools/simulate_match.py` replaces the engine's `make_shop` with `realistic_shop`. It
keeps the engine's grid, truck bays, loading cells and robot start cell, and builds the shelves
from `DEPARTMENTS`:

| Department | Fixture | Shelf columns (spine) | Products, in order |
|---|---|---|---|
| Dairy | fridge | x 2 and 4 (3) | milk, yogurt, cream, butter, cheese, eggs, juice |
| Pantry | shelf | x 7 and 9 (8) | pasta, rice, flour, sugar, oats, cereal |
| Produce | bin | x 12 and 14 (13) | apples, bananas, tomatoes, carrots, onions, peppers, lettuce |
| Bakery | rack | x 17 and 19 (18) | bread |

- **Rows:** y 3–5 and 7–9, so row 6 is the cross aisle and rows 1–2 stay free for the loading
  bays.
- **Aisles:** two tiles wide between departments (x 5–6, 10–11, 15–16, 20–21), plus x 1 on the
  left.
- **Products:** each department fills its left column top to bottom, then its right column. Each
  product gets a run of neighbouring cells (12 cells shared out, the first products one extra),
  48 shelf cells in all.
- **Spines:** wall cells. The engine and every bot (reference, starter and rush-ai) already treat
  walls as obstacles, so nothing else changes.
- **Size:** the table is drawn for the 23 × 12 shop (5 trucks). The script stops with a message
  for another size.

**Shop window:** `shop.json` → `departments` and `fixtures` give each shelf its fixture. Spines get
their neighbours' height in the plain spine colour, and each department gets one sign centred over
its double row, as in the v1 `arena.js`.

**Effect on the game:** in this recorded match (seed 7) every team scores less than with the
engine's shelves. The reference bots score 3,557 and 3,156. Rush AI scores 1,528 from 40
deliveries, the same delivery count but with lateness and missed-order penalties, because its
tuning assumes the old shop with shelves close together. A single-tile aisle between Dairy and
Pantry was worse (robots jammed), hence the two-tile aisles. Retune bots before using this layout
in the real game.

**Real game:** it still uses the round-robin shelves, and changing it needs the approval below.

The original proposal follows. It was replaced by the layout above.

**Goal:** the shop floor should look and work like a real grocery store. Products of a kind
belong together in departments with the right fixtures: milk and dairy in the fridges at the
back, fruit and vegetables in bins near the entrance, bread on the bakery rack, dry goods on
shelves in the middle aisles. Not vegetables scattered everywhere.

**Why it looks wrong today:** the engine's `make_shop` (`engine/shop.py`) deals the products out
round-robin, column by column (`products[len(items) % len(products)]`). So the 25 shelf cells mix
milk, bread, apples, pasta and so on. The shop window draws exactly what the engine has, so the
fix belongs in the layout itself, not only in the drawing. Otherwise robots would be seen taking
milk from the bread rack.

**Proposed layout** for the current 23 × 12 shop:
- **Grid:** shelf columns at x = 3, 7, 11, 15, 19. Each column has an upper block (y = 3–5, 3 cells)
  and a lower block (y = 7–8, 2 cells), 25 cells in all.
- **Doors:** the robots' start cell (21, 10, bottom right) is the entrance, and the truck bays are
  along the top wall.
- **Products:** all 21 in the game, with the most-ordered ones twice.

| Block | Department | Fixture | Products |
|---|---|---|---|
| x 3, upper | Dairy | fridge | milk, milk, yogurt |
| x 3, lower | Dairy | fridge | cream, butter |
| x 7, upper | Dairy | fridge | cheese, eggs, milk |
| x 7, lower | Drinks | fridge | juice, juice |
| x 11, upper | Pantry | shelf | pasta, rice, sugar |
| x 11, lower | Breakfast | shelf | cereal, oats |
| x 15, upper | Bakery | rack | bread, bread, flour |
| x 15, lower | Vegetables | bin | carrots, onions |
| x 19, upper | Fruit | bin | apples, bananas, tomatoes |
| x 19, lower | Vegetables | bin | peppers, lettuce |

(A first build used this single-column layout; it was replaced by the v1 store layout above.)

Dairy is at the back, far from the entrance, as in real stores. Fruit, vegetables and bread are
next to it.

**How:**
- **In the game (`astar-as/grocery-bot`):** change `make_shop` to place products by department
  from a table like this instead of round-robin.
  - Return `departments: [{name, x, y, fixture}]` and a fixture per shelf cell in the shop
    layout. The v1 `arena.js` already draws department signs and fixtures from these.
  - Keep the rest as is: the same shelf cells, a cell per product, every product reachable from an
    aisle, and the same layout for every player (fairness).
  - If a difficulty uses fewer product types, skip the missing ones and keep the departments
    together.
  - This is a game-rule change. It changes walking distances, bot strategies and the replay
    fixtures (`tests/fixtures/ai-demo.json` and state hashes), so it needs approval
    (`NEEDS_APPROVAL.md`), an engine version bump, and a note to players that the shop layout
    changed.
- **In this preview:** record a new match with the realistic layout so the robots really pick
  milk from the dairy fridges. In `tools/simulate_match.py`, replace `engine.simulation.make_shop`
  with a version that uses the table above before `create_match`. Write the departments and
  fixtures into `shop.json`. Then `src/shop-iso.js` should take fixtures and department signs from
  `shop.json` instead of guessing a fixture from each product (`FIXTURE_OF`).
- **Order card:** the item list can group items by department, in the order a robot would walk
  the shop.

**Check:** in the shop window, each department is together under its sign: milk only in the
dairy fridges, fruit and vegetables only in the bins, bread only on the rack. Robots carrying
milk have just come from the dairy fridges. Run the game's tests and a benchmark after the engine
change, and compare walking distance per order with the old layout.

## Settings you may want to change per town

All of these are constants in `src/view3d.js`; search for the name.

| Name | Now | What it does | When to change it |
|---|---|---|---|
| `RELIEF` | `1.25` | Hills this many times steeper than real life | Flat towns: raise to 1.5–2 so the hills show. Steep fjord towns (Bergen, Tromsø): 1.0 |
| `LIFT` | `1.3` | Buildings this many times taller than real life | Rarely |
| `TILT` | `0.74` | Default camera tilt from straight down (radians, about 42°) | Steep towns can look better a little lower (0.85) |
| `PLAZA` | `100` | Buildings and trees within this many units (about 110 m) of a shop are left out | Raise it if a shop is still buried; lower it in dense centres |
| `SHOP_SCALE`, `TRUCK_SCALE` | `2.4`, `0.9` | How big shops and trucks are compared with the map (they are exaggerated, like in 2D) | Much smaller or larger play areas |
| `STREAKS` | flowing cells ÷ 6, max 1400 | How many current streaks are drawn on rivers | Very wide rivers |
| `cells.length < 120` | | Water areas smaller than this (about 5,000 m²) get no current | Small streams that should move |
| `SEA` | 2 m above sea level | Water lower than this is the sea or a fjord: still, and where rivers end | Rarely |
| `PALETTE`, `STYLE_OF`, `BAY` (`src/buildings3d.js`) | | Cartoon building colours, which OSM type gets which style, window spacing | Towns with a different building tradition (brick, stucco, colourful wooden rows) |
| `FOREST_STEP` (`src/forest.js`) | `11` | Spacing of candidate forest trees (about 12 m); fewer trees when larger | Bigger or more wooded towns, to keep fps |
| `FOREST_MAX` (`src/forest.js`) | `22000` | Most forest trees planted | Raise only after checking fps |
| Building distance in `plantForest` | `32` units (~35 m) | Empty land closer than this to a building gets no forest | Spread-out villages (lower) or dense towns (higher) |

## The 3D map's style

How the 3D view (`src/view3d.js`, three.js 0.170) keeps the 2D map's look and adds depth. Read
this first when restyling, then the sections below for buildings, forests and bridges.

**Map layers keep their 2D colours.**
- **Ground:** the 2D map's paper (`#f0e9d8`), park green (`#c9d8ac`) and water (`#86b8c5`) are
  painted once into a canvas texture, up to 4,096 px on the long side. The texture is draped over
  the terrain grid as a lit mesh, so slopes shade themselves while flat ground stays its 2D colour.
- **Roads:** the same five strokes as the 2D map, as flat ribbons with round joins, laid in
  2D order (lane, street casing, major casing, street, major). Half widths in map units: lane 2.2,
  street 7.5/5, major 11/8.2. They're cut into ~6-unit pieces so they follow the ground. They
  don't write depth and use polygon offset, so they lie on the terrain without flicker
  (`renderOrder` 2–6, after the ground at 1).
- **Board edge:** a skirt drops from the terrain's edge to a flat base 26 units down, so the map's
  borders read as the edge of a board (`SLAB`).
- **Lighting:** a hemisphere light plus a sun (`SUN_DIR`), set so flat ground comes out at its 2D
  colour. The sun's shadow map follows the camera target, sized to the view, so shadows stay sharp.
  A soft fog in the page colour fades the far edge, and dusk is the 2D dark overlay drawn over the
  3D view.

**Shops** (`buildShop`) are the 2D shop drawing as a little building:
- cream walls with brown corner posts and plinth, a band in the player's colour, and an 8-tile
  striped awning;
- a window and a door, and the red GROCERY BOT sign on two posts;
- a deep footing so it can stand on a slope (it rests on its highest corner);
- buildings and trees within `PLAZA` are cleared so the real store's footprint doesn't bury it.

**Trucks** (`buildTruck`) are the player's `looks.js` truck art as a model:
- the cab's and carriage's exact SVG silhouettes are extruded (SVGLoader);
- decals are thin boxes and discs on both sides;
- the bot's face from `looks.js` is a texture on both doors, with the visor (shade brim, light
  bar or tint), bumper, headlamps and wheels added;
- they turn smoothly to their heading, tilt nose up or down on slopes and bridge ramps (`roadY`),
  and bounce slightly while driving;
- trails behind them are ribbons on the ground that fade over 7 ticks, as in 2D.

**Order houses:** each delivery address's real building (cartoon style), coloured by order state:
- **Colours:** cream walls with a brown roof while open; the claiming player's colour (lighter
  walls, full-colour roof) once claimed; faded when another player is focused.
- **Glow:** a soft disc in that colour draped over the ground around the house.
- **Pin:** the 2D order square on a stem, floating above the roof and always about 24 px tall on
  screen. It doesn't hide behind buildings and bobs gently.
- **Selected:** a clicked order's pin grows 1.5× and its glow pulses.
- **Delivered:** shows the 2D "+points" pop at the house.

**Sizes, like 2D sprites.** Shops and trucks are exaggerated, as on the 2D map (`SHOP_SCALE` 2.4,
`TRUCK_SCALE` 0.9 at the fit zoom). They scale with their own distance to the camera, as
`(distance / fit distance)^0.65` clamped to 0.16–1.25. So they grow more slowly than the map when
you zoom in, and a truck close to a low camera doesn't fill the screen.

**Camera and hand-over.**
- **Default:** tilted 42° (`TILT`), north up, framing the same box as the 2D `fit()`. The
  projection centre is shifted into the free area between the panels (`setViewOffset`).
- **Controls:** drag to pan, right-drag or two fingers to tilt and turn, double-click to fly
  home. The orbit point rides on the ground, and the camera never goes below the hills.
- **Switching views:** 2D → 3D starts straight down over the same spot and zoom and tilts in over
  1.2 s; 3D → 2D keeps the spot and zoom.

**Labels and clicks.** Place labels, shop name pills, parked-truck dots and "+points" pops are
drawn on the 2D overlay canvas at projected 3D positions, in the 2D map's own styles. Clicks use
screen-space hit areas (`picks`) that both views fill each frame: shops and order houses, with
orders winning over a shop next to them.

## Cartoon buildings

**Goal:** every building, order homes included, gets a cartoon style that reflects what it looks
like in real life, with enough detail not to look like blocks and not so much that the 3D view
lags. The code is `src/buildings3d.js` (`createBuildings`); `src/view3d.js` uses it for the town and
the order homes.

**1. Decide what the building is.** `tools/build_city.py buildings` stores each footprint's OSM
`building` type, plus `roof:shape`, `building:colour` and `roof:colour` (in `buildings.json` →
`info`, parallel to `buildings`, and `homes[].info`). Each type maps to a style (`STYLE_OF`):

| Style | OSM types (examples) | Look |
|---|---|---|
| house | house, detached, semidetached_house, terrace, cabin, residential | steep pitched roof, chimney, front door, framed cross windows on wooden cladding |
| apt | apartments, dormitory, hotel | flat roof with a rim, rows of wide windows with balconies, rooftop box |
| com | retail, commercial, office, school, kindergarten, civic, kiosk | big shop windows, a sign band; small ones get a pitched roof |
| ind | industrial, warehouse, service, barn | corrugated walls, a high strip window, flat roof with a rim |
| shed | garage, garages, shed, carport | low pitched roof, a garage door every bay |
| church | church, chapel, cathedral | very steep roof, white walls, a tower with a dark spire |

Untyped buildings (`yes`) are guessed from size and height: small and low is a house, tall is
apartments, big and low is industrial, the rest commercial. Kongsberg is well typed (3,055 houses,
2,769 garages, 461 terraced houses, 266 apartment blocks…). Roof shapes and colours are rarely
mapped. When they are, they win: `roof:shape=flat` forces a flat roof, `hipped` a hipped one,
and OSM colours are mixed half-and-half with the style palette so they stay in the map's look.

**2. Roof.** The footprint's oriented rectangle is measured along its longest edge.
- **Pitched roof:** if the style wants one and the footprint is roughly rectangular (fills at
  least 80% of that rectangle, under 22 m wide):
  - the ridge runs along the long side, with a cartoon-steep pitch (rise = 0.78 × half the width;
    1.05 for churches, 0.45 for sheds);
  - the eaves overhang 0.55 m and have a thick dark fascia;
  - about one house in four with a near-square plan gets a hipped roof, the rest gabled;
  - gable ends are wall triangles under the roof.
- **Flat roof:** anything else gets a flat roof with a 0.55 m parapet rim, plus a rooftop box on
  blocks over 380 m².
- **Walls:** they go up to the eaves (62% of the OSM height for pitched roofs, the full height for
  flat ones), starting below the lowest corner on slopes.

**3. Windows and wall detail, without geometry.** Each style has one 128 × 128 canvas texture:
one window bay by one storey, repeating.
- **Mapping:** u = metres along the wall ÷ bay width (4.2 m for houses, 3.4 m apartments, 6 m
  shops and industrial, 3 m sheds), v = height above the ground ÷ storey height (3 m × the
  building lift).
- **Drawing:** frames, glass with a cartoon glint, cladding lines, balconies, sign bands, garage
  doors and corrugation are drawn into the texture.
- **Colour:** the wall colour comes from vertex colours, divided by the texture's grey base, so
  plain wall shows the true colour and the white frames come out lighter.

**4. A few chunky details as geometry**, only where they add character:
- a front door with a white lintel on the longest wall of houses, the church and some apartment
  blocks, facing away from the building's centre;
- a brick or grey chimney on four houses in five;
- the church tower and spire;
- the parapets and rooftop boxes.

Buildings under about 30 m² (most garages and sheds) skip the fascia, parapet and door.

**5. Colours.** Muted pastel walls and darker roofs per style (`PALETTE`), in the spirit of
Norwegian towns: cream, pale yellow, white, barn red, pale grey-blue walls; slate, black,
brown-red and terracotta roofs. A building's colours come from a hash of its index, so they stay
the same between visits. The town stays paler than a highlighted order house.

**6. Keep it cheap.**
- **Draw calls:** the whole town is merged into one geometry per facade style plus one for roofs
  and trim, about 6 draw calls.
- **Vertices:** each merged geometry is indexed (`mergeVertices`), so the corners of each flat
  face are shared: Kongsberg's 8,456 buildings plus 83 homes come to **624k vertices**.
- **Order homes:** they use the same builder but keep their own geometry and materials. Walls and
  roof are built white (`plain`), so the home's materials can turn them the claiming player's
  colour. Doors and chimneys keep their colours.
- **Measured** on the same GPU: 58.7 fps in 3D with the cartoon buildings, against 58.0 before. Keep
  the town under ~650k building vertices.
- **For a denser town:** drop the door and chimney below a bigger area, or skip windows on the
  smallest buildings, before adding more geometry.

**Check:** houses have pitched roofs and chimneys, blocks have flat roofs with rims, the church has
its spire, roofs meet the walls on slopes, highlighted order houses still stand out, and fps in 3D
matches the version before.

## Forests

The land the map leaves empty around a town (hillsides, slopes, the edge of the map) is usually
forest in real life, especially in Norway. The map plants it, and both views show the same
forest.

- **Where trees go** (`src/forest.js`, `plantForest`):
  - wherever OSM maps forest or woodland (`data/landcover.json`);
  - on empty land that is more than ~35 m from any building and not in a field, meadow,
    residential, industrial or other open area, park, road, water or shop plaza.

  Candidates sit on a jittered grid every 11 units (about 12 m). About 85% of mapped woodland
  spots and 70% of empty-land spots get a tree, seeded so it looks the same on every visit and in
  both views. Kongsberg has about 18,300 forest trees.
- **2D:** green (the map's park green, `#c9d8ac`) under every tree, a round blob per tree that
  merges into woodland (`forestPath`). This shows on the 2D map and on the 3D ground.
- **3D:** about 78% spruce (a cone on a short trunk) and 22% birch (a rounded crown), in muted
  greens, slightly varied in size, height and rotation, standing on the terrain. Park trees are
  separate and stay where they were.
- **Cost:** all forest trees are two instanced meshes (spruce and birch) of about 20 triangles a
  tree, so 18,000 trees are four draw calls plus their shadows. `FOREST_MAX` (22,000) caps it.
  For bigger or more wooded towns, raise `FOREST_STEP` instead of letting the count grow, and
  check fps.
- **Other towns:** run the `landcover` step. The page plants the forest without code changes. In
  a town where the empty land is really farmland or bare mountain, OSM's open areas keep it clear.
  If OSM is sparse there, add a rule, such as no trees above the tree line, using `terrain.json`
  heights.

## Bridges

Where a road crosses water it runs on a bridge, found automatically in `src/view3d.js` (look for
"bridges"):

- **Finding them:** each road line is sampled every 3 units against the water grid. A run of water
  samples between 10 and 320 units long becomes a straight deck from just before the water to just
  after it.
- **Height:** the deck keeps the bank heights at its two ends but stays at least about 5.5 m above
  the lowest water under it. It ramps onto the banks over `RAMP` (26 units).
- **Two carriageways:** a road drawn as two lines becomes one wider deck.
- **The structure:** a pale slab, a railing with posts on each side, and one pier per ~45 units of
  span, down to the water. That's deliberately small, nothing grand.
- **Riding on it:** roads, trucks and their trails all use `roadY()`, the ground or the deck,
  whichever is higher. So trucks drive over the bridge and tilt up and down the ramps.
- **Kongsberg:** 6 bridges. Only crossings that are in the game's road network get one, so
  footbridges that aren't roads in the game stay unbridged.

For another town nothing needs changing, as long as its `game-map.json` has water polygons and
the roads that cross them. Check the bridges in the 3D view: with lots of quays, lower the 320-unit
cap so a road running along the water's edge isn't turned into a long "bridge".

## How the river direction is worked out

The water areas in `game-map.json` are turned into a grid of 6-unit cells. Each connected
stretch of water gets an outlet:

- the sea, if the stretch touches water at sea level (coastal towns);
- otherwise its lowest cell on the map's edge;
- otherwise its lowest cell.

A distance-from-outlet value spreads back up the water from there. Following it downhill gives a
direction in every cell, including side streams, and smoothing makes it bend with the banks. The
streaks move faster where the ground drops along the current, as at rapids and waterfalls.

This needs the river to be one connected water area. If OSM splits a river at bridges, each piece
flows to its own lowest point, which is normally still downstream. For Kongsberg, every flowing
cell points south (downstream), as Numedalslågen does. Check the direction for each new town: in
the browser console, `groceryView.world3d.flowAt(x, z)` returns `[dx, dz, speed]` at a map point.
`groceryView.toWorld(lon * 1e5, lat * 1e5)` turns a map coordinate into `x, z`. +z is south and
+x is east.

## Sources and credits

- Roads, water, green areas, buildings: © OpenStreetMap contributors, ODbL. Keep the credit line
  on the page.
- Elevation: Mapzen Terrarium tiles on AWS Open Data.
- Delivery homes, shops and the replay: the Grocery Bot game data for that town.
