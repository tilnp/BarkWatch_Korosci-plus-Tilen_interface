const SLOVENIA_CENTER = [14.9955, 46.1512];
const INITIAL_ZOOM = 8;

// Animation speed preset. Choose one: ANIM_SLOW, ANIM_NORMAL, ANIM_FAST
const ANIM_SLOW   = { reset:  3600, panel:  3900, manual:  1700, sweep:  640 };
const ANIM_NORMAL   = { reset: 1800, panel: 2800, manual: 1200, sweep: 450 };
const ANIM_FAST = { reset:  900, panel: 1700, manual:  700, sweep: 260 };

let ANIM = ANIM_NORMAL;

// Mapping: CSV column name → display label shown in the details panel.
// To rename a field, change the value on the right. To reorder, move the entry.
const FIELD_LABELS = {
    ggo_naziv:      'Gozdnogospodarsko območje',
    odsek:          'Odsek ID',
    povrsina:       'Površina (ha)',
    gge_naziv:      'Gozdnogospodarska enota',
    ke_naziv:       'Krajevna enota',
    revir_naziv:    'Revir',
    katgozd_naziv:  'Kategorija gozda',
    ohranjen_naziv: 'Ohranjenost',
    relief_naziv:   'Relief',
    lega_naziv:     'Lega',
    pozar_naziv:    'Požarna ogroženost',
    intgosp_naziv:  'Intenzivnost gospodarjenja',
    krajime:        'Krajevno ime',
    grt1_naziv:     'Gozdni rastiščni tip',
};

const DISPLAY_FIELDS = Object.keys(FIELD_LABELS);

// Prikaz razčlenitve poseka po kategorijah (true) ali samo skupna količina (false)
const SHOW_ADVANCED_POSEK = false;

const HIGHLIGHT_SELECTED_ODSEK_BACKGROUND = false;

const TILE_URL = `${window.location.origin}/tiles/{z}/{x}/{y}`;

// Barve iz CSS spremenljivk — definirane enkrat v :root (styles.css)
const _css = getComputedStyle(document.documentElement);
const HEATMAP_COLORS = [0, 1, 2, 3, 4].map(i => _css.getPropertyValue(`--color-heatmap-${i}`).trim());
const COLOR_SLO_OUTLINE   = _css.getPropertyValue('--color-slo-outline').trim();
const COLOR_GGO_OUTLINE   = _css.getPropertyValue('--color-ggo-outline').trim();
const COLOR_ODSEKI_FILL   = _css.getPropertyValue('--color-odseki-fill').trim();
const COLOR_ODSEKI_BORDER = _css.getPropertyValue('--color-odseki-border').trim();

const map = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        sources: {
            satellite: {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                attribution: '© Esri World Imagery'
            },
            odseki: {
                type: 'vector',
                tiles: [TILE_URL],
                minzoom: 8,
                maxzoom: 14
            },
            ggo: {
                type: 'vector',
                tiles: [`${window.location.origin}/ggo-tiles/{z}/{x}/{y}`],
                minzoom: 0,
                maxzoom: 14
            },
            slovenija: {
                type: 'vector',
                tiles: [`${window.location.origin}/slo-tiles/{z}/{x}/{y}`],
                minzoom: 0,
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
                    'fill-color': COLOR_ODSEKI_FILL,
                    'fill-color-transition': { duration: 0, delay: 0 },
                    'fill-opacity': 0.45
                }
            },
            {
                id: 'odseki-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odsek',
                paint: {
                    'line-color': COLOR_ODSEKI_BORDER,
                    'line-width': 0.6,
                    'line-opacity': 0.75
                }
            },
            {
                id: 'slovenija-outline',
                type: 'line',
                source: 'slovenija',
                'source-layer': 'meja_maps',
                paint: {
                    'line-color': COLOR_SLO_OUTLINE,
                    'line-width': 2,
                    'line-opacity': 0.8
                }
            },
            {
                id: 'ggo-outline',
                type: 'line',
                source: 'ggo',
                'source-layer': 'ggo_maps',
                paint: {
                    'line-color': COLOR_GGO_OUTLINE,
                    'line-width': 2.5,
                    'line-opacity': 0.65,
                    'line-blur': 1.5
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

// Reset-view control (⌂)
map.addControl({
    onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.className = 'map-ctrl-btn';
        btn.title = 'Ponastavi pogled';
        btn.innerHTML = '⌂';
        btn.addEventListener('click', () => {
            map.flyTo({ center: SLOVENIA_CENTER, zoom: INITIAL_ZOOM, duration: ANIM.reset });
        });
        this._container.appendChild(btn);
        return this._container;
    },
    onRemove() { this._container.parentNode.removeChild(this._container); }
}, 'top-right');

// Animation speed control
const ANIM_PRESETS = [
    { anim: ANIM_SLOW,   label: '›',   title: 'Počasne animacije' },
    { anim: ANIM_NORMAL, label: '››',  title: 'Normalne animacije' },
    { anim: ANIM_FAST,   label: '›››', title: 'Hitre animacije' },
];
let _animIdx = ANIM_PRESETS.findIndex(p => p.anim === ANIM);
if (_animIdx < 0) _animIdx = 1;

map.addControl({
    onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.className = 'map-ctrl-btn';
        btn.style.fontWeight = '700';
        btn.style.letterSpacing = '-1px';
        const update = () => {
            const p = ANIM_PRESETS[_animIdx];
            btn.innerHTML = p.label;
            btn.title = p.title;
        };
        update();
        btn.addEventListener('click', () => {
            _animIdx = (_animIdx + 1) % ANIM_PRESETS.length;
            ANIM = ANIM_PRESETS[_animIdx].anim;
            update();
        });
        this._container.appendChild(btn);
        return this._container;
    },
    onRemove() { this._container.parentNode.removeChild(this._container); }
}, 'top-right');

