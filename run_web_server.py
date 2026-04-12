#!/usr/bin/env python3
"""
MBTiles viewer using MapLibre GL JS.
Run with: python3 run_web_server.py
Then open http://localhost:8000 in your browser.
"""

import sqlite3
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

ODSEKI_MBTILES_FILE = 'data/vector_map_odseki.mbtiles'
GGO_MBTILES_FILE    = 'data/vector_map_ggo.mbtiles'
GGE_MBTILES_FILE    = 'data/vector_map_gge.mbtiles'
SLO_MBTILES_FILE    = 'data/vector_map_slovenia.mbtiles'
PORT = 8000

import csv
import json
import mimetypes
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / 'static'

# Easy-to-change location and file name for odsek attribute data.
ODSEKI_DATA_DIR = BASE_DIR / "data"
ODSEKI_DATA_FILENAME = 'odseki.csv'
ODSEKI_DATA_PATH = ODSEKI_DATA_DIR / ODSEKI_DATA_FILENAME

# GGE area data — used to normalize heatmap values per GGE (m³/ha).
GGE_DATA_PATH = BASE_DIR / 'data' / 'gge.csv'

# Heatmap source files — change these to point to different CSVs if needed.
HEATMAP_PAST_DATA_PATH   = BASE_DIR / 'data' / 'heatmap_past_data.csv'
HEATMAP_FUTURE_DATA_PATH = BASE_DIR / 'data' / 'heatmap_future_predictions.csv'

# When the same (odsek, month) appears in both files, which source wins?
# 'predictions' → future file takes priority; 'data' → past file takes priority.
OVERLAP_PREFER = 'predictions'

# ── Preslikava ggo (številka v heatmap.csv) → ggo_naziv (niz v vector tilesih)
GGO_CODE_TO_NAZIV = {
    1:  'TOLMIN',
    2:  'BLED',
    3:  'KRANJ',
    4:  'LJUBLJANA',
    5:  'POSTOJNA',
    6:  'KOČEVJE',
    7:  'NOVO MESTO',
    8:  'BREŽICE',
    9:  'CELJE',
    10: 'NAZARJE',
    11: 'SLOVENJ GRADEC',
    12: 'MARIBOR',
    13: 'MURSKA SOBOTA',
    14: 'SEŽANA',
}

# Reverse of GGO_CODE_TO_NAZIV — used when loading odseki_nazivi for area lookup
GGO_NAZIV_TO_CODE = {v: k for k, v in GGO_CODE_TO_NAZIV.items()}

# Bucket break points (m³/ha/month) for odsek-level coloring.
# Bucket 0 = no data, 1 = low, 2 = moderate, 3 = high, 4 = very high.
# Based on historical data distribution (Q25≈0.26, Q50≈0.71, Q75≈1.90 across all months).
# Tune upward to show only the most active odseki in colour; downward to reveal more detail.
HEATMAP_BREAKS = [0.25, 0.7, 2.0]

# Bucket break points (m³/ha/month) for GGE-level coloring.
# GGE area denominator comes from gge.csv (full GGE polygon area, not just odsek sum).
# Distribution across all months/GGEs:
#   Q10 = 0.001  Q25 = 0.004  Q50 = 0.013  Q75 = 0.042  Q90 = 0.116  max ≈ 14
# Seasonal pattern: winter Q75 ≈ 0.014, autumn Q75 ≈ 0.091
# 2016 was the highest-activity year: Q75 = 0.141, Q90 = 0.379
# Breaks chosen to show winter (mostly bucket 1) vs autumn (bucket 2-3) vs 2016 peaks (bucket 4).
GGE_HEATMAP_BREAKS = [0.02, 0.03, 0.12]

# Easy-to-change list of columns shown in the left panel.
ODSEKI_FIELDS = [
    'ggo_naziv', 'odsek', 'povrsina', 'gge_naziv', 'ke_naziv', 'revir_naziv',
    'katgozd_naziv', 'ohranjen_naziv', 'relief_naziv', 'lega_naziv',
    'pozar_naziv', 'intgosp_naziv', 'krajime', 'grt1_naziv'
]

SUGGESTION_LIMIT = 20

GGO_FIELD = 'ggo_naziv'
ODSEK_FIELD = 'odsek'

ODSEKI_BY_KEY = {}
ODSEKI_BY_ODSEK = defaultdict(list)
GGO_NAMES = []
GGO_OPTIONS = []

# (ggo_naziv, odsek) -> [west, south, east, north]  built from mbtiles at zoom 11
ODSEK_BBOX = {}

# {ggo_naziv: sorted list of odsek_ids} — built from ODSEK_BBOX, used for suggestions
ODSEKI_BY_GGO = {}

# {odsek_id: povrsina_ha} — built from odseki_nazivi, used for relative posek
POVRSINA_BY_ODSEK = {}

# Heatmap runtime data (populated by load_heatmap_data)
HEATMAP_MONTHS = []           # sorted list of 'YYYY-MM' strings
HEATMAP_NZ_BREAKS = []        # 3 break points for non-zero relative-value buckets (buckets 1–4)
HEATMAP_BY_MONTH = {}         # {leto_mesec: {odsek_id: bucket 1–4}} (only non-zero, relative)
HEATMAP_ABS_BY_MONTH = {}     # {leto_mesec: {odsek_id: absolute target}} (for detail panel)
FORECAST_START_MONTH = ''     # first month from the future predictions file

# GGE heatmap (populated by _load_or_build_gge_cache after load_heatmap_data)
GGE_HEATMAP_BY_MONTH = {}    # {leto_mesec: {gge_naziv: bucket 1–4}}
GGE_HEATMAP_CACHE_PATH = BASE_DIR / 'data' / 'gge_heatmap_cache.json'
_GGE_CACHE_VERSION = 5

