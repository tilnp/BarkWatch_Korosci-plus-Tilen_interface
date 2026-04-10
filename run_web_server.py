#!/usr/bin/env python3
"""
Simple MBTiles viewer using MapLibre GL JS.
Run with: python3 view_mbtiles.py
Then open http://localhost:8000 in your browser.
"""

import sqlite3
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

MBTILES_FILE = 'data/odseki_map_vector_final_brezZ.mbtiles'
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
ODSEKI_DATA_FILENAME = 'odseki_nazivi.csv'
ODSEKI_DATA_PATH = ODSEKI_DATA_DIR / ODSEKI_DATA_FILENAME

HEATMAP_DATA_PATH = BASE_DIR / 'data' / 'heatmap_sorted.csv'

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

POSEK_DATA_PATH = BASE_DIR / 'data' / 'posek_processed.csv'

# Oznake vzrokov poseka
VRSEC_LABELS = {
    '301': 'Sanitarni posek',
    '901': 'Redni posek',
    '991': 'Ostalo',
}

# ── Heatmap: spremenite FORECAST_START_MONTH, da premaknete mejo med
#             izmerjenimi podatki in napovedmi. Format: 'YYYY-MM'
FORECAST_START_MONTH = '2025-01'

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

# Heatmap runtime data (populated by load_heatmap_data)
HEATMAP_MONTHS = []       # sorted list of 'YYYY-MM' strings
HEATMAP_NZ_BREAKS = []    # 3 break points for non-zero target buckets (buckets 1–4)
HEATMAP_BY_MONTH = {}     # {leto_mesec: {odsek_id: bucket 1–4}} (only non-zero)

# Posek: {odsek_id: {'YYYY-MM': {vzrok: kubikov_sum}}}
POSEK_BY_ODSEK = {}


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

        bbox = _decode_geom_bbox(_unpack_varints(geom_raw)) if geom_raw else None
        features.append({'props': props, 'bbox': bbox, 'extent': extent})

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
            if layer_name != 'odsek':
                continue
            for feat in features:
                props = feat['props']
                raw_bbox = feat['bbox']
                extent = feat['extent']
                ggo = str(props.get('ggo_naziv', '')).strip()
                odsek = str(props.get('odsek', '')).strip()
                if not ggo or not odsek or raw_bbox is None:
                    continue
                mn_x, mn_y, mx_x, mx_y = raw_bbox
                lon_w, lat_n = _px_to_geo(zoom, x_tile, y_tms, mn_x, mn_y, extent)
                lon_e, lat_s = _px_to_geo(zoom, x_tile, y_tms, mx_x, mx_y, extent)
                key = (ggo, odsek)
                if key not in index:
                    index[key] = [lon_w, lat_s, lon_e, lat_n]
                else:
                    e = index[key]
                    e[0] = min(e[0], lon_w)
                    e[1] = min(e[1], lat_s)
                    e[2] = max(e[2], lon_e)
                    e[3] = max(e[3], lat_n)

    return index


def _configure_csv_field_limit():
    # Some geometry values are very large; increase CSV parser limit safely.
    limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(limit)
            break
        except OverflowError:
            limit = limit // 10


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
    global ODSEKI_BY_KEY, ODSEKI_BY_ODSEK, GGO_NAMES, GGO_OPTIONS

    ODSEKI_BY_KEY = {}
    ODSEKI_BY_ODSEK = defaultdict(list)
    GGO_NAMES = []
    GGO_OPTIONS = []

    _configure_csv_field_limit()

    if not ODSEKI_DATA_PATH.exists():
        print(f"WARNING: Odsek data file not found: {ODSEKI_DATA_PATH}")
        return

    try:
        ggo_names = set()
        ggo_name_to_codes = defaultdict(set)

        with ODSEKI_DATA_PATH.open('r', encoding='utf-8-sig', newline='') as csv_file:
            reader = csv.DictReader(csv_file)

            for row in reader:
                ggo_name = (row.get(GGO_FIELD) or '').strip()
                odsek_id = (row.get(ODSEK_FIELD) or '').strip()
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


def _nz_quantile_breaks(values):
    """Return 3 break points at 25/50/75 percentiles of non-zero values."""
    nz = sorted(v for v in values if v > 0)
    n = len(nz)
    if n < 3:
        return [1.0, 10.0, 100.0]
    return [nz[int(n * 0.25)], nz[int(n * 0.50)], nz[int(n * 0.75)]]


