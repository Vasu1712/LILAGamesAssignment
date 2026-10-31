# Architecture

## What I built it with, and why

| Layer | Choice | Why |
|---|---|---|
| Data prep | Python script (`pyarrow` + `pandas`) run once, offline | The dataset is small and fixed (89k rows). Parsing parquet in the browser would mean shipping a WASM reader (DuckDB-WASM ≈ 6 MB) to do work that only needs doing once. |
| Data format | One columnar JSON file per map (+ `index.json`) | Column arrays (`p, t, x, y, h, e`) gzip to 0.6 MB total and decode straight into typed arrays. Loading a map means one request, after which every filter runs locally with no round trips. |
| Frontend | React + TypeScript + Vite | React handles the sidebar and filter state. TypeScript keeps the pipeline↔frontend contract (event codes, field names) explicit. |
| Rendering | One 2D `<canvas>`, no chart library | Aggregate view draws ~800 paths and ~15k markers every playback frame. Canvas does that easily, where SVG/DOM would choke. Pan and zoom are a single transform. |
| Hosting | Static files (Vercel / Netlify / GitHub Pages) | No server means nothing to keep alive and no env vars. A link just works. |

## Data flow

```
player_data/February_*/{user}_{match}.nakama-0   (parquet, 1,243 files)
        │  pipeline/build_data.py
        │   1. read each file; cast ts to its raw int64; decode event bytes -> str
        │   2. drop the one file duplicated across two day folders; drop exact duplicate movement rows
        │   3. classify each journey human/bot from telemetry; flag id/telemetry disagreements
        │   4. world (x, z) -> minimap pixels; time -> seconds since match start
        │   5. per match: duration, players, event counts; per player: outcome (survived / killed by bot / storm…)
        ▼
web/public/data/{Map}.json  + index.json        web/public/minimaps/{Map}.webp (2048², ~180 KB each)
        │  fetch once per map -> decode to Float32Array/Int32Array, index rows per player
        ▼
React state (map, days, match, humans/bots, markers, heatmap, time cursor)
        │  derived: player mask -> paths, markers, counts, heat grid (128², 3-pass box blur)
        ▼
<canvas>: minimap → heatmap → paths (world space) → markers + playheads (screen space)
```

## Coordinate mapping

The README gives each map a `scale` and `origin` (AmbroseValley 900 / (-370, -473), GrandRift 581 / (-290, -290), Lockdown 1000 / (-500, -500)). I convert in two steps:

1. **World → UV:** `u = (x − originX) / scale`, `v = (z − originZ) / scale`. Only `x` and `z` are used. `y` is elevation. I keep it for the tooltip, but it plays no part in placement.
2. **UV → pixels in a fixed 1024 × 1024 map space:** `px = u · 1024`, `py = (1 − v) · 1024`. The flip is needed because world +z points "north" (up), while image rows grow downward.

The pipeline bakes `px, py` into the JSON, and the canvas draws the minimap image stretched to exactly 1024 × 1024 world units. Every layer then shares one coordinate space, and zoom/pan is a single `setTransform`. Two details matter:

- **The shipped images are not 1024².** AmbroseValley is 4320², Lockdown 9000², and GrandRift is 2160 × 2158 (not square). The formula is defined in UV, so I resample every image to a square and draw it into the 1024 space. Pixel size never enters the maths.
- **Verification:** a unit test reproduces the README's worked example (−301.45, −355.55 → pixel 78, 890). Before building the UI, I also plotted all 89k points on each minimap. Paths follow roads, bridges and building interiors, and nothing lands in the sea or off-map (all UVs fall within 0.05–0.95). The cursor readout runs the inverse transform, so a designer can read world coordinates off any spot.

## Assumptions and data quirks

| What I ran into | How I handled it |
|---|---|
| `ts` is typed `timestamp[ms]` and reads as Jan 1970, but the integers are **Unix seconds** (1770681535 = 2026-02-10). Read as ms, matches would last 0.4 s. | Cast to int64 and treat it as seconds. Matches then last 13 s–15 min (median ≈ 6 min), positions are sampled every ~5 s, and dates line up with the folder names. Match time is shown relative to the match's first event. |
| `event` is bytes | Decoded to UTF-8. Unknown values would be counted and dropped (there are none). |
| The README's bot rule is "numeric user_id". But **17 journeys** with numeric ids (e.g. `1429`, `1379`) emit human telemetry (`Position`, `Loot`). They are the only "player" in matches otherwise full of bot files, so they look like internal/QA accounts. | Human/bot is decided by **telemetry** (`Position` → human, `BotPosition` → bot), with the id rule as a fallback. These journeys are drawn as humans and tagged `id?` in the player list. |
| One journey file (match `ac049b28…`) appears in both `February_10` and `February_11`, because the match crossed midnight. | Loaded once. A match is assigned to the earliest folder it appears in. |
| 147 exact duplicate movement rows; ~2.3k identical `Loot` rows (same player, second and spot) | Duplicate movement rows are dropped. Identical loot rows are kept, because picking up several items in one second is a real behaviour. |
| Bot event semantics from a bot's point of view (`BotKilled` in a bot file = the bot died) | Markers are grouped as PvP (human↔human) and PvE (a bot involved). Tooltip wording depends on the actor ("Killed by a bot" vs "Bot was killed"). A kill is drawn at the killer's position, a death at the victim's. |
| Most matches contain **one human and no bot telemetry files** (743 of 796 matches have a single file). | The tool doesn't assume full lobbies. Bot paths appear only where bot files exist (53 matches). |
| Feb 14 is a partial day; day folders are roughly UTC days | Labelled "Feb 14 *" with a tooltip. Times are shown in UTC. |
| Outcome of a human journey | The last death event decides the outcome. No death means "survived / extracted" (there is no extraction event). |

## Trade-offs

| Decision | Considered | Chose, because |
|---|---|---|
| Pre-process vs parse in browser | DuckDB-WASM / parquet-wasm in the client | **Pre-process.** It's a 6 MB smaller bundle and faster first paint, and data quirks get fixed in one tested place. Cost: new data needs a script run. |
| One file per map vs one per match | Lazy per-match JSON (796 files) | **Per map.** Aggregate views and heatmaps need every match anyway, and 0.4 MB gzipped is cheap. Per-match files would make "all matches" slow. |
| Canvas vs SVG / Leaflet / deck.gl | Leaflet image overlay; deck.gl | **Plain canvas.** The map is a single image, not tiles. Canvas easily handles 60k points per frame without a 300 KB+ dependency. deck.gl would be the next step if data grew 100×. |
| Heatmap in client vs pre-baked PNGs | Static heat images per map/type | **Client-side 128² grid.** It recomputes in a few ms, so it can follow every filter, including humans-only and the playback time. |
| Kill/death position | Use victim position for both | **Each event's own row.** Kill = where the killer stood, death = where the victim fell, which is what the telemetry records. |
| Classification by id vs telemetry | README id rule only | **Telemetry, id as fallback**, with the disagreement surfaced in the UI instead of hidden. |