# GGE lookup tables (populated by load_odseki_data and load_gge_area_data)
ODSEK_TO_GGE = {}            # {odsek_id: gge_naziv}
GGO_BY_GGE   = {}            # {gge_naziv: ggo_naziv} — built from odseki data
GGE_AREA = {}                # {gge_naziv: area_ha} — loaded from gge.csv


# ---------------------------------------------------------------------------
# Minimal MVT (Mapbox Vector Tile) protobuf decoder — no external deps
# ---------------------------------------------------------------------------

import math
import gzip as _gzip
import struct as _struct


def _read_varint(data: bytes, pos: int):
    result = shift = 0
    while pos < len(data):
        b = data[pos]; pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7
    return result, pos


def _zigzag(n: int) -> int:
    return (n >> 1) ^ -(n & 1)


def _unpack_varints(data: bytes):
    values = []
    pos = 0
    while pos < len(data):
        v, pos = _read_varint(data, pos)
        values.append(v)
    return values


def _decode_value(data: bytes):
    pos = 0
    while pos < len(data):
        tw, pos = _read_varint(data, pos)
        fn, wt = tw >> 3, tw & 0x7
        if wt == 0:
            v, pos = _read_varint(data, pos)
            if fn == 4: return v          # int_value
            if fn == 5: return v          # uint_value
            if fn == 6: return _zigzag(v) # sint_value
            if fn == 7: return bool(v)    # bool_value
        elif wt == 2:
            l, pos = _read_varint(data, pos)
            chunk = data[pos:pos + l]; pos += l
            if fn == 1: return chunk.decode('utf-8', errors='replace')  # string_value
        elif wt == 1:
            v = _struct.unpack_from('<d', data, pos)[0]; pos += 8
            if fn == 3: return v  # double_value
        elif wt == 5:
            v = _struct.unpack_from('<f', data, pos)[0]; pos += 4
            if fn == 2: return v  # float_value
    return None


def _decode_geom_bbox(geom_ints):
    """Return (min_x, min_y, max_x, max_y) in tile pixel coords, or None."""
    cx = cy = 0
    min_x = min_y = float('inf')
    max_x = max_y = float('-inf')
    i = 0
    while i < len(geom_ints):
        cmd = geom_ints[i]; i += 1
        cmd_id, count = cmd & 0x7, cmd >> 3
        if cmd_id == 7:  # ClosePath — no params
            continue
        for _ in range(count):
            if i + 1 >= len(geom_ints): break
            cx += _zigzag(geom_ints[i]); i += 1
            cy += _zigzag(geom_ints[i]); i += 1
            if cx < min_x: min_x = cx
            if cx > max_x: max_x = cx
            if cy < min_y: min_y = cy
            if cy > max_y: max_y = cy
    if not math.isfinite(min_x):
        return None
    return min_x, min_y, max_x, max_y


def _decode_layer(data: bytes):
    """Return (layer_name, list_of_features).
    Each feature: {'props': dict, 'bbox': (min_x,min_y,max_x,max_y), 'extent': int}
    """
    keys, raw_vals, raw_feats = [], [], []
    name = ''
    extent = 4096
    pos = 0
    while pos < len(data):
        tw, pos = _read_varint(data, pos)
        fn, wt = tw >> 3, tw & 0x7
        if wt == 0:
            v, pos = _read_varint(data, pos)
            if fn == 5: extent = v
        elif wt == 2:
            l, pos = _read_varint(data, pos)
            chunk = data[pos:pos + l]; pos += l
            if fn == 1:   name = chunk.decode('utf-8', errors='replace')
            elif fn == 2: raw_feats.append(chunk)
            elif fn == 3: keys.append(chunk.decode('utf-8', errors='replace'))
            elif fn == 4: raw_vals.append(_decode_value(chunk))
        elif wt == 1: pos += 8
        elif wt == 5: pos += 4

    features = []
    for fd in raw_feats:
        tags_raw = geom_raw = None
        fp = 0
        while fp < len(fd):
            tw, fp = _read_varint(fd, fp)
            fn, wt = tw >> 3, tw & 0x7
            if wt == 0: _, fp = _read_varint(fd, fp)
            elif wt == 2:
                l, fp = _read_varint(fd, fp)
                chunk = fd[fp:fp + l]; fp += l
                if fn == 2: tags_raw = chunk
                elif fn == 4: geom_raw = chunk
            elif wt == 1: fp += 8
            elif wt == 5: fp += 4

        props = {}
        if tags_raw:
            tag_ints = _unpack_varints(tags_raw)
            for k in range(0, len(tag_ints) - 1, 2):
                ki, vi = tag_ints[k], tag_ints[k + 1]
                if ki < len(keys) and vi < len(raw_vals):
                    props[keys[ki]] = raw_vals[vi]

        geom_ints = _unpack_varints(geom_raw) if geom_raw else []
        bbox = _decode_geom_bbox(geom_ints) if geom_ints else None
        features.append({'props': props, 'bbox': bbox, 'extent': extent,
                         '_geom_raw': geom_raw})

    return name, features


def _decode_tile(tile_bytes: bytes):
    """Return list of (layer_name, features)."""
    if tile_bytes[:2] == b'\x1f\x8b':
        tile_bytes = _gzip.decompress(tile_bytes)
    layers = []
    pos = 0
    while pos < len(tile_bytes):
        tw, pos = _read_varint(tile_bytes, pos)
        fn, wt = tw >> 3, tw & 0x7
        if wt == 2:
            l, pos = _read_varint(tile_bytes, pos)
            chunk = tile_bytes[pos:pos + l]; pos += l
            if fn == 3:
                layers.append(_decode_layer(chunk))
        elif wt == 0: _, pos = _read_varint(tile_bytes, pos)
        elif wt == 1: pos += 8
        elif wt == 5: pos += 4
    return layers


