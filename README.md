# BarkWatch Slovenija — Interface

Built for the Arnes Hackathon 2026 by Korošci+Tilen.

> This repository contains only the **web interface**. The AI prediction model and synthetic data generation live in a [separate repository](https://github.com/anejm/BarkWatch_Korosci-plus-Tilen).

---

## Background

Slovenia is one of the most forested countries in Europe (~58% land cover). Bark beetles (*podlubniki*) are a major natural threat that can devastate large areas silently before a forester can respond.

**Real data** comes from the Slovenian Forest Service as monthly forest harvest (*posek*) records. These values reflect human decisions about when and where to cut — not just beetle pressure — which introduces noise.

**Synthetic data** was generated from the real posek data using deterministic mathematical models that strip out the human-decision component. This proved to be a more accurate signal for beetle activity than the raw harvest figures. Predictions for both datasets were produced by our team's own AI model.

---

## Features

- Heatmap of bark beetle activity down to individual forest sector (*odsek*) level
- ~20-year historical window + 1-year AI-generated forecast, navigable via a time slider
- Full time-series chart for any selected sector
- Switch between real harvest data (m³/ha) and synthetic beetle-density data (beetles/m²)
- 3D height map in tilted view — height proportional to continuous data values
- View-history navigation (bearing, pitch, zoom, selected sector)
- The app has a lot of features, not all of them are intentional — some people call those bugs

---

## Geographic hierarchy

```
GGO — Gozdnogospodarsko območje (Forest district)   — 14 total
 └── GGE — Gozdnogospodarska enota (Forest unit)
      └── Odsek (Forest sector)                      — ~42 000 total
```

---

## Running locally

### Prerequisites

- Python 3.9+ (no `pip install` needed — server uses only the stdlib)
- [Git LFS](https://git-lfs.github.com/) for the large data files
- A machine with a GPU is recommended — the map uses WebGL and GPU rendering noticeably improves smoothness

### Setup

```bash
git lfs install
git lfs pull          # downloads MBTiles and large CSVs
python3 server.py
# open http://localhost:8000
```

On first run the server builds JSON caches from the MBTiles and CSV files. Subsequent starts are faster.

---

## Project structure

```
BarkWatch_Korosci-plus-Tilen_interface/
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

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        Browser                           │
│          index.html + app.js + styles.css                │
│                  MapLibre GL JS (map)                    │
│                  Chart.js (time-series modal)            │
│                  Vanilla JS (UI, state, caching)         │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTP REST (GET + JSON)
                         │ Vector tiles (MVT / protobuf)
┌────────────────────────▼─────────────────────────────────┐
│                 server.py  (Python 3 stdlib)             │
│  HTTPServer on :8000                                     │
│  ├── Static file server  (/, /static/*)                  │
│  ├── REST API  (/api/*)                                  │
│  └── Tile server  (/tiles/*, /gge-tiles/*, ...)          │
│                                                          │
│  In-memory at startup:                                   │
│  ├── odseki.csv  →  metadata dicts + area index          │
│  ├── gge.csv     →  GGE area table                       │
│  ├── heatmap_*.csv  →  bucketed + continuous height data │
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
│  odseki.csv  •  gge.csv                                  │
│  heatmap_past_data.csv                                   │
│  heatmap_future_predictions.csv                          │
│  heatmap_past_data_synthetic.csv                         │
│  heatmap_future_predictions_synthetic.csv                │
│  *.bbox_cache.json  •  *_cache.json                      │
└──────────────────────────────────────────────────────────┘
```

---

## Backend (server.py)

### Startup sequence

| Step | Function | What it does |
|------|----------|-------------|
| 1 | `load_odseki_data()` | Parses `odseki.csv` into lookup dicts; computes per-sector area (`POVRSINA_BY_ODSEK`) |
| 2 | `load_gge_area_data()` | Reads `gge.csv`; builds `GGE_AREA[(ggo, gge)] → ha` |
| 3 | `load_heatmap_data()` | Merges past + future CSVs; normalises by area; computes bucket breaks; builds `HEATMAP_REL_BY_MONTH` (m³/ha) and p99 height ceilings |
| 4 | `load_heatmap_data_synthetic()` | Same for synthetic dataset; height data uses raw bark-beetles/m² values directly (no area re-normalisation) |
| 5 | `_load_or_build_bbox_index()` | Decodes MBTiles at zoom 11; extracts polygon bounding boxes; writes/reads JSON cache |
| 6 | `_load_or_build_gge_cache()` | Aggregates absolute m³ per (ggo, gge) per month; buckets; writes/reads JSON cache |

### REST API

| Endpoint | Key parameters | Purpose |
|----------|---------------|---------|
| `GET /api/ggo` | — | List of all 14 GGO names + dropdown options |
| `GET /api/gge/ggo` | `gge` | Resolve GGE name → its GGO |
| `GET /api/odseki/suggest` | `q`, `ggo` | Autocomplete for odsek search (up to 20 results) |
| `GET /api/odseki/by-key` | `ggo`, `odsek` | Sector metadata + bounding box (for map zoom) |
| `GET /api/odseki/{id}` | — | Sector metadata; returns `ambiguous` if multiple GGOs match |
| `GET /api/heatmap/meta` | `dataset` | Available months, forecast boundary, break thresholds, height maxima |
| `GET /api/heatmap` | `month`, `dataset` | `{odsek_id: bucket}` map for the entire country |
| `GET /api/heatmap/value` | `odsek`, `month`, `ggo`, `dataset` | Single sector value (absolute m³ + relative m³/ha) |
| `GET /api/heatmap/odsek-series` | `odsek`, `ggo`, `dataset` | Full time series for one sector (all months) |
| `GET /api/heatmap/gge` | `month`, `dataset` | `{ggo\x00gge: bucket}` map for GGE-level coloring |
| `GET /api/heatmap/heights` | `month`, `dataset` | `{odsek_id: value}` continuous values for 3D extrusion height |
| `GET /api/heatmap/gge-heights` | `month`, `dataset` | `{ggo\x00gge: value}` continuous values for GGE 3D extrusion height |
| `GET /tiles/{z}/{x}/{y}` | — | MVT tile — forest sector polygons |
| `GET /gge-tiles/{z}/{x}/{y}` | — | MVT tile — forest unit boundaries |
| `GET /ggo-tiles/{z}/{x}/{y}` | — | MVT tile — forest district boundaries |
| `GET /slo-tiles/{z}/{x}/{y}` | — | MVT tile — Slovenia border |

### Heatmap bucketing

Values are bucketed into 5 levels:

| Bucket | Meaning | Colour |
|--------|---------|--------|
| 0 | No data | green |
| 1 | Low | yellow-green |
| 2 | Moderate | yellow |
| 3 | High | orange |
| 4 | Very high | red |

Real data is bucketed on area-normalised m³/ha values using `HEATMAP_BREAKS`. Synthetic data is bucketed on the raw source values (already per-area) using `HEATMAP_BREAKS_SYN`.

### Height data units

The height endpoints serve different units per dataset:

| Dataset | Unit | Rationale |
|---------|------|-----------|
| Real | m³/ha | Raw CSV is absolute m³; server divides by odsek/GGE area |
| Synthetic | bark beetles/m² | Source values are already per-area; no further normalisation applied |

The p99 across all months is used as the height ceiling (`height_max` / `gge_height_max` in `/api/heatmap/meta`) to prevent outliers from compressing the scale.

### Vector tile decoding

The server includes a Mapbox Vector Tile (protobuf) decoder used at startup to extract polygon bounding boxes from `vector_map_odseki.mbtiles` (zoom 11) for the autocomplete zoom-to-sector feature.

---

## Frontend (app.js, index.html, styles.css)

### Libraries

| Library | Version | Use |
|---------|---------|-----|
| [MapLibre GL JS](https://maplibre.org/) | 3.6.2 | Vector map rendering (WebGL / GPU) |
| [Chart.js](https://www.chartjs.org/) | 4.4.0 | Sector time-series bar chart |
| ArcGIS World Imagery | CDN raster | Satellite basemap |

No build step, no bundler — everything loads from CDN or is served as static files.

### Map layers

Centred on Slovenia (`[14.9955, 46.1512]`, zoom 8) with bounds locked to the country.

| Source | Endpoint | Visible when |
|--------|----------|-------------|
| `odseki` | `/tiles/{z}/{x}/{y}` | zoom ≥ 11 |
| `gge` | `/gge-tiles/{z}/{x}/{y}` | zoom < 11 |
| `ggo` | `/ggo-tiles/{z}/{x}/{y}` | always (outline only) |
| `slovenija` | `/slo-tiles/{z}/{x}/{y}` | always (border only) |

Each data layer exists in two variants: a flat `fill` layer (2D) and a `fill-extrusion` layer (3D). Only one variant is active at a time based on map pitch.

### 3D visualisation

When map pitch exceeds 1°, extrusion layers replace the flat layers. Height is proportional to the continuous data value — not the colour bucket — giving finer resolution than the 5-level colour scale.

- **2D mode:** extrusion layers are `visibility: none` — no 3D GPU work.
- **Single-odsek selection:** only the selected odsek renders in 3D; all others fall back to the flat layer. The filter uses the `(ggo_naziv, odsek)` compound key for uniqueness.

### Client-side caching

Four LRU caches (keyed by month string), all evicted at `HEATMAP_CACHE_LIMIT = 30`:

| Cache | Contents |
|-------|---------|
| `heatmapCache` | Odsek bucket maps |
| `ggeCache` | GGE bucket maps |
| `heightCache` | Odsek continuous height values |
| `ggeHeightCache` | GGE continuous height values |

Switching dataset clears all four caches.

### UI controls

| Control | Behaviour |
|---------|-----------|
| GGO dropdown | Restricts search and zooms to the chosen district |
| Odsek search | Autocomplete; selects and flies to a sector |
| ✕ button (panel) | Deselects the selected odsek; visible only when an odsek is selected |
| Time slider | Switches displayed month; ‹/› buttons move one month at a time |
| Izmerjeni / Sintetični | Switches between real harvest data and synthetic beetle-density data |
| +/− | Map zoom |
| Compass / drag | Shows bearing; click resets to north; drag left/right rotates |
| 2D/3D / drag | Click toggles flat/pitched view; drag up/down adjusts pitch |
| ← / → | Navigate back/forward through saved view states |
| ⌂ home | Flies to full-country view in 2D |
| ›/››/››› | Cycles animation speed: slow / normal / fast |
| Legenda | Colour legend; checkboxes to toggle Slovenia and GGO borders |

---

## Data files

### CSV files

#### `odseki.csv`

Forest sector metadata. One row per sector–GGO combination (a sector can appear in more than one district).

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

GGE name + GGO code + area in hectares. Used to normalise GGE-level heatmap values.

#### `heatmap_past_data.csv`

Historical posek data from the Slovenian Forest Service. Zero-value rows stripped.

| Column | Description |
|--------|-------------|
| `ggo` | Numeric GGO code (1–14) |
| `odsek_id` | Normalised sector ID (spaces → zeros) |
| `leto_mesec` | Month as `YYYY-MM` |
| `target` | Harvest volume in m³ |

#### `heatmap_future_predictions.csv`

AI-generated predictions, same schema as past data. Months present in both files default to the prediction value (controlled by `OVERLAP_PREFER = 'predictions'`).

#### `heatmap_past_data_synthetic.csv` + `heatmap_future_predictions_synthetic.csv`

Synthetic bark-beetle density dataset. Same schema, units are beetles/m² rather than m³. Generated from posek data using deterministic mathematical models; AI predictions use the same model as for real data.

### Vector files (MBTiles)

All vector layers are [MBTiles](https://github.com/mapbox/mbtiles-spec) — SQLite databases of gzip-compressed Mapbox Vector Tiles, read directly with `sqlite3`.

| File | Layer name | Attributes | Notes |
|------|-----------|-----------|-------|
| `vector_map_odseki.mbtiles` | `odseki_map_ggo_gge` | `ggo_naziv`, `gge_naziv`, `odsek` | Zoom 0–14; parsed at zoom 11 for bbox index |
| `vector_map_gge.mbtiles` | `gge_vektor` | `ggo_naziv`, `gge_naziv` | Rendered at zoom < 11 |
| `vector_map_ggo.mbtiles` | `ggo_maps` | `ggo_naziv` | Green outline overlay; toggleable |
| `vector_map_slovenia.mbtiles` | `meja_maps` | — | Blue border overlay; toggleable |

### Auto-generated cache files

Created on first run; rebuilt automatically when the version stamp changes.

| File | Version key | Content |
|------|-------------|---------|
| `vector_map_odseki.bbox_cache.json` | `_BBOX_CACHE_VERSION = 5` | `{ggo\x00odsek: [W, S, E, N, odsek_raw]}` |
| `gge_heatmap_cache.json` | `_GGE_CACHE_VERSION = 7` | `{month: {ggo\x00gge: bucket}}` |
| `gge_heatmap_cache_synthetic.json` | same | Same for synthetic dataset |
