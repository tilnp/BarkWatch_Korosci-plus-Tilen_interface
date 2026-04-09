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

MBTILES_FILE = 'odseki_map_vector.mbtiles'
PORT = 8000

HTML = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>MBTiles Viewer</title>
    <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
    <link href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" rel="stylesheet">
    <style>
        body { margin: 0; padding: 0; }
        #map { width: 100vw; height: 100vh; }
    </style>
</head>
<body>
<div id="map"></div>
<script>
const SLOVENIA_CENTER = [14.9955, 46.1512];

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            // Satellite basemap
            satellite: {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: 'Esri World Imagery'
            },
            // Your MBTiles vector layer served locally
            odseki: {
                type: 'vector',
                tiles: ['http://localhost:8000/tiles/{z}/{x}/{y}'],
                minzoom: 8,
                maxzoom: 14
            }
        },
        layers: [
            {
                id: 'satellite-layer',
                type: 'raster',
                source: 'satellite'
            },
            {
                id: 'odseki-fill',
                type: 'fill',
                source: 'odseki',
                'source-layer': 'odsek',
                paint: {
                    'fill-color': '#FF0000',
                    'fill-opacity': 0.4
                }
            },
            {
                id: 'odseki-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odsek',
                paint: {
                    'line-color': '#FF0000',
                    'line-width': 0.5
                }
            }
        ]
    },
    center: SLOVENIA_CENTER,
    zoom: 8,
    minZoom: 8,
    maxZoom: 16
});

// Initial view is the widest allowed extent.
// Users can still pan/rotate/zoom, but never outside this start view.
map.once('load', () => {
    const initialBounds = map.getBounds();
    map.setMaxBounds(initialBounds);
});

map.addControl(new maplibregl.NavigationControl());
map.addControl(new maplibregl.ScaleControl({
    maxWidth: 120,
    unit: 'metric'
}), 'bottom-left');

// Show odsek ID on click
map.on('click', 'odseki-fill', (e) => {
    const props = e.features[0].properties;
    new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<strong>Odsek:</strong> ${props.odsek}`)
        .addTo(map);
});

map.on('mouseenter', 'odseki-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
});
map.on('mouseleave', 'odseki-fill', () => {
    map.getCanvas().style.cursor = '';
});
</script>
</body>
</html>
"""

class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress request logs

    def do_GET(self):
        # Serve the HTML page
        if self.path == '/' or self.path == '/index.html':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(HTML.encode())
            return

        # Serve tiles from MBTiles
        if self.path.startswith('/tiles/'):
            parts = self.path.strip('/').split('/')
            if len(parts) == 4:
                try:
                    _, z, x, y = parts
                    z, x, y = int(z), int(x), int(y)
                    # MBTiles uses TMS y (flipped)
                    y_tms = (2 ** z - 1) - y

                    conn = sqlite3.connect(MBTILES_FILE)
                    cursor = conn.cursor()
                    cursor.execute(
                        'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
                        (z, x, y_tms)
                    )
                    row = cursor.fetchone()
                    conn.close()

                    if row:
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/x-protobuf')
                        self.send_header('Content-Encoding', 'gzip')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(row[0])
                    else:
                        self.send_response(204)
                        self.end_headers()
                    return
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
                    return

        self.send_response(404)
        self.end_headers()

def main():
    if not os.path.exists(MBTILES_FILE):
        print(f"ERROR: '{MBTILES_FILE}' not found.")
        print("Update the MBTILES_FILE variable at the top of the script.")
        sys.exit(1)

    print(f"Serving {MBTILES_FILE}")
    print(f"Open http://localhost:{PORT} in your browser")
    print("Press Ctrl+C to stop")

    server = HTTPServer(('localhost', PORT), TileHandler)
    server.serve_forever()

if __name__ == '__main__':
    main()