def _px_to_geo(z, x_tile, y_tms, px, py, extent):
    n = 1 << z
    y_xyz = n - 1 - y_tms
    lon = (x_tile + px / extent) / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * (y_xyz + py / extent) / n))))
    return lon, lat


def build_odsek_bbox_index(mbtiles_file: str, zoom: int = 11) -> dict:
    """Decode all tiles at *zoom* and return {(ggo_naziv, odsek): [W,S,E,N]}."""
    index = {}
    try:
        conn = sqlite3.connect(mbtiles_file)
        cur = conn.cursor()
        cur.execute(
            'SELECT tile_column, tile_row, tile_data FROM tiles WHERE zoom_level=?',
            (zoom,)
        )
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        print(f'WARNING: bbox index query failed: {e}')
        return index

    for x_tile, y_tms, tile_data in rows:
        if not tile_data:
            continue
        try:
            layers = _decode_tile(bytes(tile_data))
        except Exception:
            continue
        for layer_name, features in layers:
            if layer_name != 'odseki_map_ggo_gge':
                continue
            for feat in features:
                props = feat['props']
                raw_bbox = feat['bbox']
                extent = feat['extent']
                ggo = str(props.get('ggo_naziv', '')).strip()
                odsek_raw = str(props.get('odsek', '')).strip()   # exact string stored in tile
                odsek     = _normalize_odsek_id(odsek_raw)        # canonical key (spaces→zeros)
                if not ggo or not odsek or raw_bbox is None:
                    continue
                mn_x, mn_y, mx_x, mx_y = raw_bbox
                lon_w, lat_n = _px_to_geo(zoom, x_tile, y_tms, mn_x, mn_y, extent)
                lon_e, lat_s = _px_to_geo(zoom, x_tile, y_tms, mx_x, mx_y, extent)
                key = (ggo, odsek)
                if key not in index:
                    # Store [W, S, E, N, actual_tile_id] — tile_id is used for the
                    # suggestion index and highlight filter so they match the tile exactly.
                    index[key] = [lon_w, lat_s, lon_e, lat_n, odsek_raw]
                else:
                    e = index[key]
                    e[0] = min(e[0], lon_w)
                    e[1] = min(e[1], lat_s)
                    e[2] = max(e[2], lon_e)
                    e[3] = max(e[3], lat_n)
                    # e[4] (odsek_raw) is kept from first occurrence — consistent per GGO

    return index


def build_gge_area_index(mbtiles_file: str, zoom: int = 11) -> dict:
    """Decode GGE polygon geometries and return {gge_naziv: area_ha}.

    Uses the Shoelace formula on lat/lon coordinates with a flat-earth approximation
    (error < 0.1 % for Slovenia's scale).  Polygon pieces clipped at tile boundaries
    sum correctly to the true total area because each clipped piece is a valid polygon
    whose areas tile-decompose the original.
    """
    R_m = 6371000.0  # Earth radius in metres
    d2r = math.pi / 180.0

    def _ring_area_m2(pts_latlon, lat_mean):
        """Signed Shoelace area in m² using flat-earth approximation."""
        cos_lat = math.cos(lat_mean * d2r)
        xs = [lon * cos_lat * R_m * d2r for _, lon in pts_latlon]
        ys = [lat          * R_m * d2r for lat, _ in pts_latlon]
        n = len(xs)
        s = sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n))
        return s / 2.0  # signed: negative = exterior ring in y-down tile space

    area_accum = defaultdict(float)

    try:
        conn = sqlite3.connect(mbtiles_file)
        cur  = conn.cursor()
        cur.execute(
            'SELECT tile_column, tile_row, tile_data FROM tiles WHERE zoom_level=?', (zoom,)
        )
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        print(f'WARNING: GGE area index query failed: {e}')
        return {}

    for x_tile, y_tms, tile_data in rows:
        if not tile_data:
            continue
        try:
            layers = _decode_tile(bytes(tile_data))
        except Exception:
            continue

        n_tiles = 1 << zoom
        y_xyz   = n_tiles - 1 - y_tms

        for layer_name, features in layers:
            if layer_name != 'gge_maps':
                continue
            for feat in features:
                gge = str(feat['props'].get('gge_naziv', '')).strip()
                if not gge or feat['bbox'] is None:
                    continue

                geom_raw = feat.get('_geom_raw')
                if geom_raw is None:
                    continue

                extent = feat['extent']
                geom_ints = _unpack_varints(geom_raw)

                # Walk geometry commands and collect rings
                rings = []
                ring  = []
                cx = cy = 0
                i   = 0
                while i < len(geom_ints):
                    cmd        = geom_ints[i]; i += 1
                    cmd_id     = cmd & 0x7
                    count      = cmd >> 3
                    if cmd_id == 1:        # MoveTo — starts a new ring
                        if ring:
                            rings.append(ring)
                        ring = []
                        for _ in range(count):
                            cx += _zigzag(geom_ints[i]); i += 1
                            cy += _zigzag(geom_ints[i]); i += 1
                            ring.append((cx, cy))
                    elif cmd_id == 2:      # LineTo
                        for _ in range(count):
                            cx += _zigzag(geom_ints[i]); i += 1
                            cy += _zigzag(geom_ints[i]); i += 1
                            ring.append((cx, cy))
                    elif cmd_id == 7:      # ClosePath
                        if ring:
                            rings.append(ring)
                            ring = []
                if ring:
                    rings.append(ring)

                # Convert rings to lat/lon and accumulate signed area
                for r in rings:
                    if len(r) < 3:
                        continue
                    pts = []
                    for px, py in r:
                        lon = (x_tile + px / extent) / n_tiles * 360.0 - 180.0
                        lat = math.degrees(math.atan(math.sinh(
                            math.pi * (1.0 - 2.0 * (y_xyz + py / extent) / n_tiles)
                        )))
                        pts.append((lat, lon))
                    lat_mean = sum(p[0] for p in pts) / len(pts)
                    area_accum[gge] += _ring_area_m2(pts, lat_mean)

    # Signed areas: exterior rings are negative in y-down tile space → take abs of sum
    return {gge: abs(signed_m2) / 10_000 for gge, signed_m2 in area_accum.items()}