// Legenda toggle
const legendBtn   = document.getElementById('legend-btn');
const legendPanel = document.getElementById('legend-panel');
legendBtn.addEventListener('click', () => legendPanel.classList.toggle('hidden'));

// Checkboxi za toggle mejnih layerjev
[
    { id: 'toggle-slo-outline', layer: 'slovenija-outline' },
    { id: 'toggle-ggo-outline', layer: 'ggo-outline' },
].forEach(({ id, layer }) => {
    document.getElementById(id).addEventListener('change', function () {
        map.setLayoutProperty(layer, 'visibility', this.checked ? 'visible' : 'none');
    });
});

// Help control (?) — added last so it appears at the bottom of the control stack
const helpModal = document.getElementById('help-modal');
document.getElementById('help-close').addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.add('hidden'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') helpModal.classList.add('hidden'); });

map.addControl({
    onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.className = 'map-ctrl-btn';
        btn.title = 'Navodila za uporabo';
        btn.innerHTML = '?';
        btn.style.fontWeight = '700';
        btn.addEventListener('click', () => helpModal.classList.remove('hidden'));
        this._container.appendChild(btn);
        return this._container;
    },
    onRemove() { this._container.parentNode.removeChild(this._container); }
}, 'top-right');

const ggoSelect = document.getElementById('ggo-select');
const searchInput = document.getElementById('odsek-search');
const searchBtn = document.getElementById('search-btn');
const suggestionsEl = document.getElementById('suggestions');
const selectedOdsekEl = document.getElementById('selected-odsek');
const detailsEl = document.getElementById('odsek-details');
const monthSlider = document.getElementById('month-slider');
const monthLabel  = document.getElementById('month-label');
const monthPrev   = document.getElementById('month-prev');
const monthNext   = document.getElementById('month-next');
const posekInfoEl = document.getElementById('posek-info');

// Heatmap state (napolni initHeatmap)
let heatmapMonths = [];
let forecastStartMonth = '';
const heatmapCache = new Map();
const HEATMAP_CACHE_LIMIT = 30;

// Trenutno izbran odsek (za posodabljanje poseka ob spremembi meseca)
let selectedOdsekId = '';

let suggestionsRequestCounter = 0;
const ggoCodeByName = new Map();
const ggoNameByCode = new Map(); // reverse: normalised code → ggo_naziv

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

const SL_MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'avg', 'sep', 'okt', 'nov', 'dec'];

function currentMonthString() {
    if (!heatmapMonths.length) return '';
    const idx = Math.max(0, Math.min(Number(monthSlider.value), heatmapMonths.length - 1));
    return heatmapMonths[idx];
}

