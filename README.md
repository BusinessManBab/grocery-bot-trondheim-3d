# Grocery Bot 3D map preview: Trondheim

A copy of [grocery-bot-3d-hills-preview](https://github.com/BusinessManBab/grocery-bot-3d-hills-preview)
built for **Trondheim** with the steps in [OTHER-CITIES.md](OTHER-CITIES.md):

- Real terrain: the 3D map is draped over an elevation grid of Trondheim (`data/terrain.bin`,
  398 × 463 samples, 0–131 m, relief ×1.22). Roads, buildings, trees, shops, trucks (pitched on
  slopes) and trails follow the ground; the board edge shows the hills in section.
- The full play area and street network, water, Trondheimsfjorden, the Nidelva, the green areas
  and place names from OpenStreetMap (`data/game-map.json`), with 87 of 88 delivery homes matched
  to real building footprints (`data/buildings.json`).
- Sea, fjord and river: the fjord stays still, the Nidelva current runs downstream, and no trees
  grow on or next to water.
- Bridges: 14 road crossings of the Nidelva and the fjord arms run on raised decks with railings
  and piers; trucks drive over them. The longest deck is 137 map units (about 150 m), no quay
  turned into a bridge.
- Shop window (bottom right): the v1 grocerybot.no store animation (Erik's `arena.js`, ported
  to `src/shop-iso.js`) showing the robots and trucks inside a shop as the match plays, switched
  by clicking any shop; order card (left) when you click an order house.
  - The shop floor is laid out by department, not round-robin: dairy fridges at the back,
    cheese/eggs/juice beside them, breakfast and baking shelves, pantry shelves, produce bins
    and the bakery rack together, with a sign over every section. The recorded match really
    picks milk from the dairy fridges (`tools/simulate_match.py`).
  - The trucks in the bays are the player's own map trucks: `looks.js` `truckArt(look)`, with
    the same carriage, cab, visor, decal, colour and expression as the trucks driving that
    player's routes, plus the rear loading door, cargo and order tag.
- Forests: 2,979 trees planted from Trondheim's mapped woodland (Bymarka's edge, Estenstadmarka
  and the city woods), with fields, built-up land and parks kept clear.
- The replay is a simulated 600-tick match with the user's rush-ai, recorded from the engine on
  the Trondheim map (`tools/simulate_match.py ... data 7 trondheim`): 5 seats, Rush AI wins with
  4,787 points and 57 deliveries.

To make this for another town, follow [OTHER-CITIES.md](OTHER-CITIES.md) (data scripts in
`tools/build_city.py`).

Switch views with the 2D / 3D buttons (or V, or `?view=3d`).

Elevation: Mapzen Terrarium tiles (AWS Open Data). Map data © OpenStreetMap contributors (ODbL).
