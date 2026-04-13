# BarkWatch Slovenija

**AI-powered bark beetle early warning system for Slovenian forests.**

Built for the Arnes Hackathon 2026 by Korošci+Tilen.

---

## What it does

Slovenia is one of the most forested countries in Europe — around 58% of its land is covered in forest. Bark beetles (*podlubniki*) are a major natural threat that can silently devastate large areas before a forester can respond.

BarkWatch ingests historical forest harvest data (*posek*), feeds it into an offline-trained AI model, and visualises both past activity and future predictions on an interactive map. Foresters, planners, and researchers can:

- Track bark beetle activity at the individual forest sector (*odsek*) level
- Explore a ~20 year time window in the past and 1 year prediction via a time slider
- Drill into any sector and view its full time-series chart
- Switch between real measured data and a synthetic beetle infestation dataset

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│                        Browser                           │
│                                                          │
│  landing.html  ──►  index.html + app.js + styles.css     │
│                          │                               │
│                  MapLibre GL JS (map)                     │
│                  Chart.js (time-series modal)             │
│                  Vanilla JS (UI, state, caching)          │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP REST (GET + JSON)
                         │ Vector tiles (MVT / protobuf)
┌────────────────────────▼─────────────────────────────────┐
│              run_web_server.py  (Python 3 stdlib)         │
│                                                           │
│  HTTPServer on :8000                                      │
│  ├── Static file server  (/, /static/*)                   │
│  ├── REST API  (/api/*)                                   │
│  └── Tile server  (/tiles/*, /gge-tiles/*, ...)           │
│                                                           │
│  In-memory at startup:                                    │
│  ├── odseki.csv  →  metadata dicts + area index          │
│  ├── gge.csv     →  GGE area table                       │
│  ├── heatmap_*.csv  →  bucketed heatmap data             │
│  ├── MBTiles  →  bbox cache (JSON)                       │
│  └── GGE heatmap aggregate (JSON)                        │
└────────────────────────┬─────────────────────────────────┘
                         │ SQLite (MBTiles)
                         │ CSV (metadata + heatmap data)
┌────────────────────────▼─────────────────────────────────┐
│                      data/                               │
│  vector_map_odseki.mbtiles   (89 MB)                     │
│  vector_map_gge.mbtiles      ( 6 MB)                     │
│  vector_map_ggo.mbtiles      ( 2 MB)                     │
│  vector_map_slovenia.mbtiles ( 1 MB)                     │
│  odseki.csv                  (19 MB)                     │
│  heatmap_past_data.csv       ( 9 MB)                     │
│  heatmap_future_predictions.csv (868 KB)                 │
│  heatmap_past_data_synthetic.csv (53 MB)                 │
│  heatmap_future_predictions_synthetic.csv (5 MB)         │
│  gge.csv  •  *.bbox_cache.json  •  *_cache.json          │
└──────────────────────────────────────────────────────────┘
```

---

## Project structure

```
BarkWatch_Arnes-Hackathon-2026_interface/
├── run_web_server.py                # Backend server (single file, ~1 400 lines)
├── static/
│   ├── index.html                   # Main application page
│   ├── landing.html                 # Landing / hero page
│   ├── app.js                       # Frontend logic (~1 700 lines)
│   ├── styles.css                   # Styles + CSS colour variables
│   ├── landing.css                  # Landing page styles
│   ├── logo.png
│   └── logo_transparent.png
├── data/                            # All large files tracked via Git LFS
│   ├── odseki.csv
│   ├── gge.csv
│   ├── heatmap_past_data.csv
│   ├── heatmap_future_predictions.csv
│   ├── heatmap_past_data_synthetic.csv
│   ├── heatmap_future_predictions_synthetic.csv
│   ├── vector_map_odseki.mbtiles
│   ├── vector_map_gge.mbtiles
│   ├── vector_map_ggo.mbtiles
│   ├── vector_map_slovenia.mbtiles
│   ├── vector_map_odseki.bbox_cache.json   # auto-generated at startup
│   ├── gge_heatmap_cache.json              # auto-generated at startup
│   └── gge_heatmap_cache_synthetic.json    # auto-generated at startup
├── notebooks/                       # Exploratory Jupyter notebooks
├── scripts/                         # One-off data processing utilities
├── .gitattributes                   # Git LFS rules (data/**)
└── requirements.txt                 # Empty — stdlib only
```

---

## Running locally

```bash
python3 run_web_server.py
# Open http://localhost:8000
```

No virtual environment or `pip install` needed. The server uses only the Python 3 standard library (`http.server`, `csv`, `json`, `sqlite3`, `pathlib`, etc.).

All large data files are stored in Git LFS. Make sure Git LFS is installed and pulled before first run:

```bash
git lfs install
git lfs pull
```

---

## Backend (run_web_server.py)

### Startup sequence

When the server starts it executes six loading steps before accepting connections:

| Step | Function | What it does |
|------|----------|-------------|
| 1 | `load_odseki_data()` | Parses `odseki.csv` into lookup dicts; computes per-sector area (`POVRSINA_BY_ODSEK`) |
| 2 | `load_gge_area_data()` | Reads `gge.csv`; builds `GGE_AREA[(ggo, gge)] → ha` |
| 3 | `load_heatmap_data()` | Merges past + future CSVs; normalises by area; computes bucket breaks |
| 4 | `load_heatmap_data_synthetic()` | Same for synthetic dataset |
| 5 | `_load_or_build_bbox_index()` | Decodes MBTiles at zoom 11; extracts polygon bounding boxes; writes/reads JSON cache |
| 6 | `_load_or_build_gge_cache()` | Aggregates absolute m³ per (ggo, gge) per month; buckets; writes/reads JSON cache |

### REST API

All endpoints respond with JSON over plain HTTP GET.

| Endpoint | Key parameters | Purpose |
|----------|---------------|---------|
| `GET /api/ggo` | — | List of all 14 GGO names + dropdown options |
| `GET /api/gge/ggo` | `gge` | Resolve GGE name → its GGO |
| `GET /api/odseki/suggest` | `q`, `ggo` | Autocomplete for odsek search (up to 20 results) |
| `GET /api/odseki/by-key` | `ggo`, `odsek` | Sector metadata + bounding box (for map zoom) |
| `GET /api/odseki/{id}` | — | Sector metadata; returns `ambiguous` if multiple GGOs match |
| `GET /api/heatmap/meta` | `dataset` | Available months, forecast boundary, break thresholds |
| `GET /api/heatmap` | `month`, `dataset` | `{odsek_id: bucket}` map for the entire country |
| `GET /api/heatmap/value` | `odsek`, `month`, `ggo`, `dataset` | Single sector value (absolute m³ + relative m³/ha) |
| `GET /api/heatmap/odsek-series` | `odsek`, `ggo`, `dataset` | Full time series for one sector (all months) |
| `GET /api/heatmap/gge` | `month`, `dataset` | `{ggo\x00gge: bucket}` map for GGE-level coloring |
| `GET /tiles/{z}/{x}/{y}` | — | MVT tile — forest sector polygons |
| `GET /gge-tiles/{z}/{x}/{y}` | — | MVT tile — forest unit boundaries |
| `GET /ggo-tiles/{z}/{x}/{y}` | — | MVT tile — forest district boundaries |
| `GET /slo-tiles/{z}/{x}/{y}` | — | MVT tile — Slovenia border |

### Heatmap bucketing

Values are bucketed into 5 levels. The breaks differ between datasets:

| Bucket | Meaning | Colour |
|--------|---------|--------|
| 0 | No data | green |
| 1 | Low | yellow-green |
| 2 | Moderate | yellow |
| 3 | High | orange |
| 4 | Very high | red |

**Real data breaks** (normalised m³/ha/month): `[0.25, 0.7, 2.0]`  
**GGE-level breaks** (area-averaged): `[0.02, 0.03, 0.12]`  
**Synthetic data breaks** (raw m³): `[900, 3000, 9000]`

### Vector tile decoding

The server includes a hand-written Mapbox Vector Tile (protobuf) decoder — no external library. It is used at startup to extract polygon bounding boxes from `vector_map_odseki.mbtiles` (zoom level 11) for the autocomplete zoom-to-sector feature.

---

## Frontend (app.js, index.html, styles.css)

### Libraries

| Library | Version | Use |
|---------|---------|-----|
| [MapLibre GL JS](https://maplibre.org/) | 3.6.2 | Vector map rendering |
| [Chart.js](https://www.chartjs.org/) | 4.4.0 | Sector time-series bar chart |
| ArcGIS World Imagery | CDN raster | Satellite basemap |

No build step, no bundler — everything loads from CDN or is served as static files.

### Map setup

The map is centred on Slovenia (`[14.9955, 46.1512]`, zoom 8) with bounds locked to the country. Four vector tile sources are registered:

| Source | Endpoint | Content |
|--------|----------|---------|
| `odseki` | `/tiles/{z}/{x}/{y}` | Individual forest sectors |
| `gge` | `/gge-tiles/{z}/{x}/{y}` | Forest units |
| `ggo` | `/ggo-tiles/{z}/{x}/{y}` | Forest districts |
| `slovenija` | `/slo-tiles/{z}/{x}/{y}` | Country border |

Layer visibility is zoom-dependent: **GGE fill** is shown when `zoom < 11`; **odsek fill** is shown when `zoom ≥ 11`. This prevents overplotting thousands of small polygons at country scale.

### Heatmap colouring

Colours are defined as CSS variables in `styles.css`:

```css
--color-heatmap-0: #22c55e   /* green   — no data / no alarm */
--color-heatmap-1: #84cc16   /* lime    — low */
--color-heatmap-2: #facc15   /* yellow  — moderate */
--color-heatmap-3: #f97316   /* orange  — high */
--color-heatmap-4: #ef4444   /* red     — very high */
--color-measured:  #2563eb   /* blue    — past (measured) */
--color-forecast:  #f97316   /* orange  — future (prediction) */
```

When the user moves the time slider, `applyMonthColor()`:
1. Fetches `/api/heatmap?month=...` (with LRU client cache, limit 8 months)
2. Builds a MapLibre `match` expression mapping each odsek ID to its colour
3. Applies it via `map.setPaintProperty()` — no page reload, instant re-render

GGE colours are updated in parallel from `/api/heatmap/gge`.

### UI components

```
┌─ Left panel (430 px fixed) ─────────────────────────┐
│  Logo + "BarkWatch Slovenija"                        │
│  GGO dropdown  (custom keyboard-navigable)           │
│  Odsek search  (autocomplete, 20 suggestions max)    │
│  Sector details table                                │
│  Heatmap info card  (m³ and m³/ha for selected month)│
│  "Analyze" button  → opens time-series modal         │
│  Credits footer                                      │
└──────────────────────────────────────────────────────┘
┌─ Map area ───────────────────────────────────────────┐
│  Satellite background + vector tile layers           │
│  Legend panel  (toggleable)                          │
│  Time slider overlay  (bottom centre)                │
│    ├── Prev / Next buttons                           │
│    ├── Month label + measured/forecast indicator     │
│    └── Dataset toggle (real ↔ synthetic)             │
└──────────────────────────────────────────────────────┘
┌─ Analysis modal ─────────────────────────────────────┐
│  Chart.js bar chart — all months for selected sector │
│  Green bars = past data, orange bars = predictions   │
│  Hover tooltips with exact values                    │
└──────────────────────────────────────────────────────┘
```

### Client-side caching

Two LRU caches (keyed by `"dataset:month"`) are kept in memory:
- `heatmapCache` — odsek bucket maps
- `ggeCache` — GGE bucket maps

Both are evicted when size exceeds `HEATMAP_CACHE_LIMIT = 8`. Switching the dataset clears both caches completely.

---

## Data files

### CSV files

#### `odseki.csv` (19 MB, ~42 000 rows)

Forest sector metadata. One row per sector-GGO combination (a sector can appear in more than one district).

| Column | Description |
|--------|-------------|
| `ggo_naziv` | Forest district name (e.g. `CELJE`) |
| `odsek` | Sector ID string (may contain spaces) |
| `povrsina` | Area in hectares |
| `gge_naziv` | Forest unit name |
| `ke_naziv` | Local management unit |
| `revir_naziv` | Forest ranger district |
| `katgozd_naziv` | Forest category |
| `ohranjen_naziv` | Conservation status |
| `relief_naziv` | Terrain type |
| `lega_naziv` | Aspect / exposition |
| `pozar_naziv` | Fire risk class |
| `intgosp_naziv` | Management intensity |
| `krajime` | Locality name |
| `grt1_naziv` | Primary forest habitat type |
| `revirni` | Responsible forester name |
| `eposta` | Forester contact email |

#### `gge.csv` (8 KB)

Simple lookup table: GGE name + GGO code + area in hectares. Used to normalise GGE-level heatmap values.

#### `heatmap_past_data.csv` (8.8 MB)

Historical forest harvest (*posek*) data from the Slovenian Forest Service. Zero-value rows are stripped.

| Column | Description |
|--------|-------------|
| `ggo` | Numeric GGO code (1–14) |
| `odsek_id` | Normalised sector ID (spaces → zeros) |
| `leto_mesec` | Month as `YYYY-MM` |
| `target` | Harvest volume in m³ |

#### `heatmap_future_predictions.csv` (868 KB)

AI-generated predictions. Same schema as past data. The server merges both files at startup; months that exist in both default to the prediction value (controlled by `OVERLAP_PREFER = 'predictions'`).

#### `heatmap_past_data_synthetic.csv` (53 MB) + `heatmap_future_predictions_synthetic.csv` (4.7 MB)

Synthetic beetle infestation dataset — same schema, different units and scale. Accessible via the dataset toggle in the UI.

---

### Vector files (MBTiles)

All vector layers are stored as [MBTiles](https://github.com/mapbox/mbtiles-spec) — SQLite databases containing gzip-compressed Mapbox Vector Tiles. The server reads them directly with `sqlite3` (no GDAL or PostGIS needed).

#### `vector_map_odseki.mbtiles` (89 MB)

The main layer. Contains polygon boundaries for every forest sector in Slovenia.

- **Layer name:** `odseki_map_ggo_gge`
- **Attributes:** `ggo_naziv`, `gge_naziv`, `odsek` (raw string)
- **Zoom range:** 0 – 14
- **Uses:**
  - Rendered as fill + outline on the map (`/tiles/{z}/{x}/{y}`)
  - Parsed at zoom 11 at startup to build the bounding-box index

#### `vector_map_gge.mbtiles` (6.2 MB)

Forest unit (*GGE*) boundaries.

- **Layer name:** `gge_vektor`
- **Uses:**
  - Rendered when zoom < 11
  - GGE heatmap coloring

#### `vector_map_ggo.mbtiles` (2.4 MB)

Forest district (*GGO*) boundaries.

- **Layer name:** `ggo_maps`
- **Uses:** Rendered as a green outline overlay; toggleable from the legend

#### `vector_map_slovenia.mbtiles` (804 KB)

Slovenia national border.

- **Layer name:** `meja_maps`
- **Uses:** Light-blue border overlay; toggleable from the legend

---

### Auto-generated cache files

These files are created on first run and re-created automatically if the version stamp changes.

| File | Version key | Content |
|------|-------------|---------|
| `vector_map_odseki.bbox_cache.json` | `_BBOX_CACHE_VERSION = 5` | `{ggo\x00odsek: [W, S, E, N, odsek_raw]}` |
| `gge_heatmap_cache.json` | `_GGE_CACHE_VERSION = 7` | `{month: {ggo\x00gge: bucket}}` |
| `gge_heatmap_cache_synthetic.json` | same | Same for synthetic dataset |

---

## Geographic hierarchy

```
GGO — Gozdnogospodarsko območje (Forest district)   — 14 total
 └── GGE — Gozdnogospodarska enota (Forest unit)
      └── Odsek (Forest sector)                      — ~42 000 total
```

The 14 GGO districts and their numeric codes:

| Code | Name | Code | Name |
|------|------|------|------|
| 1 | TOLMIN | 8 | NOVO MESTO |
| 2 | BLED | 9 | BREŽICE |
| 3 | KRANJ | 10 | CELJE |
| 4 | LJUBLJANA | 11 | NAZARJE |
| 5 | POSTOJNA | 12 | SLOVENJ GRADEC |
| 6 | KOČEVJE | 13 | MARIBOR |
| 7 | NOVO MESTO | 14 | SEŽANA |

---

## Predictions (ML model)

The machine learning model is **not part of this repository**. It was trained offline on the historical harvest CSV and its predictions were exported to `heatmap_future_predictions.csv`. The server treats predictions exactly like measured data — the only distinction is that months beyond `FORECAST_START_MONTH` are flagged as forecast in the API response and shown in orange in the UI.

---

## Design decisions

| Decision | Reason |
|----------|--------|
| Pure Python stdlib HTTP server | Zero dependency installation; works anywhere Python 3 is present |
| MBTiles + custom protobuf decoder | Self-contained vector tiles without a tile server or GDAL |
| All data loaded into memory at startup | Sub-millisecond API responses; no query latency |
| Pre-computed bbox and GGE caches | Avoids re-decoding MBTiles on every request |
| Two independent datasets (real + synthetic) | Real posek data for historical analysis; synthetic for beetle-specific demo |
| CSS variables for all heatmap colours | Single source of truth; easy to retheme |
| LRU client-side cache for heatmap tiles | Eliminates redundant requests when scrubbing the slider back and forth |
| Zoom-based layer switching (GGE ↔ odsek at zoom 11) | Keeps the map readable at country scale |
| Vanilla JS + MapLibre + Chart.js only | No build toolchain; instant page load |
| Git LFS for `data/**` | Keeps the Git history light; large binaries stay out of packfiles |