def _configure_csv_field_limit():
    # Some geometry values are very large; increase CSV parser limit safely.
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            break
        except OverflowError:
            limit = limit // 10


def _normalize_odsek_id(odsek_id):
    """Canonical internal form: spaces → zeros.  '01  1A' → '01001A'."""
    return (odsek_id or '').strip().replace(' ', '0')




def _odsek_sort_key(odsek_id):
    try:
        return (0, int(odsek_id))
    except ValueError:
        return (1, odsek_id)


def _extract_ggo_code_from_odsek(odsek_id):
    odsek_id = (odsek_id or '').strip()
    if len(odsek_id) < 2:
        return ''
    prefix = odsek_id[:2]
    return prefix if prefix.isdigit() else ''


def load_odseki_data():
    global ODSEKI_BY_KEY, ODSEKI_BY_ODSEK, GGO_NAMES, GGO_OPTIONS, POVRSINA_BY_ODSEK, \
           ODSEK_TO_GGE, GGO_BY_GGE

    ODSEKI_BY_KEY = {}
    ODSEKI_BY_ODSEK = defaultdict(list)
    GGO_NAMES = []
    GGO_OPTIONS = []
    POVRSINA_BY_ODSEK = {}
    ODSEK_TO_GGE = {}
    GGO_BY_GGE = {}

    _configure_csv_field_limit()

    if not ODSEKI_DATA_PATH.exists():
        print(f"WARNING: Odsek data file not found: {ODSEKI_DATA_PATH}")
        return

    try:
        ggo_names = set()
        ggo_name_to_codes = defaultdict(set)
        _povrsina_accum = {}

        with ODSEKI_DATA_PATH.open('r', encoding='utf-8-sig', newline='') as csv_file:
            reader = csv.DictReader(csv_file)

            for row in reader:
                ggo_name = (row.get(GGO_FIELD) or '').strip()
                odsek_id = _normalize_odsek_id(row.get(ODSEK_FIELD) or '')
                if not ggo_name or not odsek_id:
                    continue

                record = {field: (row.get(field) or '').strip() for field in ODSEKI_FIELDS}
                ggo_code = _extract_ggo_code_from_odsek(odsek_id)
                record['ggo_code'] = ggo_code

                key = (ggo_name, odsek_id)
                ODSEKI_BY_KEY[key] = record
                ODSEKI_BY_ODSEK[odsek_id].append(record)
                ggo_names.add(ggo_name)
                if ggo_code:
                    ggo_name_to_codes[ggo_name].add(ggo_code)

                # Accumulate areas — same odsek_id can appear in multiple GGOs
                try:
                    p = float(record.get('povrsina') or 0)
                    if p > 0:
                        _povrsina_accum.setdefault(odsek_id, []).append(p)
                except ValueError:
                    pass

                # GGE membership (odsek belongs to exactly one GGE)
                gge = (record.get('gge_naziv') or '').strip()
                if gge and odsek_id not in ODSEK_TO_GGE:
                    ODSEK_TO_GGE[odsek_id] = gge
                if gge and gge not in GGO_BY_GGE:
                    GGO_BY_GGE[gge] = ggo_name

        # Average area across GGOs so coloring is consistent regardless of iteration order
        POVRSINA_BY_ODSEK = {oid: sum(vals) / len(vals) for oid, vals in _povrsina_accum.items()}

        GGO_NAMES = sorted(ggo_names)
        GGO_OPTIONS = [
            {
                'ggo_naziv': name,
                'ggo_code': sorted(ggo_name_to_codes.get(name, {'00'}))[0]
            }
            for name in GGO_NAMES
        ]

        print(
            f"Loaded {len(ODSEKI_BY_KEY)} odsek records "
            f"({len(GGO_NAMES)} GGO) from {ODSEKI_DATA_PATH.name}"
        )
    except Exception as e:
        print(f"WARNING: Failed to load odseki data from {ODSEKI_DATA_PATH}: {e}")