function buildHeatmapExpression(buckets) {
    // Tiles vsebujejo samo lastnost 'odsek' — ujemamo direktno po odsek_id.
    const args = ['match', ['to-string', ['get', 'odsek']]];
    for (const [odsek, bucket] of Object.entries(buckets)) {
        args.push(odsek, HEATMAP_COLORS[bucket] ?? HEATMAP_COLORS[0]);
    }
    args.push(HEATMAP_COLORS[0]); // privzeto: ni aktivnosti
    return args;
}

function updateMonthLabel() {
    const m = currentMonthString();
    if (!m) { monthLabel.textContent = '–'; return; }
    const [year, monthNum] = m.split('-');
    monthLabel.textContent = `${SL_MONTHS[parseInt(monthNum, 10) - 1] ?? ''} ${year}`;
    const isForecast = forecastStartMonth ? m >= forecastStartMonth : false;
    monthSlider.classList.toggle('slider-forecast', isForecast);
    monthSlider.classList.toggle('slider-historical', !isForecast);
    const idx = Number(monthSlider.value);
    monthPrev.disabled = idx <= Number(monthSlider.min);
    monthNext.disabled = idx >= Number(monthSlider.max);
}

async function applyMonthColor() {
    const m = currentMonthString();
    if (!m) return;
    let buckets = heatmapCache.get(m);
    if (!buckets) {
        try {
            const resp = await fetch(`/api/heatmap?month=${encodeURIComponent(m)}`);
            if (!resp.ok) return;
            buckets = await resp.json();
            if (heatmapCache.size >= HEATMAP_CACHE_LIMIT) {
                heatmapCache.delete(heatmapCache.keys().next().value);
            }
            heatmapCache.set(m, buckets);
        } catch (e) {
            console.error('Heatmap fetch failed:', m, e);
            return;
        }
    }
    if (map.getLayer('odseki-fill')) {
        map.setPaintProperty('odseki-fill', 'fill-color', buildHeatmapExpression(buckets));
    }
    // Posodobi posek za trenutno izbran odsek
    if (selectedOdsekId) {
        fetchAndShowPosek(selectedOdsekId, m).catch(() => {});
    }
}

async function fetchAndShowPosek(odsekId, month) {
    if (!odsekId || !month) { posekInfoEl.classList.add('hidden'); return; }
    try {
        const resp = await fetch(
            `/api/posek?odsek=${encodeURIComponent(odsekId)}&month=${encodeURIComponent(month)}`
        );
        if (!resp.ok) { posekInfoEl.classList.add('hidden'); return; }
        const data = await resp.json();
        renderPosekInfo(data, month);
    } catch (e) {
        posekInfoEl.classList.add('hidden');
    }
}

function renderPosekInfo(data, month) {
    const [year, mon] = month.split('-');
    const label = `${SL_MONTHS[parseInt(mon, 10) - 1] ?? ''} ${year}`;

    if (data.total_kubikov === 0) {
        posekInfoEl.classList.remove('hidden');
        posekInfoEl.innerHTML =
            `<div class="posek-title">Posek — ${label}</div>` +
            `<div class="posek-none">Ni evidentiranega poseka.</div>`;
        return;
    }

    const breakdown = SHOW_ADVANCED_POSEK
        ? `<div class="posek-breakdown">${
            Object.entries(data.by_vzrok)
                .map(([vzrok, kub]) => `<div>${vzrok}: <b>${kub.toLocaleString('sl-SI')} m³</b></div>`)
                .join('')
          }</div>`
        : '';

    posekInfoEl.classList.remove('hidden');
    posekInfoEl.innerHTML =
        `<div class="posek-title">Posek — ${label}</div>` +
        `<div class="posek-total">${data.total_kubikov.toLocaleString('sl-SI')} m³</div>` +
        breakdown;
}

