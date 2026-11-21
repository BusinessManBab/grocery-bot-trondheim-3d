# Making the 2D/3D hills map for another town

This repo shows one Grocery Bot game on the Kongsberg map, in 2D (the live game page) and 3D
(real terrain, real buildings, a flowing river). It also has a shop window, which shows the robots
inside a shop, and an order card, which shows what a clicked order contains. Nothing in the page code is specific to
Kongsberg: everything town-specific lives in `data/`. To do another town, you swap in that town's
data files and publish a copy of the repo.

Tested so far: Kongsberg end to end, and Molde end to end (published at
https://businessmanbab.github.io/grocery-bot-molde-3d/ — 84 of 90 delivery homes matched a real
building, terrain 0–443 m, shop window with the player's own map trucks and a department layout).
Oslo's data files build with these steps (89 of 90 delivery homes matched a real building, terrain
0–102 m), but no Oslo page has been published yet, because there is no Oslo replay (see step 2).

---

## What goes in `data/`

| File | What it is | Where it comes from |
|---|---|---|
| `game-map.json` | The town's flat map: bounds, roads, water, green areas, delivery homes, labels | The game repo's town pipeline (step 1) |
| `game.json` | One finished game played **on that same map** | The game server's `/api/games/CODE?since=0` (step 2) |
| `buildings.json` | OSM building footprints, with each delivery home matched to its real building | `tools/build_city.py buildings` |
| `terrain.bin` + `terrain.json` | Elevation grid over the map bounds | `tools/build_city.py terrain` |
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
- [ ] The shop window opens on "Your shop", switches when you click another shop, closes with ×
      and comes back when you click a shop
- [ ] In the shop window, robots carry and load items, trucks back in and drive off, and truck
      tags fill up as the replay plays
- [ ] Roads cross rivers on raised bridges with railings, and the road surface shows on the deck
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
  - **The store:** the same floor, walls, red bay markings and Grocery Bot sign, with fridges
    (dairy, juice), produce bins, bread racks and shelves. The v1 departments are gone because
    the v2 shop mixes products, so each shelf gets the fixture of its product.
  - **The robots:** Grocery Bots in the player's own look (shape, colour, eyes). They walk tile to
    tile, look the way they last moved, hop when they pick, carry what they picked in their basket,
    and cheer when they load it into a truck.
  - **The trucks:** the v1 trucks in the player's colour. Each backs into its bay when it comes
    home, with hazard lights, and drives off with its door closing when it leaves. The tag above it
    has one square per queued item, filled as robots load it (`+N` past 10 items), and the loaded
    goods show inside the cargo box.
  - **The footer:** counts working robots, orders being packed, and trucks home or out.
  - **The standings** shrink to fit above the window (`--shop-h`).
- **Its title:** "Your shop" for the viewer's own seat (`meta.you` in `game.json`), otherwise
  "<name>'s shop".
- **Switching and closing:** clicking any shop on the map, in 2D or 3D, switches the window to
  that shop. × closes it, and clicking any shop brings it back.
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

## Planned changes (not built or deployed yet)

These are agreed requirements for the next version of the map. None of them is live on the
preview yet. Each lists what it should do, how to build it, and how to check it.

### 1. Buildings with real-world detail, without making the 3D view lag

**Goal:** buildings should look like real buildings (roof shapes, windows, varied colours),
like the town in real life. Detail must never cost smoothness: the 3D view has to stay at about
60 fps on an ordinary laptop with the whole town in view.

**How:**
- **Roofs:** small houses (OSM `house`, `detached`, `semidetached_house`, `terrace`, or any building
  up to about 2 storeys) with a roughly rectangular footprint get a **pitched (gable) roof**:
  - the ridge runs along the longest side, at about 30–40° (typical for Norway);
  - small eaves overhang;
  - a gable triangle closes each end.

  "Roughly rectangular" means the footprint fills at least ~85% of its oriented bounding
  rectangle. Larger blocks keep flat roofs. Use OSM `roof:shape` when it is mapped.
- **Windows:** one small shared, repeating **facade texture** (a window bay about 3.4 m wide and a
  storey high) on all walls. The UVs are distance along the wall ÷ bay width, and height above the
  ground ÷ storey height. There is no geometry per window.
- **Colours:** muted, varied **wall and roof colours** as vertex colours. Walls are pale (white,
  cream, light ochre, light grey) and roofs dark (slate grey, brown-red). Use OSM `building:colour`
  and `roof:colour` when mapped, toned down to the map palette. Context buildings must stay paler
  than the order homes, so highlighted orders still stand out.
- **Keep the draw calls:** all context buildings remain **one merged mesh**, so the detail adds
  vertices and one texture, not draw calls. Order homes keep their own materials (they change
  colour) but get the same roofs and windows.
- **Budget:** at most ~650k vertices for all buildings (today ~425k), and no per-frame work for
  buildings.
- If a town is much denser than Kongsberg, drop windows on buildings smaller than ~40 m², or use
  flat roofs beyond a distance from the camera.

**Check:** measure fps with the whole town in view before and after (the screenshot script logs
`fps-test`). It must not drop. Roofs should meet the walls without gaps on slopes, and the order
homes must still be easy to spot.

### 2. The shop window uses the same trucks that drive on the map

**Goal:** the trucks parked at the bays in the shop window are the player's own trucks, with the
same carriage, cab, visor, decal and colour as that player's trucks on the 2D and 3D map (from
`looks.js`). Not the generic v1 truck.

**How:**
- In `src/shop-iso.js`, draw the player's side-view truck art (`truckArt(look)` from `looks.js`,
  the same art the map uses) on the visible side of the isometric truck with an affine transform:
  - svg x −74 (rear) … 70 (cab) runs along the truck's length, u = 0 … −3.1 cells;
  - svg y 38 is the ground;
  - height scales by about 0.344, so the 90-unit-tall art matches the v1 truck's 31-unit cargo box.
- Add roof faces in the look's colours (shell, canvas cloth or flatbed wood; the cab in the
  player's colour).
- Keep the parts that show what is loaded: the rolling rear door, the goods inside, and the order
  tag above the truck.
- When the window switches shop, it switches truck look too (`setPlayer`).

**Check:** for each of the five looks, the docked trucks in the shop window match the trucks
driving that player's routes on the map.

### 3. Clicking a player in the standings opens their shop window

**Goal:** clicking a player's row in **Standings** also shows that player's shop in the bottom
right ("Your shop" for your own row, "<name>'s shop" otherwise). It reopens the window if it was
closed. It works the same in 2D and 3D, and on phones.

**How:** in `src/game-view.js`, the standings row click already focuses that player's fleet
(`play.focus`). It should also call `panels.showShop(player.seat)`. Clicking the same row again
clears the fleet focus as today, but leaves the shop window on that player. Use × to close it.

**Check:** clicking each row switches the shop window and its title. Clicking a shop on the map,
and the status link in the order card, still work.

### 4. A realistic shop: groceries where they belong

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
| x 7, upper | Cheese, eggs and juice | fridge | cheese, eggs, juice |
| x 7, lower | Breakfast | shelf | cereal, oats |
| x 11, upper | Pantry | shelf | pasta, rice, pasta |
| x 11, lower | Baking | shelf | flour, sugar |
| x 15, upper | Vegetables | bin | lettuce, tomatoes, peppers |
| x 15, lower | Bakery | rack | bread, bread |
| x 19, upper | Fruit | bin | apples, bananas, bananas |
| x 19, lower | Vegetables | bin | carrots, onions |

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