def load_gge_area_data():
    """Load GGE areas (ha) from gge.csv into GGE_AREA."""
    global GGE_AREA
    GGE_AREA = {}
    if not GGE_DATA_PATH.exists():
        print(f"WARNING: GGE area file not found: {GGE_DATA_PATH}")
        return
    try:
        with GGE_DATA_PATH.open('r', encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                gge = (row.get('gge_naziv') or '').strip()
                try:
                    area = float(row.get('povrsina') or 0)
                except ValueError:
                    area = 0.0
                if gge and area > 0:
                    GGE_AREA[gge] = area
        total_ha = sum(GGE_AREA.values())
        print(f"Loaded {len(GGE_AREA)} GGE areas from {GGE_DATA_PATH.name}")
    except Exception as e:
        print(f"WARNING: Failed to load GGE area data from {GGE_DATA_PATH}: {e}")


def _assign_heatmap_bucket(target, nz_breaks):
    """Map a target value to bucket 0–4 (0 = no activity, 4 = highest)."""
    if target <= 0:
        return 0
    for i, b in enumerate(nz_breaks):
        if target <= b:
            return i + 1
    return 4


def _read_heatmap_file(path):
    """Read one heatmap CSV and return {month: {odsek_id: max_target}}, skipped_ggo set."""
    raw = defaultdict(lambda: defaultdict(float))
    skipped_ggo = set()
    with path.open('r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            month = row.get('leto_mesec', '').strip()
            odsek = _normalize_odsek_id(row.get('odsek_id', ''))
            if not month or not odsek:
                continue
            try:
                ggo_int = int(row.get('ggo', 0))
                target  = float(row.get('target', 0))
            except ValueError:
                continue
            if ggo_int not in GGO_CODE_TO_NAZIV:
                skipped_ggo.add(ggo_int)
                continue
            if target > raw[month][odsek]:
                raw[month][odsek] = target
    return raw, skipped_ggo


def load_heatmap_data():
    global HEATMAP_MONTHS, HEATMAP_NZ_BREAKS, HEATMAP_BY_MONTH, HEATMAP_ABS_BY_MONTH, FORECAST_START_MONTH

    past_exists   = HEATMAP_PAST_DATA_PATH.exists()
    future_exists = HEATMAP_FUTURE_DATA_PATH.exists()

    if not past_exists and not future_exists:
        print(f"WARNING: Neither heatmap file found "
              f"({HEATMAP_PAST_DATA_PATH.name}, {HEATMAP_FUTURE_DATA_PATH.name})")
        return

    print("Loading heatmap data (this may take a moment)...")
    _configure_csv_field_limit()

    skipped_ggo = set()

    raw_past = defaultdict(lambda: defaultdict(float))
    if past_exists:
        raw_past, sg = _read_heatmap_file(HEATMAP_PAST_DATA_PATH)
        skipped_ggo |= sg
        print(f"  Past data:   {sum(len(v) for v in raw_past.values()):,} entries "
              f"across {len(raw_past)} months")
    else:
        print(f"WARNING: Past heatmap file not found: {HEATMAP_PAST_DATA_PATH}")

    raw_future = defaultdict(lambda: defaultdict(float))
    if future_exists:
        raw_future, sg = _read_heatmap_file(HEATMAP_FUTURE_DATA_PATH)
        skipped_ggo |= sg
        print(f"  Future data: {sum(len(v) for v in raw_future.values()):,} entries "
              f"across {len(raw_future)} months")
    else:
        print(f"WARNING: Future heatmap file not found: {HEATMAP_FUTURE_DATA_PATH}")

    # Derive forecast start from the earliest month in the future file.
    FORECAST_START_MONTH = min(raw_future.keys()) if raw_future else ''

    # Merge both sources. For overlapping (month, odsek) pairs, OVERLAP_PREFER decides.
    all_months = set(raw_past.keys()) | set(raw_future.keys())
    raw = {}
    for month in all_months:
        in_past   = month in raw_past
        in_future = month in raw_future
        if in_past and in_future:
            if OVERLAP_PREFER == 'predictions':
                merged = {**raw_past[month], **raw_future[month]}   # future overwrites
            else:
                merged = {**raw_future[month], **raw_past[month]}   # past overwrites
        elif in_past:
            merged = dict(raw_past[month])
        else:
            merged = dict(raw_future[month])
        raw[month] = merged

    if skipped_ggo:
        print(f"WARNING: Neznane GGO kode v heatmap (preskočene): {sorted(skipped_ggo)}")

    # Convert absolute targets → relative (m³/ha) using povrsina from odseki_nazivi.
    # Segments with no area data fall back to the absolute value.
    no_area = 0
    for month_data in raw.values():
        for odsek in list(month_data.keys()):
            p = POVRSINA_BY_ODSEK.get(odsek, 0)
            if p > 0:
                month_data[odsek] /= p
            else:
                no_area += 1
    if no_area:
        print(f"  WARNING: {no_area} entries have no area data — kept as absolute fallback")

    HEATMAP_MONTHS = sorted(raw.keys())

    # Store absolute targets before bucketing (for the detail panel endpoint).
    # Re-derive from relative × povrsina to avoid keeping a second full copy of raw.
    HEATMAP_ABS_BY_MONTH = {}
    for month, odsek_data in raw.items():
        abs_month = {}
        for odsek, rel in odsek_data.items():
            p = POVRSINA_BY_ODSEK.get(odsek, 0)
            abs_month[odsek] = round(rel * p if p > 0 else rel, 2)
        HEATMAP_ABS_BY_MONTH[month] = abs_month

    HEATMAP_NZ_BREAKS = list(HEATMAP_BREAKS)
    print(f"  Breaks (m³/ha): {HEATMAP_NZ_BREAKS}")

    HEATMAP_BY_MONTH = {}
    for month, odsek_targets in raw.items():
        buckets = {}
        for odsek, target in odsek_targets.items():
            b = _assign_heatmap_bucket(target, HEATMAP_NZ_BREAKS)
            if b > 0:
                buckets[odsek] = b
        HEATMAP_BY_MONTH[month] = buckets

    print(
        f"Heatmap loaded: {len(HEATMAP_MONTHS)} months "
        f"(forecast from {FORECAST_START_MONTH or 'n/a'}), "
        f"{sum(len(v) for v in HEATMAP_BY_MONTH.values())} non-zero entries"
    )




def _build_gge_heatmap():
    """Aggregate absolute heatmap targets by GGE per month → relative posek → bucket.

    Computes its own bucket breaks from GGE-level relative posek values, separate from
    the odsek breaks. GGE values are averaged over larger areas so their distribution
    is narrower — shared breaks with odsek would crush most GGEs into bucket 1.
    Only odseki present in odseki.csv (with a known GGE and area) are counted.
    """
    # First pass: sum absolute targets per (gge, month) across all months
    gge_relatives = {}   # {month: {gge: relative_posek}}
    for month, abs_data in HEATMAP_ABS_BY_MONTH.items():
        target_sum = defaultdict(float)
        for odsek_id, target_abs in abs_data.items():
            gge = ODSEK_TO_GGE.get(odsek_id)
            if not gge:
                continue
            target_sum[gge] += target_abs
        month_rel = {}
        for gge, t in target_sum.items():
            # Use GGE polygon area (from mbtiles geometry) as denominator.
            # Falls back to summed odsek area if the GGE was not found in the geometry index.
            area = GGE_AREA.get(gge, 0)
            month_rel[gge] = t / area if area > 0 else t
        gge_relatives[month] = month_rel

    gge_breaks = list(GGE_HEATMAP_BREAKS)
    print(f"  GGE breaks (m³/ha): {gge_breaks}")

    # Second pass: assign buckets using GGE-specific breaks
    gge_by_month = {}
    for month, month_rel in gge_relatives.items():
        buckets = {}
        for gge, relative in month_rel.items():
            b = _assign_heatmap_bucket(relative, gge_breaks)
            if b > 0:
                buckets[gge] = b
        gge_by_month[month] = buckets
    return gge_by_month


def _load_or_build_gge_cache():
    """Load GGE heatmap from cache if both heatmap source files are older than it.
    Rebuilds and saves cache when sources are newer.
    """
    global GGE_HEATMAP_BY_MONTH

    # Newest mtime among the source heatmap files
    src_mtime = max(
        os.path.getmtime(p) if p.exists() else 0
        for p in (HEATMAP_PAST_DATA_PATH, HEATMAP_FUTURE_DATA_PATH)
    )

    if GGE_HEATMAP_CACHE_PATH.exists():
        try:
            cache_mtime = os.path.getmtime(GGE_HEATMAP_CACHE_PATH)
            if cache_mtime >= src_mtime:
                with GGE_HEATMAP_CACHE_PATH.open('r', encoding='utf-8') as f:
                    raw = json.load(f)
                if raw.get('_version') == _GGE_CACHE_VERSION:
                    GGE_HEATMAP_BY_MONTH = {k: v for k, v in raw.items() if not k.startswith('_')}
                    print(f"GGE heatmap loaded from cache ({len(GGE_HEATMAP_BY_MONTH)} months)")
                    return
                print("GGE cache version mismatch — rebuilding...")
        except Exception as e:
            print(f"GGE cache read failed ({e}) — rebuilding...")

    print("Building GGE heatmap aggregation...")
    GGE_HEATMAP_BY_MONTH = _build_gge_heatmap()
    print(f"GGE heatmap built: {len(GGE_HEATMAP_BY_MONTH)} months, "
          f"{sum(len(v) for v in GGE_HEATMAP_BY_MONTH.values())} non-zero GGE entries")

    try:
        out = dict(GGE_HEATMAP_BY_MONTH)
        out['_version'] = _GGE_CACHE_VERSION
        with GGE_HEATMAP_CACHE_PATH.open('w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False)
        print(f"GGE heatmap cached to {GGE_HEATMAP_CACHE_PATH.name}")
    except Exception as e:
        print(f"WARNING: Could not write GGE cache: {e}")


def _sanitize_static_path(request_path):
    rel = request_path.lstrip('/') or 'landing.html'
    full = (STATIC_DIR / rel).resolve()

    static_root = STATIC_DIR.resolve()
    if not str(full).startswith(str(static_root)):
        return None
    return full


class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _serve_mbtiles_tile(self, mbtiles_file, path):
        parts = path.strip('/').split('/')
        if len(parts) != 4:
            return
        try:
            _, z, x, y = parts
            z, x, y = int(z), int(x), int(y.split('.')[0])
            y_tms = (2 ** z - 1) - y
            conn = sqlite3.connect(mbtiles_file)
            try:
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
                    (z, x, y_tms)
                )
                row = cursor.fetchone()
            finally:
                conn.close()
            if row:
                tile_data = row[0]
                self.send_response(200)
                self.send_header('Content-Type', 'application/vnd.mapbox-vector-tile')
                if tile_data[:2] == b'\x1f\x8b':
                    self.send_header('Content-Encoding', 'gzip')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'public, max-age=3600')
                self.end_headers()
                try:
                    self.wfile.write(tile_data)
                except BrokenPipeError:
                    pass
            else:
                self.send_response(204)
                self.end_headers()
        except BrokenPipeError:
            pass
        except Exception:
            try:
                self.send_response(500)
                self.end_headers()
            except BrokenPipeError:
                pass

    def _send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _serve_static_file(self, request_path):
        full_path = _sanitize_static_path(request_path)
        if full_path is None or not full_path.exists() or not full_path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        mime_type, _ = mimetypes.guess_type(str(full_path))
        if not mime_type:
            mime_type = 'application/octet-stream'

        try:
            with full_path.open('rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception:
            self.send_response(500)
            self.end_headers()

    def _serve_video_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        file_size = path.stat().st_size
        range_header = self.headers.get('Range')

        try:
            with path.open('rb') as f:
                if range_header:
                    # Parse "bytes=start-end"
                    byte_range = range_header.strip().replace('bytes=', '')
                    start_str, _, end_str = byte_range.partition('-')
                    start = int(start_str) if start_str else 0
                    end   = int(end_str)   if end_str   else file_size - 1
                    end   = min(end, file_size - 1)
                    length = end - start + 1
                    f.seek(start)
                    data = f.read(length)
                    self.send_response(206)
                    self.send_header('Content-Type', 'video/mp4')
                    self.send_header('Content-Length', str(length))
                    self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    self.wfile.write(data)
                else:
                    data = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'video/mp4')
                    self.send_header('Content-Length', str(file_size))
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_response(500)
            self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/ggo':
            self._send_json(200, {
                'ggo_names': GGO_NAMES,
                'options': GGO_OPTIONS
            })
            return

        if path == '/api/gge/ggo':
            query_map = parse_qs(parsed.query)
            gge_name = query_map.get('gge', [''])[0].strip()
            if not gge_name:
                self._send_json(400, {'error': 'Missing gge query parameter'})
                return
            ggo_name = GGO_BY_GGE.get(gge_name)
            if not ggo_name:
                self._send_json(404, {'error': f'GGO for GGE {gge_name!r} not found'})
                return
            self._send_json(200, {'gge_naziv': gge_name, 'ggo_naziv': ggo_name})
            return

        if path == '/api/odseki/suggest':
            query_map = parse_qs(parsed.query)
            # Keep query exactly as typed — spaces are a distinct character in odsek IDs,
            # not interchangeable with zeros. The index stores display-form IDs (with spaces).
            query = query_map.get('q', [''])[0].strip().lower()
            ggo_name = query_map.get('ggo', [''])[0].strip()

            if not ggo_name or not query:
                suggestions = []
            else:
                suggestions = [
                    odsek_id   # already in display form (spaces)
                    for odsek_id in ODSEKI_BY_GGO.get(ggo_name, [])
                    if odsek_id.lower().startswith(query)
                ][:SUGGESTION_LIMIT]

            self._send_json(200, {
                'query': query,
                'ggo': ggo_name,
                'suggestions': suggestions
            })
            return

        if path == '/api/odseki/by-key':
            query_map = parse_qs(parsed.query)
            ggo_name = query_map.get('ggo', [''])[0].strip()
            odsek_id = _normalize_odsek_id(query_map.get('odsek', [''])[0])

            if not ggo_name or not odsek_id:
                self._send_json(400, {'error': 'Missing ggo or odsek query parameter'})
                return

            record = ODSEKI_BY_KEY.get((ggo_name, odsek_id))
            if not record:
                self._send_json(404, {'error': f'Odsek {odsek_id} in GGO {ggo_name} not found'})
                return

            bbox = ODSEK_BBOX.get((ggo_name, odsek_id))
            self._send_json(200, {
                'key': {
                    'ggo_naziv': ggo_name,
                    'odsek': odsek_id,
                    'ggo_code': (record.get('ggo_code') or '')
                },
                'columns': ODSEKI_FIELDS,
                'data': record,
                'bbox': bbox  # [west, south, east, north] or null
            })
            return

        if path == '/api/heatmap/value':
            query_map = parse_qs(parsed.query)
            odsek_id = _normalize_odsek_id(query_map.get('odsek', [''])[0])
            month    = query_map.get('month', [''])[0].strip()
            ggo_name = query_map.get('ggo',   [''])[0].strip()
            if not odsek_id or not month:
                self._send_json(400, {'error': 'Missing odsek or month'})
                return
            target_abs = (HEATMAP_ABS_BY_MONTH.get(month) or {}).get(odsek_id)
            # Use exact area for this (odsek, ggo) pair when available — falls back
            # to averaged area across GGOs if ggo is unknown or not in nazivi.
            record   = ODSEKI_BY_KEY.get((ggo_name, odsek_id)) if ggo_name else None
            povrsina = None
            if record:
                try:
                    povrsina = float(record.get('povrsina') or 0) or None
                except ValueError:
                    pass
            if povrsina is None:
                povrsina = POVRSINA_BY_ODSEK.get(odsek_id)
            if target_abs is None:
                self._send_json(200, {'odsek': odsek_id, 'month': month,
                                      'target': 0.0, 'relative': 0.0,
                                      'povrsina': povrsina, 'has_data': False})
                return
            relative = round(target_abs / povrsina, 4) if povrsina else None
            self._send_json(200, {
                'odsek':    odsek_id,
                'month':    month,
                'target':   target_abs,
                'relative': relative,
                'povrsina': povrsina,
                'has_data': True,
            })
            return

        if path == '/api/heatmap/meta':
            self._send_json(200, {
                'months':         HEATMAP_MONTHS,
                'forecast_start': FORECAST_START_MONTH,
                'nz_breaks':      HEATMAP_NZ_BREAKS,
            })
            return

        if path == '/api/heatmap':
            query_map = parse_qs(parsed.query)
            month = query_map.get('month', [''])[0].strip()
            if not month:
                self._send_json(400, {'error': 'Missing month parameter'})
                return
            buckets = HEATMAP_BY_MONTH.get(month)
            if buckets is None:
                self._send_json(404, {'error': f'No heatmap data for {month}'})
                return
            self._send_json(200, buckets)
            return

        if path.startswith('/api/odseki/'):
            odsek_id = _normalize_odsek_id(unquote(path[len('/api/odseki/'):]))
            if not odsek_id:
                self._send_json(400, {'error': 'Missing odsek id'})
                return

            matches = ODSEKI_BY_ODSEK.get(odsek_id, [])
            if not matches:
                self._send_json(404, {'error': f'Odsek {odsek_id} not found'})
                return

            if len(matches) == 1:
                record = matches[0]
                self._send_json(200, {
                    'odsek': odsek_id,
                    'columns': ODSEKI_FIELDS,
                    'data': record,
                    'ambiguous': False
                })
                return

            self._send_json(200, {
                'odsek': odsek_id,
                'ambiguous': True,
                'match_count': len(matches),
                'options': [
                    {
                        'ggo_naziv': (r.get('ggo_naziv') or '').strip(),
                        'odsek': (r.get('odsek') or '').strip(),
                        'ggo_code': (r.get('ggo_code') or '').strip()
                    }
                    for r in matches
                ]
            })
            return

        if path == '/api/heatmap/gge':
            query_map = parse_qs(parsed.query)
            month = query_map.get('month', [''])[0].strip()
            if not month:
                self._send_json(400, {'error': 'Missing month parameter'})
                return
            buckets = GGE_HEATMAP_BY_MONTH.get(month)
            if buckets is None:
                self._send_json(404, {'error': f'No GGE heatmap data for {month}'})
                return
            self._send_json(200, buckets)
            return

        if path.startswith('/slo-tiles/'):
            self._serve_mbtiles_tile(SLO_MBTILES_FILE, path)
            return

        if path.startswith('/ggo-tiles/'):
            self._serve_mbtiles_tile(GGO_MBTILES_FILE, path)
            return

        if path.startswith('/gge-tiles/'):
            self._serve_mbtiles_tile(GGE_MBTILES_FILE, path)
            return

        if path.startswith('/tiles/'):
            self._serve_mbtiles_tile(ODSEKI_MBTILES_FILE, path)
            return

        if path == '/video_background.mp4':
            self._serve_video_file(BASE_DIR / 'data' / 'video_background.mp4')
            return

        self._serve_static_file(path)


# Increment this when the cache format, layer name, or odsek normalisation logic changes.
_BBOX_CACHE_VERSION = 5


def _load_or_build_bbox_index(mbtiles_file: str, zoom: int = 11) -> dict:
    """Load bbox index from cache file if up-to-date, otherwise rebuild and save."""
    cache_path = Path(mbtiles_file).with_suffix('.bbox_cache.json')
    mbtiles_mtime = os.path.getmtime(mbtiles_file)

    if cache_path.exists():
        try:
            if os.path.getmtime(cache_path) >= mbtiles_mtime:
                with cache_path.open('r', encoding='utf-8') as f:
                    raw = json.load(f)
                if raw.get('_version') != _BBOX_CACHE_VERSION:
                    print(f"Bbox cache version mismatch, rebuilding...")
                else:
                    # JSON keys are strings; restore tuple keys (skip metadata key)
                    index = {
                        tuple(k.split('\x00', 1)): v
                        for k, v in raw.items()
                        if not k.startswith('_')
                    }
                    print(f"Bbox index loaded from cache ({len(index)} entries)")
                    return index
        except Exception as e:
            print(f"Cache read failed ({e}), rebuilding...")

    print("Building odsek bbox index from tiles (zoom 11)...")
    index = build_odsek_bbox_index(mbtiles_file, zoom=zoom)
    print(f"Bbox index: {len(index)} odsek entries")

    try:
        raw = {f"{ggo}\x00{odsek}": bbox for (ggo, odsek), bbox in index.items()}
        raw['_version'] = _BBOX_CACHE_VERSION
        with cache_path.open('w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False)
        print(f"Bbox index cached to {cache_path.name}")
    except Exception as e:
        print(f"WARNING: Could not write bbox cache: {e}")

    return index


def main():
    if not os.path.exists(ODSEKI_MBTILES_FILE):
        print(f"ERROR: '{ODSEKI_MBTILES_FILE}' not found.")
        print("Update the ODSEKI_MBTILES_FILE variable at the top of the script.")
        sys.exit(1)

    if not STATIC_DIR.exists():
        print(f"ERROR: static directory not found: {STATIC_DIR}")
        print("Create static/index.html, static/styles.css and static/app.js")
        sys.exit(1)

    load_odseki_data()
    load_gge_area_data()
    load_heatmap_data()
    _load_or_build_gge_cache()

    global ODSEK_BBOX, ODSEKI_BY_GGO
    ODSEK_BBOX = _load_or_build_bbox_index(ODSEKI_MBTILES_FILE, zoom=11)

    # Build suggestion index from mbtiles-derived segments.
    # Use the actual tile odsek ID (bbox[4]) so suggestions exactly match what the tile stores,
    # and the MapLibre highlight filter can match without any conversion.
    by_ggo = defaultdict(list)
    for (ggo_naziv, _), bbox_val in ODSEK_BBOX.items():
        tile_id = bbox_val[4]
        by_ggo[ggo_naziv].append(tile_id)
    ODSEKI_BY_GGO = {ggo: sorted(ids, key=_odsek_sort_key) for ggo, ids in by_ggo.items()}
    print(f"Suggestion index: {sum(len(v) for v in ODSEKI_BY_GGO.values()):,} segments across {len(ODSEKI_BY_GGO)} GGO")

    print(f"Serving {ODSEKI_MBTILES_FILE}")
    print(f"Serving static files from {STATIC_DIR}")
    print(f"Odseki data file: {ODSEKI_DATA_PATH}")
    print(f"Heatmap past data:   {HEATMAP_PAST_DATA_PATH}")
    print(f"Heatmap future data: {HEATMAP_FUTURE_DATA_PATH}")
    print(f"Overlap preference: {OVERLAP_PREFER}")
    print(f"Open http://localhost:{PORT} in your browser")
    print("Press Ctrl+C to stop")

    server = HTTPServer(('localhost', PORT), TileHandler)
    server.serve_forever()

if __name__ == '__main__':
    main()
