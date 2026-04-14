# BarkWatch Slovenija

Built for the Arnes Hackathon 2026 by Korošci+Tilen.

---

## What it does

Slovenia is one of the most forested countries in Europe — around 58% of its land is covered in forest. Bark beetles (*podlubniki*) are a major natural threat that can silently devastate large areas before a forester can respond.

BarkWatch ingests historical forest harvest data (*posek*), feeds it into an offline-trained AI model, and visualises both past activity and future predictions on an interactive map. Foresters, planners, and researchers can:

- Track bark beetle activity at the individual forest sector (*odsek*) level
- Explore a ~20 year time window in the past and 1 year prediction via a time slider
- Drill into any sector and view its full time-series chart

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│                        Browser                           │
│                                                          │
│          index.html + app.js + styles.css                │
│                          │                               │
│                  MapLibre GL JS (map)                    │
│                  Chart.js (time-series modal)            │
│                  Vanilla JS (UI, state, caching)         │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP REST (GET + JSON)
                         │ Vector tiles (MVT / protobuf)
┌────────────────────────▼─────────────────────────────────┐
│                 server.py  (Python 3 stdlib)             │
│                                                          │
│  HTTPServer on :8000                                     │
│  ├── Static file server  (/, /static/*)                  │
│  ├── REST API  (/api/*)                                  │
│  └── Tile server  (/tiles/*, /gge-tiles/*, ...)          │
│                                                          │
│  In-memory at startup:                                   │
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
│  vector_map_odseki.mbtiles                               │
│  vector_map_gge.mbtiles                                  │
│  vector_map_ggo.mbtiles                                  │
│  vector_map_slovenia.mbtiles                             │
│  odseki.csv                                              │
│  heatmap_past_data.csv                                   │
│  heatmap_future_predictions.csv                          │
│  heatmap_past_data_synthetic.csv                         │
│  heatmap_future_predictions_synthetic.csv                │
│  gge.csv  •  *.bbox_cache.json  •  *_cache.json          │
└──────────────────────────────────────────────────────────┘
```

---

## Project structure

```
BarkWatch_Arnes-Hackathon-2026_interface/
├── server.py
├── static/
│   ├── index.html                   # Main application page
│   ├── landing.html                 # Landing page
│   ├── app.js                       # Frontend logic
│   ├── styles.css                   # Main page styles
│   ├── landing.css                  # Landing page styles
│   ├── logo.png
│   └── logo_transparent.png
├── data/                            # All data files tracked via Git LFS
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
├── notebooks/
├── scripts/
├── .gitattributes
└── requirements.txt
```

---

## Running locally

```bash
python3 server.py
# Open http://localhost:8000
```

No virtual environment or `pip install` needed. The server uses only the Python 3 standard library (`http.server`, `csv`, `json`, `sqlite3`, `pathlib`, etc.).

All large data files are stored in Git LFS. Make sure Git LFS is installed and pulled before first run:

```bash
git lfs install
git lfs pull
```

---

## Backend (server.py)

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

### Vector tile decoding

The server includes a Mapbox Vector Tile (protobuf) decoder. It is used at startup to extract polygon bounding boxes from `vector_map_odseki.mbtiles` (zoom level 11) for the autocomplete zoom-to-sector feature.

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

Layer visibility is zoom-dependent: **GGE fill** is shown when `zoom < 11`; **odsek fill** is shown when `zoom ≥ 11`. This prevents overplotting thousands of small polygons at country scale which contributes to faster rendering.

### Client-side caching

Two LRU caches (keyed by `"dataset:month"`) are kept in memory:
- `heatmapCache` — odsek bucket maps
- `ggeCache` — GGE bucket maps

Both are evicted when size exceeds `HEATMAP_CACHE_LIMIT = 8`. Switching the dataset clears both caches completely.

---

## Data files

### CSV files

#### `odseki.csv`

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

#### `gge.csv`

Simple lookup table: GGE name + GGO code + area in hectares. Used to normalise GGE-level heatmap values.

#### `heatmap_past_data.csv`

Historical forest harvest (*posek*) data from the Slovenian Forest Service. Zero-value rows are stripped.

| Column | Description |
|--------|-------------|
| `ggo` | Numeric GGO code (1–14) |
| `odsek_id` | Normalised sector ID (spaces → zeros) |
| `leto_mesec` | Month as `YYYY-MM` |
| `target` | Harvest volume in m³ |

#### `heatmap_future_predictions.csv`

AI-generated predictions. Same schema as past data. The server merges both files at startup; months that exist in both default to the prediction value (controlled by `OVERLAP_PREFER = 'predictions'`).

#### `heatmap_past_data_synthetic.csv` + `heatmap_future_predictions_synthetic.csv`

Synthetic beetle infestation dataset — same schema, different units (barkbeetles/m²) and scale. Accessible via the dataset toggle in the UI.

---

### Vector files (MBTiles)

All vector layers are stored as [MBTiles](https://github.com/mapbox/mbtiles-spec) — SQLite databases containing gzip-compressed Mapbox Vector Tiles. The server reads them directly with `sqlite3`.

#### `vector_map_odseki.mbtiles`

The main layer. Contains polygon boundaries for every forest sector in Slovenia.

- **Layer name:** `odseki_map_ggo_gge`
- **Attributes:** `ggo_naziv`, `gge_naziv`, `odsek` (raw string)
- **Zoom range:** 0 – 14
- **Uses:**
  - Rendered as fill + outline on the map (`/tiles/{z}/{x}/{y}`)
  - Parsed at zoom 11 at startup to build the bounding-box index

#### `vector_map_gge.mbtiles`

Forest unit (*GGE*) boundaries.

- **Layer name:** `gge_vektor`
- **Uses:**
  - Rendered when zoom < 11
  - GGE heatmap coloring

#### `vector_map_ggo.mbtiles`

Forest district (*GGO*) boundaries.

- **Layer name:** `ggo_maps`
- **Uses:** Rendered as a green outline overlay; toggleable from the legend

#### `vector_map_slovenia.mbtiles`

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
