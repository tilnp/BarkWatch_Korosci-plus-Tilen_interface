const SLOVENIA_CENTER = [14.9955, 46.1512];
const INITIAL_ZOOM = 8;
const HISTORICAL_MONTHS = 24;
const TOTAL_MONTHS = 36;

const DISPLAY_FIELDS = [
    'ggo_naziv', 'odsek', 'povrsina', 'gge_naziv', 'ke_naziv', 'revir_naziv',
    'katgozd_naziv', 'ohranjen_naziv', 'relief_naziv', 'lega_naziv',
    'pozar_naziv', 'intgosp_naziv', 'krajime', 'grt1_naziv'
];

const HISTORICAL_MONTH_PALETTES = [
    ['#e11d48', '#fb7185', '#fdba74', '#facc15', '#22c55e'],
    ['#be123c', '#f43f5e', '#f97316', '#a3e635', '#14b8a6'],
    ['#c026d3', '#a855f7', '#6366f1', '#0ea5e9', '#06b6d4'],
    ['#7c3aed', '#8b5cf6', '#3b82f6', '#22d3ee', '#34d399'],
    ['#2563eb', '#60a5fa', '#38bdf8', '#2dd4bf', '#4ade80'],
    ['#0f766e', '#14b8a6', '#22c55e', '#84cc16', '#eab308'],
    ['#15803d', '#4ade80', '#facc15', '#f97316', '#ef4444'],
    ['#b45309', '#f59e0b', '#f97316', '#fb7185', '#f43f5e'],
    ['#dc2626', '#ef4444', '#f97316', '#f59e0b', '#84cc16'],
    ['#9333ea', '#c084fc', '#38bdf8', '#2dd4bf', '#22c55e'],
    ['#1d4ed8', '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981'],
    ['#334155', '#64748b', '#94a3b8', '#60a5fa', '#a78bfa']
];

const FORECAST_MONTH_PALETTES = [
    ['#f97316', '#fb923c', '#fdba74', '#facc15', '#84cc16'],
    ['#ea580c', '#f97316', '#fb7185', '#f59e0b', '#a3e635'],
    ['#f43f5e', '#fb7185', '#fdba74', '#f59e0b', '#22c55e'],
    ['#d946ef', '#f472b6', '#fb7185', '#f97316', '#eab308'],
    ['#c2410c', '#ea580c', '#f59e0b', '#facc15', '#84cc16'],
    ['#f97316', '#fb923c', '#fda4af', '#fde68a', '#86efac'],
    ['#ea580c', '#f97316', '#fb7185', '#fdba74', '#a3e635'],
    ['#f43f5e', '#fb7185', '#f97316', '#f59e0b', '#84cc16'],
    ['#d97706', '#f59e0b', '#f97316', '#fb7185', '#f43f5e'],
    ['#b45309', '#d97706', '#f59e0b', '#facc15', '#4ade80'],
    ['#c2410c', '#ea580c', '#fb923c', '#fdba74', '#a3e635'],
    ['#f97316', '#fb923c', '#f59e0b', '#facc15', '#84cc16']
];

const TILE_URL = `${window.location.origin}/tiles/{z}/{x}/{y}`;

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            satellite: {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: 'Esri World Imagery'
            },
            odseki: {
                type: 'vector',
                tiles: [TILE_URL],
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
                    'fill-opacity': 0.45
                }
            },
            {
                id: 'odseki-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odsek',
                paint: {
                    'line-color': '#111827',
                    'line-width': 0.6,
                    'line-opacity': 0.75
                }
            },
            {
                id: 'odseki-selected-fill',
                type: 'fill',
                source: 'odseki',
                'source-layer': 'odsek',
                filter: ['==', ['get', 'odsek'], ''],
                paint: {
                    'fill-color': '#2563eb',
                    'fill-opacity': 0.25
                }
            },
            {
                id: 'odseki-selected-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odsek',
                filter: ['==', ['get', 'odsek'], ''],
                paint: {
                    'line-color': '#2563eb',
                    'line-width': 5,
                    'line-opacity': 1
                }
            }
        ]
    },
    center: SLOVENIA_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: INITIAL_ZOOM,
    maxZoom: 16
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

const ggoSelect = document.getElementById('ggo-select');
const searchInput = document.getElementById('odsek-search');
const searchBtn = document.getElementById('search-btn');
const suggestionsEl = document.getElementById('suggestions');
const selectedOdsekEl = document.getElementById('selected-odsek');
const detailsEl = document.getElementById('odsek-details');
const monthSlider = document.getElementById('month-slider');
const monthLabel = document.getElementById('month-label');