def _assign_heatmap_bucket(target, nz_breaks):
    """Map a target value to bucket 0–4 (0 = no activity, 4 = highest)."""
    if target <= 0:
        return 0
    for i, b in enumerate(nz_breaks):
        if target <= b:
            return i + 1
    return 4


def load_heatmap_data():
    global HEATMAP_MONTHS, HEATMAP_NZ_BREAKS, HEATMAP_BY_MONTH

    if not HEATMAP_DATA_PATH.exists():
        print(f"WARNING: Heatmap data not found: {HEATMAP_DATA_PATH}")
        return

    print("Loading heatmap data (this may take a moment)...")
    _configure_csv_field_limit()

    # Vector tiles vsebujejo samo lastnost 'odsek' (brez GGO).
    # Ker isti odsek_id obstaja v več GGO-jih, za vsak (mesec, odsek_id)
    # obdržimo MAX target vrednost čez vse GGO-je.
    raw = defaultdict(lambda: defaultdict(float))  # {month: {odsek_id: max_target}}
    all_targets = []
    skipped_ggo = set()

    with HEATMAP_DATA_PATH.open('r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            month = row.get('leto_mesec', '').strip()
            odsek = row.get('odsek_id',   '').strip()
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

    # Zberemo vse target vrednosti za izračun kvantilov
    for month_data in raw.values():
        all_targets.extend(month_data.values())

    if skipped_ggo:
        print(f"WARNING: Neznane GGO kode v heatmap (preskočene): {sorted(skipped_ggo)}")

    HEATMAP_MONTHS    = sorted(raw.keys())
    HEATMAP_NZ_BREAKS = _nz_quantile_breaks(all_targets)
    del all_targets

    HEATMAP_BY_MONTH = {}
    for month, odsek_targets in raw.items():
        buckets = {}
        for odsek, target in odsek_targets.items():
            b = _assign_heatmap_bucket(target, HEATMAP_NZ_BREAKS)
            if b > 0:
                buckets[odsek] = b
        HEATMAP_BY_MONTH[month] = buckets

    print(
        f"Heatmap loaded: {len(HEATMAP_MONTHS)} months, "
        f"{sum(len(v) for v in HEATMAP_BY_MONTH.values())} non-zero entries, "
        f"breaks={[round(b, 2) for b in HEATMAP_NZ_BREAKS]}"
    )


def load_posek_data():
    global POSEK_BY_ODSEK

    if not POSEK_DATA_PATH.exists():
        print(f"WARNING: Posek data not found: {POSEK_DATA_PATH}")
        return

    print("Loading posek data...")
    _configure_csv_field_limit()

    tmp = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    # tmp[odsek_id]['YYYY-MM'][vzrok] += kubikov

    with POSEK_DATA_PATH.open('r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            odsek = (row.get('odsek') or '').strip()
            if not odsek:
                continue
            try:
                leto  = int(row.get('leto',  0))
                mesec = int(row.get('mesec', 0))
                kub   = float(row.get('kubikov', 0) or 0)
            except ValueError:
                continue
            if not leto or not mesec:
                continue
            month_key = f"{leto}-{mesec:02d}"
            vzrok = (row.get('vrsec') or '').strip()
            tmp[odsek][month_key][vzrok] += kub

    POSEK_BY_ODSEK = {odsek: dict(months) for odsek, months in tmp.items()}
    print(f"Posek loaded: {len(POSEK_BY_ODSEK)} odseki")


def _sanitize_static_path(request_path):
    rel = request_path.lstrip('/') or 'index.html'
    full = (STATIC_DIR / rel).resolve()

    static_root = STATIC_DIR.resolve()
    if not str(full).startswith(str(static_root)):
        return None
    return full


class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
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

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/api/ggo':
            self._send_json(200, {
                'ggo_names': GGO_NAMES,
                'options': GGO_OPTIONS
            })
            return

        if path == '/api/odseki/suggest':
            query_map = parse_qs(parsed.query)
            query = query_map.get('q', [''])[0].strip().lower()
            ggo_name = query_map.get('ggo', [''])[0].strip()

            if not ggo_name or not query:
                suggestions = []
            else:
                suggestions = [
                    odsek_id
                    for (ggo, odsek_id) in ODSEKI_BY_KEY.keys()
                    if ggo == ggo_name and query in odsek_id.lower()
                ]
                suggestions = sorted(set(suggestions), key=_odsek_sort_key)[:SUGGESTION_LIMIT]

            self._send_json(200, {
                'query': query,
                'ggo': ggo_name,
                'suggestions': suggestions
            })
            return

        if path == '/api/odseki/by-key':
            query_map = parse_qs(parsed.query)
            ggo_name = query_map.get('ggo', [''])[0].strip()
            odsek_id = query_map.get('odsek', [''])[0].strip()

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

        if path == '/api/posek':
            query_map = parse_qs(parsed.query)
            odsek_id = query_map.get('odsek', [''])[0].strip()
            month    = query_map.get('month', [''])[0].strip()
            if not odsek_id or not month:
                self._send_json(400, {'error': 'Missing odsek or month'})
                return
            odsek_data = POSEK_BY_ODSEK.get(odsek_id, {})
            by_vzrok_raw = odsek_data.get(month, {})
            total = sum(by_vzrok_raw.values())
            by_vzrok = {
                VRSEC_LABELS.get(k, f'Vzrok {k}'): round(v, 2)
                for k, v in sorted(by_vzrok_raw.items())
            }
            self._send_json(200, {
                'odsek': odsek_id,
                'month': month,
                'total_kubikov': round(total, 2),
                'by_vzrok': by_vzrok,
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
            odsek_id = unquote(path[len('/api/odseki/'):]).strip()
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

        if path.startswith('/tiles/'):
            parts = path.strip('/').split('/')
            if len(parts) == 4:
                try:
                    _, z, x, y = parts
                    y_base = y.split('.')[0]  # supports /tiles/z/x/y.pbf
                    z, x, y = int(z), int(x), int(y_base)
                    y_tms = (2 ** z - 1) - y

                    conn = sqlite3.connect(MBTILES_FILE)
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
                        self.end_headers()
                        try:
                            self.wfile.write(tile_data)
                        except BrokenPipeError:
                            return
                    else:
                        self.send_response(204)
                        self.end_headers()
                    return
                except BrokenPipeError:
                    return
                except Exception:
                    try:
                        self.send_response(500)
                        self.end_headers()
                    except BrokenPipeError:
                        pass
                    return

        self._serve_static_file(path)


def _load_or_build_bbox_index(mbtiles_file: str, zoom: int = 11) -> dict:
    """Load bbox index from cache file if up-to-date, otherwise rebuild and save."""
    cache_path = Path(mbtiles_file).with_suffix('.bbox_cache.json')
    mbtiles_mtime = os.path.getmtime(mbtiles_file)

    if cache_path.exists():
        try:
            if os.path.getmtime(cache_path) >= mbtiles_mtime:
                with cache_path.open('r', encoding='utf-8') as f:
                    raw = json.load(f)
                # JSON keys are strings; restore tuple keys
                index = {tuple(k.split('\x00', 1)): v for k, v in raw.items()}
                print(f"Bbox index loaded from cache ({len(index)} entries)")
                return index
        except Exception as e:
            print(f"Cache read failed ({e}), rebuilding...")

    print("Building odsek bbox index from tiles (zoom 11)...")
    index = build_odsek_bbox_index(mbtiles_file, zoom=zoom)
    print(f"Bbox index: {len(index)} odsek entries")

    try:
        raw = {f"{ggo}\x00{odsek}": bbox for (ggo, odsek), bbox in index.items()}
        with cache_path.open('w', encoding='utf-8') as f:
            json.dump(raw, f, ensure_ascii=False)
        print(f"Bbox index cached to {cache_path.name}")
    except Exception as e:
        print(f"WARNING: Could not write bbox cache: {e}")

    return index


def main():
    if not os.path.exists(MBTILES_FILE):
        print(f"ERROR: '{MBTILES_FILE}' not found.")
        print("Update the MBTILES_FILE variable at the top of the script.")
        sys.exit(1)

    if not STATIC_DIR.exists():
        print(f"ERROR: static directory not found: {STATIC_DIR}")
        print("Create static/index.html, static/styles.css and static/app.js")
        sys.exit(1)

    load_odseki_data()
    load_heatmap_data()
    load_posek_data()

    global ODSEK_BBOX
    ODSEK_BBOX = _load_or_build_bbox_index(MBTILES_FILE, zoom=11)

    print(f"Serving {MBTILES_FILE}")
    print(f"Serving static files from {STATIC_DIR}")
    print(f"Odseki data file: {ODSEKI_DATA_PATH}")
    print(f"Open http://localhost:{PORT} in your browser")
    print("Press Ctrl+C to stop")

    server = HTTPServer(('localhost', PORT), TileHandler)
    server.serve_forever()

if __name__ == '__main__':
    main()