async function initHeatmap() {
    try {
        const resp = await fetch('/api/heatmap/meta');
        if (!resp.ok) return;
        const meta = await resp.json();
        heatmapMonths = meta.months || [];
        forecastStartMonth = meta.forecast_start || '';
        if (!heatmapMonths.length) return;

        monthSlider.min = '0';
        monthSlider.max = String(heatmapMonths.length - 1);

        // Privzeto: zadnji mesec pred napovedmi
        let defaultIdx = heatmapMonths.length - 1;
        if (forecastStartMonth) {
            const fIdx = heatmapMonths.indexOf(forecastStartMonth);
            if (fIdx > 0) defaultIdx = fIdx - 1;
        }
        monthSlider.value = String(defaultIdx);
        updateMonthLabel();
        await applyMonthColor();
    } catch (e) {
        console.error('Heatmap init failed:', e);
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
        { padding: 70, duration: ANIM.panel, maxZoom: 14 }
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
            map.easeTo({ center, zoom: INITIAL_ZOOM, duration: ANIM.sweep });
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
            { padding: 70, duration: ANIM.manual, maxZoom: 14 }
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
        const label = FIELD_LABELS[field] ?? field;
        const value = data[field] ?? '';
        return `<tr><th>${label}</th><td>${String(value) || '-'}</td></tr>`;
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
    if (HIGHLIGHT_SELECTED_ODSEK_BACKGROUND) {
        if (map.getLayer('odseki-selected-fill'))    map.setFilter('odseki-selected-fill',    f);
    }
    if (map.getLayer('odseki-selected-outline')) map.setFilter('odseki-selected-outline', f);
}

/** Clear the highlight layers. */
function clearHighlight() {
    ++_highlightReqId;
    _applyFilter(NEVER_MATCH);
    selectedOdsekId = '';
    posekInfoEl.classList.add('hidden');
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
    selectedOdsekId = cleanId;
    renderDetailsTable(payload.data);
    fetchAndShowPosek(cleanId, currentMonthString()).catch(() => {});

    // Apply the highlight filter immediately — MapLibre renders it correctly as tiles load.
    setHighlight(cleanId, ggoName);

    const duration = source === 'panel' ? ANIM.panel : ANIM.manual;

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
    const items = Array.from(suggestionsEl.querySelectorAll('.suggestion-item'));
    const active = suggestionsEl.querySelector('.suggestion-item.active');
    const idx = active ? items.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!items.length) return;
        if (active) active.classList.remove('active');
        const next = items[(idx + 1) % items.length];
        next.classList.add('active');
        next.scrollIntoView({ block: 'nearest' });
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!items.length) return;
        if (active) active.classList.remove('active');
        const prev = items[(idx - 1 + items.length) % items.length];
        prev.classList.add('active');
        prev.scrollIntoView({ block: 'nearest' });
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (active) {
            selectOdsek(active.dataset.odsek, 'panel').catch((err) => {
                console.error('selectOdsek failed', err);
            });
        } else {
            selectOdsek(searchInput.value, 'manual').catch((err) => {
                console.error('selectOdsek failed', err);
            });
        }
        return;
    }

    if (event.key === 'Escape') {
        if (active) active.classList.remove('active');
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

// Fiksne meje malce izven Slovenije — neodvisno od velikosti okna ob zagonu
const SLOVENIA_MAX_BOUNDS = [[12.0, 44.8], [17.8, 47.5]];

map.on('load', () => {
    map.setMaxBounds(SLOVENIA_MAX_BOUNDS);

    initHeatmap().catch(console.error);
});

let _colorDebounce = null;

function stepMonth(delta) {
    const cur = Number(monthSlider.value);
    const next = Math.max(Number(monthSlider.min), Math.min(Number(monthSlider.max), cur + delta));
    if (next === cur) return;
    monthSlider.value = String(next);
    updateMonthLabel();
    clearTimeout(_colorDebounce);
    applyMonthColor().catch(console.error);
}

monthPrev.addEventListener('click', () => stepMonth(-1));
monthNext.addEventListener('click', () => stepMonth(1));

monthSlider.addEventListener('input', () => {
    updateMonthLabel();
    clearTimeout(_colorDebounce);
    _colorDebounce = setTimeout(() => applyMonthColor().catch(console.error), 300);
});

// 'change' se sproži ob spustu miške — takrat posodobimo barve takoj
monthSlider.addEventListener('change', () => {
    clearTimeout(_colorDebounce);
    applyMonthColor().catch(console.error);
});

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
            selectedOdsekId = clickedOdsek;
            renderDetailsTable(payload.data);
            fetchAndShowPosek(clickedOdsek, currentMonthString()).catch(() => {});
            setHighlight(clickedOdsek, fallbackGgoName);
            const bbox = getBboxFromGeometry(geometry);
            if (bbox) {
                map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 70, duration: ANIM.manual, maxZoom: 14 });
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