monthSlider.max = String(TOTAL_MONTHS);

let suggestionsRequestCounter = 0;
const ggoCodeByName = new Map();
const ggoNameByCode = new Map(); // reverse: normalised code → ggo_naziv

// Detected GGO field name inside vector-tile feature properties.
// null  = not yet probed
// false = probed but not found
// string = field name that exists
let _tileGgoField = null;
let _tileGgoFieldType = null; // 'code' | 'name'

function normalize(v) {
    return String(v ?? '').trim();
}

function normalizeCode(v) {
    const s = normalize(v);
    if (!s) return '';
    return String(parseInt(s, 10)).padStart(2, '0');
}

function selectedGgoName() {
    return (ggoSelect.value || '').trim();
}

function selectedGgoCode() {
    const name = selectedGgoName();
    return name ? (ggoCodeByName.get(name) || '') : '';
}

/**
 * Try to resolve a GGO name from vector-tile feature properties.
 * Returns the ggo_naziv string, or null if not determinable.
 */
function detectGgoNameFromProps(props) {
    if (!props) return null;

    const codeKeys = ['ggo', 'ggo_id', 'ggo_sifra', 'ggo_code'];
    for (const key of codeKeys) {
        if (props[key] !== undefined) {
            const code = normalizeCode(String(props[key]));
            const name = ggoNameByCode.get(code);
            if (name) return name;
        }
    }

    const nameKeys = ['ggo_naziv', 'ggo_name'];
    for (const key of nameKeys) {
        const val = normalize(props[key]);
        if (val && ggoCodeByName.has(val)) return val;
    }

    return null;
}

/**
 * Probe which GGO field (if any) exists inside the rendered vector tiles.
 * Result is cached in _tileGgoField / _tileGgoFieldType.
 */
function probeTileGgoField() {
    if (_tileGgoField !== null) return;
    if (!map.isStyleLoaded()) return;

    const features = map.querySourceFeatures('odseki', { sourceLayer: 'odsek' });
    if (!features.length) return; // tiles not loaded yet — will retry later

    const sample = features[0].properties || {};

    const codeKeys = ['ggo', 'ggo_id', 'ggo_sifra', 'ggo_code'];
    for (const key of codeKeys) {
        if (sample[key] !== undefined) {
            _tileGgoField = key;
            _tileGgoFieldType = 'code';
            return;
        }
    }

    const nameKeys = ['ggo_naziv', 'ggo_name'];
    for (const key of nameKeys) {
        if (sample[key] !== undefined) {
            _tileGgoField = key;
            _tileGgoFieldType = 'name';
            return;
        }
    }

    _tileGgoField = false; // tiles carry no GGO info
}

function setSearchEnabled(enabled) {
    searchInput.disabled = !enabled;
    searchBtn.disabled = !enabled;

    if (enabled) {
        searchInput.placeholder = 'npr. 31001';
    } else {
        searchInput.placeholder = 'Najprej izberi GGO';
        searchInput.value = '';
        suggestionsEl.innerHTML = '';
        clearHighlight();
    }
}

function buildColorExpression(monthIndex) {
    const isForecast = monthIndex > HISTORICAL_MONTHS;
    const periodMonth = isForecast ? (monthIndex - HISTORICAL_MONTHS) : monthIndex;
    const palettes = isForecast ? FORECAST_MONTH_PALETTES : HISTORICAL_MONTH_PALETTES;
    const palette = palettes[(periodMonth - 1) % palettes.length];

    return [
        'let', 'bucket', ['%', ['abs', ['to-number', ['get', 'odsek'], 0]], 5],
        [
            'match', ['var', 'bucket'],
            0, palette[0],
            1, palette[1],
            2, palette[2],
            3, palette[3],
            palette[4]
        ]
    ];
}

function updateMonthStyle() {
    const month = Number(monthSlider.value);
    const isForecast = month > HISTORICAL_MONTHS;
    const periodMonth = isForecast ? (month - HISTORICAL_MONTHS) : month;

    monthLabel.textContent = isForecast
        ? `Napoved ${periodMonth}`
        : `Podatki ${periodMonth}`;

    monthSlider.classList.toggle('slider-forecast', isForecast);
    monthSlider.classList.toggle('slider-historical', !isForecast);

    if (map.getLayer('odseki-fill')) {
        map.setPaintProperty('odseki-fill', 'fill-color', buildColorExpression(month));
    }
}

