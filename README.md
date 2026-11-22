# Grocery Bot 3D map preview: Trondheim

A copy of [grocery-bot-3d-hills-preview](https://github.com/BusinessManBab/grocery-bot-3d-hills-preview)
built for **Trondheim** with the steps in [OTHER-CITIES.md](OTHER-CITIES.md):

- Real terrain: the 3D map is draped over an elevation grid of Trondheim (`data/terrain.bin`,
  398 × 463 samples, 0–131 m, relief ×1.22). Roads, buildings, trees, shops, trucks (pitched on
  slopes) and trails follow the ground; the board edge shows the hills in section.
- The full play area and street network, water, Trondheimsfjorden, the Nidelva, the green areas
  and place names from OpenStreetMap (`data/game-map.json`), with 87 of 88 delivery homes matched
  to real building footprints (`data/buildings.json`).
- Cartoon buildings from all 11,876 OSM footprints (`src/buildings3d.js`): OSM building types and
  colours, pitched (gable) roofs on small houses and rectangular blocks, parapet/flat roofs on
  larger ones, window facades, eaves and varied wall/roof colours. Everything is merged into a
  handful of meshes, so the detail costs draw groups rather than draw calls; order homes keep
  their own materials so they still highlight.
- Sea, fjord and river: the fjord stays still, the Nidelva current runs downstream, and no trees
  grow on or next to water.
- Bridges: 14 road crossings of the Nidelva and the fjord arms run on raised decks with railings
  and piers; trucks drive over them. The longest deck is 137 map units (about 150 m), no quay
  turned into a bridge.
- Forests: 2,979 trees (2,302 spruce, 677 birch) planted from Trondheim's mapped woodland
  (Bymarka's edge, Estenstadmarka and the city woods), with fields, built-up land and parks kept
  clear. `src/forest.js` feeds both views, so the 2D map also paints green under the same trees.
- Shop window (bottom right): the v1 grocerybot.no store animation (Erik's `arena.js`, ported
  to `src/shop-iso.js`) showing the robots and trucks inside a shop as the match plays, switched
  by clicking any shop **or any row in Standings**; order card (left) when you click an order
  house.
  - The shop is the v1 store layout: four signed departments from the back wall forward —
    **Dairy** (fridges), **Pantry** (shelves), **Produce** (bins) and **Bakery** (racks) — as
    back-to-back rows around a spine with two-tile aisles, not the engine's round-robin shelves.
    The recorded match really picks milk from the dairy fridges (`tools/simulate_match.py`).
  - The trucks in the bays are the player's own map trucks: `looks.js` `truckArt(look)` with the
    same carriage, cab, visor, decal and colour as the trucks driving that player's routes, plus
    map-style roof faces (flatbed crates for the flatbed look), the rear loading door, cargo and
    order tag.
- The replay is a simulated 600-tick match with the user's rush-ai, recorded from the engine on
  the Trondheim map (`tools/simulate_match.py ... data 7 trondheim`): 5 seats, Rush AI finishes
  with 1,882 points and 41 deliveries against the reference and starter bots.

To make this for another town, follow [OTHER-CITIES.md](OTHER-CITIES.md) (data scripts in
`tools/build_city.py`).

Switch views with the 2D / 3D buttons (or V, or `?view=3d`).

Elevation: Mapzen Terrarium tiles (AWS Open Data). Map data © OpenStreetMap contributors (ODbL).

## Landmarks

Trondheim's trademarks are modelled in `src/landmarks.js` from `tools/landmarks.spec.json`
(baked by `node tools/bake_landmarks.mjs` into `data/landmarks.json` + `data/places.json`, the
"Explore Trondheim" menu):

- **Nidarosdomen** (`nidaros`): its ~150 OpenStreetMap building parts (nave, transepts, choir,
  octagon, chapels, west towers) with their mapped heights and roof shapes, in grey-green soapstone
  under green copper roofs; the central tower's copper spire to 87 m (SNL) with a gilt ball, and the
  8 m rose window with eightfold tracery in the west front between the two west towers. Walls two
  parts share are drawn only where they show above the lower part, so nothing is coplanar.
- **Gamle Bybro** (`bybro`): the timber bridge on three stone piers with red railings and its red
  neo-Gothic portals at both ends ("Lykkens portal").
- **The wharves** (`wharves`): 43 warehouses along the Nidelva at Kjøpmannsgata and Bakklandet on
  their real footprints, in ochre, red, white and brown, gables to the river, on posts at the water.
- **Kristiansten festning** (`ramparts`, `donjon`): stone ramparts with a grass top on the fort's
  outline and the whitewashed four-storey Donjon with its gun slits under a hipped roof.
- **Tyholttårnet** (`tvtower`): the 124 m concrete tower with its dark-glass revolving restaurant at
  70-76.6 m (OSM) and the antenna mast.

All of it is merged into the shared per-material meshes: 4 draw calls in total.

## Loading

The Oslo fast-load engine: `tools/bake_buildings.mjs` writes the compact chunked `data/buildings.bin`
(shared walls kept on one side only, against flicker), `tools/bake_trees.cjs` bakes `data/trees.bin`
(run it where Chromium has a GPU), and the 3D view streams chunk meshes from module workers
nearest-first (`src/city-stream.js`, `src/world-worker.js`). Order: landmarks, buildings, trees.