function coordinatesBbox(coords, acc) {
    if (!Array.isArray(coords)) return acc;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const x = coords[0];
        const y = coords[1];
        return [
            Math.min(acc[0], x),
            Math.min(acc[1], y),
            Math.max(acc[2], x),
            Math.max(acc[3], y)
        ];
    }
    for (const item of coords) {
        acc = coordinatesBbox(item, acc);
    }
    return acc;
}

/** Compute bbox directly from a GeoJSON geometry object. */
function getBboxFromGeometry(geometry) {
    if (!geometry?.coordinates) return null;
    const bbox = coordinatesBbox(geometry.coordinates, [Infinity, Infinity, -Infinity, -Infinity]);
    return Number.isFinite(bbox[0]) ? bbox : null;
}

function featureMatchesSelection(feature, odsekId, ggoCode, ggoName, discriminator = null) {
    const p = feature?.properties || {};
    const odsekMatches = normalize(p.odsek) === normalize(odsekId);
    if (!odsekMatches) return false;

    if (discriminator && discriminator.key) {
        return normalize(p[discriminator.key]) === normalize(discriminator.value);
    }

    const selectedCode = normalizeCode(ggoCode);
    const selectedName = normalize(ggoName);

    if (!selectedCode && !selectedName) return true;

    // Check GGO code fields. If the tile HAS such a field, use it definitively.
    const candidateCodeKeys = ['ggo', 'ggo_id', 'ggo_sifra', 'ggo_code'];
    for (const key of candidateCodeKeys) {
        if (p[key] !== undefined) {
            return selectedCode ? normalizeCode(p[key]) === selectedCode : true;
        }
    }

    // Check GGO name fields. If the tile HAS such a field, use it definitively.
    const candidateNameKeys = ['ggo_naziv', 'ggo_name'];
    for (const key of candidateNameKeys) {
        if (p[key] !== undefined) {
            return selectedName ? normalize(p[key]) === selectedName : true;
        }
    }

    // Tile carries no GGO field at all — cannot discriminate.
    return true;
}

function detectDiscriminator(features, ggoCode, ggoName) {
    const selectedCode = normalizeCode(ggoCode);
    const selectedName = normalize(ggoName);

    const codeKeys = ['ggo', 'ggo_id', 'ggo_sifra', 'ggo_code'];
    for (const key of codeKeys) {
        const hit = features.find((f) => normalizeCode(f?.properties?.[key]) === selectedCode && selectedCode);
        if (hit) return { key, value: hit.properties[key] };
    }

    const nameKeys = ['ggo_naziv', 'ggo_name'];
    for (const key of nameKeys) {
        const hit = features.find((f) => normalize(f?.properties?.[key]) === selectedName && selectedName);
        if (hit) return { key, value: hit.properties[key] };
    }

    return null;
}

function findBoundsInLoadedTiles(odsekId, ggoCode, ggoName) {
    if (!map.isStyleLoaded()) return null;

    const features = map.querySourceFeatures('odseki', { sourceLayer: 'odsek' });
    const odsekCandidates = features.filter((feature) => normalize(feature?.properties?.odsek) === normalize(odsekId));
    if (!odsekCandidates.length) return null;

    const discriminator = detectDiscriminator(odsekCandidates, ggoCode, ggoName);
    const found = odsekCandidates.find((feature) =>
        featureMatchesSelection(feature, odsekId, ggoCode, ggoName, discriminator)
    ) || odsekCandidates[0];

    if (!found || !found.geometry) return null;

    const bbox = coordinatesBbox(found.geometry.coordinates, [Infinity, Infinity, -Infinity, -Infinity]);
    if (!Number.isFinite(bbox[0])) return null;

    return bbox;
}

function fitToBbox(bbox) {
    map.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 70, duration: 1700, maxZoom: 14 }
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForMoveEnd(timeoutMs = 1600) {
    return new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        const onEnd = () => finish();
        map.once('moveend', onEnd);
        setTimeout(() => {
            map.off('moveend', onEnd);
            finish();
        }, timeoutMs);
    });
}

async function sweepForOdsekBbox(odsekId, ggoCode, ggoName, animateSweep) {
    let bbox = findBoundsInLoadedTiles(odsekId, ggoCode, ggoName)
        || findBoundsInLoadedTiles(odsekId, '', '');
    if (bbox) return bbox;

    const maxBounds = map.getMaxBounds();
    const sw = maxBounds ? maxBounds.getSouthWest() : { lng: 12.0, lat: 45.0 };
    const ne = maxBounds ? maxBounds.getNorthEast() : { lng: 17.4, lat: 47.0 };

    const cols = 5;
    const rows = 4;
    const centers = [];
    for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
            const tX = (c + 0.5) / cols;
            const tY = (r + 0.5) / rows;
            centers.push([
                sw.lng + (ne.lng - sw.lng) * tX,
                ne.lat - (ne.lat - sw.lat) * tY
            ]);
        }
    }

    for (const center of centers) {
        if (animateSweep) {
            map.easeTo({ center, zoom: INITIAL_ZOOM, duration: 260 });
            await waitForMoveEnd(1000);
        } else {
            map.jumpTo({ center, zoom: INITIAL_ZOOM });
            await sleep(130);
        }

        bbox = findBoundsInLoadedTiles(odsekId, ggoCode, ggoName)
            || findBoundsInLoadedTiles(odsekId, '', '');
        if (bbox) return bbox;
    }

    return null;
}

async function locateOdsek(odsekId, ggoCode, ggoName, mode = 'panel') {
    const animatePanelSwitch = mode === 'panel';

    let bbox = await sweepForOdsekBbox(odsekId, ggoCode, ggoName, animatePanelSwitch);
    if (!bbox) return false;

    if (animatePanelSwitch) {
        fitToBbox(bbox);
    } else {
        map.fitBounds(
            [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
            { padding: 70, duration: 700, maxZoom: 14 }
        );
    }

    return true;
}

function renderDetailsTable(data) {
    if (!data) {
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Podatki niso na voljo.';
        return;
    }

    const rows = DISPLAY_FIELDS.map((field) => {
        const value = data[field] ?? '';
        return `<tr><th>${field}</th><td>${String(value) || '-'}</td></tr>`;
    }).join('');

    detailsEl.classList.remove('empty');
    detailsEl.innerHTML = `<table class="details-table"><tbody>${rows}</tbody></table>`;
}

function renderSuggestions(items) {
    if (!items.length) {
        suggestionsEl.innerHTML = '';
        return;
    }

    suggestionsEl.innerHTML = items
        .map((id) => `<button class="suggestion-item" type="button" data-odsek="${id}">${id}</button>`)
        .join('');
}

async function fetchGgoOptions() {
    const response = await fetch('/api/ggo');
    if (!response.ok) return;

    const payload = await response.json();
    const options = payload.options || [];
    ggoSelect.innerHTML = '<option value="">-- izberi GGO --</option>';

    ggoCodeByName.clear();
    ggoNameByCode.clear();
    for (const item of options) {
        const name = String(item.ggo_naziv || '').trim();
        const code = String(item.ggo_code || '').trim();
        if (!name) continue;

        ggoCodeByName.set(name, code);
        if (code) ggoNameByCode.set(normalizeCode(code), name);
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        ggoSelect.appendChild(option);
    }
}

async function fetchSuggestions(query, ggoName) {
    const requestId = ++suggestionsRequestCounter;
    const response = await fetch(
        `/api/odseki/suggest?q=${encodeURIComponent(query)}&ggo=${encodeURIComponent(ggoName)}`
    );
    if (!response.ok) return;
    const payload = await response.json();

    if (requestId !== suggestionsRequestCounter) return;
    renderSuggestions(payload.suggestions || []);
}

async function fetchOdsekByKey(ggoName, odsekId) {
    const response = await fetch(
        `/api/odseki/by-key?ggo=${encodeURIComponent(ggoName)}&odsek=${encodeURIComponent(odsekId)}`
    );
    if (!response.ok) return null;
    return response.json();
}

async function fetchOdsekById(odsekId) {
    const response = await fetch(`/api/odseki/${encodeURIComponent(odsekId)}`);
    if (!response.ok) return null;
    return response.json();
}

let _highlightReqId = 0;

const NEVER_MATCH = ['==', ['get', 'odsek'], ''];

function _applyFilter(f) {
    if (map.getLayer('odseki-selected-fill'))    map.setFilter('odseki-selected-fill',    f);
    if (map.getLayer('odseki-selected-outline')) map.setFilter('odseki-selected-outline', f);
}

/** Clear the highlight layers. */
function clearHighlight() {
    ++_highlightReqId;
    _applyFilter(NEVER_MATCH);
}

/**
 * Highlight all features matching odsekId AND ggoName.
 *
 * Step 1 – set odsek-only filter immediately so the highlight appears as soon
 *           as the destination tiles load (MapLibre re-evaluates filters on
 *           every tile render).
 * Step 2 – once the map is idle (tiles at destination are loaded), probe the
 *           actual tile feature properties to discover which GGO field the
 *           tiles carry (ggo_naziv, ggo, ggo_id, …) and its exact value.
 *           Then narrow the filter to odsek AND that GGO field/value, so only
 *           features belonging to the requested GGO stay highlighted.
 */
function setHighlight(odsekId, ggoName) {
    if (!odsekId) { clearHighlight(); return; }
    const reqId = ++_highlightReqId;

    const odsekFilter = ['==', ['to-string', ['get', 'odsek']], String(odsekId)];
    _applyFilter(odsekFilter);

    if (!ggoName) return;

    const ggoCode  = ggoCodeByName.get(ggoName) || '';
    const normCode = normalizeCode(ggoCode);           // '07'

    map.once('idle', () => {
        if (reqId !== _highlightReqId) return; // a newer selection superseded this one

        const features = map.querySourceFeatures('odseki', { sourceLayer: 'odsek' });

        // Only look at features that already match the odsek ID.
        const candidates = features.filter(
            f => String(f.properties?.odsek ?? '') === String(odsekId)
        );
        if (!candidates.length) return; // tiles not loaded — keep odsek-only filter

        // 1. Try GGO name fields: compare tile value against the display name.
        for (const key of ['ggo_naziv', 'ggo_name']) {
            const hit = candidates.find(
                f => normalize(String(f.properties?.[key] ?? '')) === normalize(ggoName)
            );
            if (hit) {
                const tileVal = String(hit.properties[key]);
                _applyFilter(['all', odsekFilter, ['==', ['to-string', ['get', key]], tileVal]]);
                return;
            }
        }

        // 2. Try GGO code fields: compare normalised tile code against the GGO code.
        for (const key of ['ggo', 'ggo_id', 'ggo_sifra', 'ggo_code']) {
            const hit = candidates.find(f => {
                const v = String(f.properties?.[key] ?? '');
                return normalizeCode(v) === normCode && normCode !== '';
            });
            if (hit) {
                const tileVal = String(hit.properties[key]);
                _applyFilter(['all', odsekFilter, ['==', ['to-string', ['get', key]], tileVal]]);
                return;
            }
        }

        // No GGO field found in tiles — keep the odsek-only filter.
    });
}

/**
 * @param {string} odsekId
 * @param {'panel'|'manual'} source
 * @param {string|null} ggoNameOverride  - GGO name detected from tile props (overrides dropdown)
 * @param {object|null} featureGeometry  - GeoJSON geometry of the clicked tile feature
 */
async function selectOdsek(odsekId, source = 'panel', ggoNameOverride = null, featureGeometry = null) {
    const cleanId = String(odsekId || '').trim();
    if (!cleanId) return;

    // Prefer the GGO detected from the tile feature; fall back to the dropdown selection.
    const ggoName = ggoNameOverride || selectedGgoName();
    if (!ggoName) {
        selectedOdsekEl.textContent = 'Najprej izberi GGO.';
        return;
    }

    searchInput.value = cleanId;
    suggestionsEl.innerHTML = '';

    const payload = await fetchOdsekByKey(ggoName, cleanId);
    if (!payload || !payload.data) {
        selectedOdsekEl.textContent = `Odsek ${cleanId} v GGO '${ggoName}' ni najden.`;
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Ni podatkov za izbran odsek.';
        return;
    }

    selectedOdsekEl.textContent = `Izbran odsek: ${cleanId} | GGO: ${ggoName}`;
    renderDetailsTable(payload.data);

    // Apply the highlight filter immediately — MapLibre renders it correctly as tiles load.
    setHighlight(cleanId, ggoName);

    const duration = source === 'panel' ? 1700 : 700;

    // 1. Direct geometry from a map click — use the clicked feature's bbox to fly.
    if (featureGeometry) {
        const bbox = getBboxFromGeometry(featureGeometry);
        if (bbox) {
            map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 70, duration, maxZoom: 14 });
            return;
        }
    }

    // 2. Bbox from server — fly there.
    if (payload.bbox) {
        const b = payload.bbox;
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, duration, maxZoom: 14 });
        return;
    }

    // 3. Fallback: tile sweep.
    const ggoCode = String(payload.key?.ggo_code || selectedGgoCode() || '').trim();
    const moved = await locateOdsek(cleanId, ggoCode, ggoName, source);
    if (!moved) {
        console.warn('Odsek location could not be resolved:', cleanId, ggoName);
    }
}

ggoSelect.addEventListener('change', () => {
    const enabled = Boolean(selectedGgoName());
    setSearchEnabled(enabled);

    // Clear previously selected odsek whenever GGO changes.
    searchInput.value = '';
    suggestionsEl.innerHTML = '';
    clearHighlight();

    if (enabled) {
        selectedOdsekEl.textContent = `Izbran GGO: ${selectedGgoName()}`;
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Vnesi odsek in izberi predlog.';
        searchInput.focus();
    } else {
        selectedOdsekEl.textContent = 'Ni izbranega odseka.';
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Najprej izberi GGO, nato odsek.';
    }
});

searchInput.addEventListener('input', () => {
    const ggoName = selectedGgoName();
    const query = searchInput.value.trim();
    if (!ggoName || query.length < 1) {
        renderSuggestions([]);
        return;
    }
    fetchSuggestions(query, ggoName);
});

searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        selectOdsek(searchInput.value, 'manual').catch((err) => {
            console.error('selectOdsek failed', err);
        });
    }
});

searchBtn.addEventListener('click', () => {
    selectOdsek(searchInput.value, 'manual').catch((err) => {
        console.error('selectOdsek failed', err);
    });
});

suggestionsEl.addEventListener('click', (event) => {
    const button = event.target.closest('.suggestion-item');
    if (!button) return;
    selectOdsek(button.dataset.odsek, 'panel').catch((err) => {
        console.error('selectOdsek failed', err);
    });
});

map.on('load', () => {
    const initialBounds = map.getBounds();
    map.setMaxBounds(initialBounds);

    updateMonthStyle();
});

monthSlider.addEventListener('input', updateMonthStyle);

map.on('click', 'odseki-fill', (event) => {
    const feature = event.features?.[0];
    const props = feature?.properties || {};
    if (!props.odsek) return;

    const clickedOdsek = String(props.odsek);
    // Geometry of the clicked feature — used for direct map positioning so the map never
    // flies to a different GGO's odsek that happens to share the same odsek code.
    const geometry = feature?.geometry || null;

    // 1. Try to determine the GGO directly from the tile feature properties (tiles have ggo_naziv).
    const detectedGgoName = detectGgoNameFromProps(props);

    if (detectedGgoName) {
        // Sync the GGO dropdown and search bar to reflect the clicked feature.
        if (ggoSelect.value !== detectedGgoName && ggoCodeByName.has(detectedGgoName)) {
            ggoSelect.value = detectedGgoName;
            setSearchEnabled(true);
        }
        selectOdsek(clickedOdsek, 'manual', detectedGgoName, geometry).catch((err) => {
            console.error('selectOdsek failed', err);
        });
        return;
    }

    // 2. Tiles have no GGO field. If the user has a GGO selected in the dropdown, use it.
    if (selectedGgoName()) {
        selectOdsek(clickedOdsek, 'manual', null, geometry).catch((err) => {
            console.error('selectOdsek failed', err);
        });
        return;
    }

    // 3. No GGO context at all — fall back to the ambiguous lookup.
    fetchOdsekById(clickedOdsek).then((payload) => {
        if (!payload) return;

        if (payload.ambiguous) {
            selectedOdsekEl.textContent = `Odsek ${clickedOdsek} je v več GGO.`;
            detailsEl.classList.add('empty');
            detailsEl.textContent = 'Najprej izberi GGO v spustnem meniju, nato išči odsek.';
            return;
        }

        if (payload.data) {
            const fallbackGgoName = String(payload.data.ggo_naziv || '').trim();
            // Sync dropdown and search bar.
            if (fallbackGgoName && ggoCodeByName.has(fallbackGgoName)) {
                ggoSelect.value = fallbackGgoName;
                setSearchEnabled(true);
            }
            searchInput.value = clickedOdsek;
            selectedOdsekEl.textContent = `Izbran odsek: ${clickedOdsek} | GGO: ${fallbackGgoName}`;
            renderDetailsTable(payload.data);
            setHighlight(clickedOdsek, fallbackGgoName);
            const bbox = getBboxFromGeometry(geometry);
            if (bbox) {
                map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 70, duration: 700, maxZoom: 14 });
            }
        }
    });
});

map.on('mouseenter', 'odseki-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'odseki-fill', () => {
    map.getCanvas().style.cursor = '';
});

setSearchEnabled(false);
fetchGgoOptions();
