const SLOVENIA_CENTER = [14.9955, 46.1512];
const INITIAL_ZOOM = 8;

// Zoom level at which GGE coloring fades out and individual odsek coloring takes over.
// Increase to keep GGE visible longer when zooming in; decrease to switch earlier.
const GGE_TO_ODSEK_ZOOM = 11;

// Maximum number of map-position history entries for back/forward navigation.
const MAX_HISTORY = 30;

// Animation speed preset. Choose one: ANIM_SLOW, ANIM_NORMAL, ANIM_FAST
const ANIM_SLOW   = { reset:  3600, panel:  3900, manual:  1700, sweep:  640, pitch: 2800 };
const ANIM_NORMAL   = { reset: 1800, panel: 2800, manual: 1200, sweep: 450, pitch: 1500 };
const ANIM_FAST = { reset:  900, panel: 1700, manual:  700, sweep: 260, pitch: 700 };

let ANIM = ANIM_NORMAL;

// Mapping: CSV column name → display label shown in the details panel.
// To rename a field, change the value on the right. To reorder, move the entry.
const FIELD_LABELS = {
    povrsina:       'Površina (ha)',
    gge_naziv:      'Gozdnogospodarska enota',
    ke_naziv:       'Krajevna enota',
    revir_naziv:    'Revir',
    revirni:        'Revirni gozdar',
    eposta:         'Kontakt',
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

const HIGHLIGHT_SELECTED_ODSEK_BACKGROUND = false;
const HIGHLIGHT_SELECTED_GGE_BACKGROUND = false;

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
                minzoom: 9,
                maxzoom: 14
            },
            gge: {
                type: 'vector',
                tiles: [`${window.location.origin}/gge-tiles/{z}/{x}/{y}`],
                minzoom: 0,
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
                id: 'gge-fill',
                type: 'fill',
                source: 'gge',
                'source-layer': 'gge_vektor',
                layout: { visibility: INITIAL_ZOOM < GGE_TO_ODSEK_ZOOM ? 'visible' : 'none' },
                paint: {
                    'fill-color': COLOR_ODSEKI_FILL,
                    'fill-color-transition': { duration: 0, delay: 0 },
                    'fill-opacity': 0.55
                }
            },
            {
                id: 'odseki-fill',
                type: 'fill',
                source: 'odseki',
                'source-layer': 'odseki_map_ggo_gge',
                layout: { visibility: INITIAL_ZOOM >= GGE_TO_ODSEK_ZOOM ? 'visible' : 'none' },
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
                'source-layer': 'odseki_map_ggo_gge',
                paint: {
                    'line-color': COLOR_ODSEKI_BORDER,
                    'line-width': 0.6,
                    'line-opacity': 0.75
                }
            },
            {
                id: 'gge-outline',
                type: 'line',
                source: 'gge',
                'source-layer': 'gge_vektor',
                paint: {
                    'line-color': COLOR_ODSEKI_BORDER,
                    'line-width': 0.8,
                    'line-opacity': 0.6
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
                // Invisible fill used only for queryRenderedFeatures GGO hit-testing.
                id: 'ggo-fill-hidden',
                type: 'fill',
                source: 'ggo',
                'source-layer': 'ggo_maps',
                paint: { 'fill-opacity': 0 }
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
                id: 'gge-selected-fill',
                type: 'fill',
                source: 'gge',
                'source-layer': 'gge_vektor',
                filter: ['==', ['literal', false], true],
                paint: {
                    'fill-color': '#60cdee',
                    'fill-opacity': 0.18
                }
            },
            {
                id: 'gge-selected-outline',
                type: 'line',
                source: 'gge',
                'source-layer': 'gge_vektor',
                filter: ['==', ['literal', false], true],
                paint: {
                    'line-color': '#60cdee',
                    'line-width': 2.5,
                    'line-opacity': 1
                }
            },
            {
                id: 'odseki-selected-fill',
                type: 'fill',
                source: 'odseki',
                'source-layer': 'odseki_map_ggo_gge',
                filter: ['==', ['literal', false], true],
                paint: {
                    'fill-color': '#2563eb',
                    'fill-opacity': 0.25
                }
            },
            {
                id: 'odseki-selected-outline',
                type: 'line',
                source: 'odseki',
                'source-layer': 'odseki_map_ggo_gge',
                filter: ['==', ['literal', false], true],
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
    maxZoom: 16,
    maxPitch: 70
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

// Pitch (3D tilt) control — drag up/down to adjust angle, click to reset to 2D
map.addControl({
    onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const btn = document.createElement('button');
        btn.className = 'map-ctrl-btn';
        btn.style.cursor = 'grab';
        const update = (targetPitch) => {
            const p = targetPitch ?? Math.round(map.getPitch());
            btn.title = p > 1 ? `Kot pogleda: ${p}°` : 'Povleci za 3D pogled';
            btn.innerHTML = p > 1 ? '3D' : '2D';
        };
        update();
        map.on('pitch', () => update());

        let startY = null;
        let startPitch = null;
        let dragged = false;

        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startY = e.clientY;
            startPitch = map.getPitch();
            dragged = false;
            map.dragPan.disable();

            const onMove = (e) => {
                const delta = startY - e.clientY;
                if (Math.abs(delta) > 3) dragged = true;
                const pitch = Math.max(0, Math.min(85, startPitch + delta * 0.5));
                map.setPitch(pitch);
            };
            const onUp = () => {
                map.dragPan.enable();
                if (!dragged) {
                    const target = map.getPitch() > 1 ? 0 : 60;
                    update(target);
                    map.easeTo({ pitch: target, duration: ANIM.pitch });
                }
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        this._container.appendChild(btn);
        return this._container;
    },
    onRemove() { this._container.parentNode.removeChild(this._container); }
}, 'top-right');

// ── Map position history (back / forward) ────────────────────────
let _mapHistory = [];
let _histIdx    = -1;
let _navHistory       = false; // true while animating through history — suppresses recording
let _dragSnapSuppress = false; // true while any mouse button is held
let _pendingDragSnap  = false; // moveend fired during drag — push snap on mouseup

function _snapNow() {
    return {
        center:  map.getCenter().toArray(),
        zoom:    map.getZoom(),
        bearing: map.getBearing(),
        pitch:   map.getPitch(),
        odsekId:    selectedOdsekId,
        ggoName:    selectedGgoName(),
        ggeName:    _selectedGgeName,
        ggeGgoName: _selectedGgeGgoName,
    };
}

function _pushInitialSnap() {
    const snap = {
        center:  SLOVENIA_CENTER,
        zoom:    INITIAL_ZOOM,
        bearing: 0,
        pitch:   0,
        odsekId: '',
        ggoName: '',
    };
    _mapHistory = [snap];
    _histIdx = 0;
    _updateHistBtns();
}

function _restoreSnap(s) {
    _navHistory = true;
    if (s.odsekId) {
        if (s.ggoName) ggoSelect.value = s.ggoName;
        setSearchEnabled(Boolean(s.ggoName));
        selectOdsek(s.odsekId, 'panel', s.ggoName || null, { bearing: s.bearing, pitch: s.pitch })
            .catch(console.error)
            .finally(() => {
                map.once('moveend', () => { _navHistory = false; });
            });
    } else {
        map.easeTo({ center: s.center, zoom: s.zoom, bearing: s.bearing, pitch: s.pitch, duration: ANIM.manual });
        map.once('moveend', () => {
            _navHistory = false;
            clearHighlight();
            if (s.ggeName) setGgeHighlight(s.ggeGgoName || null, s.ggeName);
            if (!s.ggoName) ggoSelect.value = '';
        });
    }
}

let _histBtnBack, _histBtnFwd;
function _updateHistBtns() {
    if (!_histBtnBack) return;
    _histBtnBack.disabled = _histIdx <= 0;
    _histBtnFwd.disabled  = _histIdx >= _mapHistory.length - 1;
}

function _pushSnap() {
    const snap = _snapNow();
    _mapHistory = _mapHistory.slice(0, _histIdx + 1);
    _mapHistory.push(snap);
    if (_mapHistory.length > MAX_HISTORY) _mapHistory.shift();
    _histIdx = _mapHistory.length - 1;
    _updateHistBtns();
}

map.on('moveend', () => {
    if (_navHistory) return;
    if (_dragSnapSuppress) { _pendingDragSnap = true; return; }
    _pushSnap();
});

window.addEventListener('mousedown', () => {
    _dragSnapSuppress = true;
    _pendingDragSnap  = false;
});
window.addEventListener('mouseup', () => {
    _dragSnapSuppress = false;
    if (_pendingDragSnap && !_navHistory) {
        _pendingDragSnap = false;
        _pushSnap();
    }
});

map.addControl({
    onAdd() {
        this._container = document.createElement('div');
        this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

        _histBtnBack = document.createElement('button');
        _histBtnBack.className = 'map-ctrl-btn';
        _histBtnBack.title = 'Nazaj';
        _histBtnBack.innerHTML = '←';
        _histBtnBack.disabled = true;
        _histBtnBack.addEventListener('click', () => {
            if (_histIdx <= 0) return;
            _histIdx--;
            _restoreSnap(_mapHistory[_histIdx]);
            _updateHistBtns();
        });

        _histBtnFwd = document.createElement('button');
        _histBtnFwd.className = 'map-ctrl-btn';
        _histBtnFwd.title = 'Naprej';
        _histBtnFwd.innerHTML = '→';
        _histBtnFwd.disabled = true;
        _histBtnFwd.addEventListener('click', () => {
            if (_histIdx >= _mapHistory.length - 1) return;
            _histIdx++;
            _restoreSnap(_mapHistory[_histIdx]);
            _updateHistBtns();
        });

        this._container.appendChild(_histBtnBack);
        this._container.appendChild(_histBtnFwd);
        return this._container;
    },
    onRemove() { this._container.parentNode.removeChild(this._container); }
}, 'top-right');

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
            resetPanel();
            _updateZoomVisibility(INITIAL_ZOOM);   // pre-apply GGE view so tiles load during flight
            applyMonthColor().catch(console.error); // refresh colors for GGE layer immediately
            map.flyTo({ center: SLOVENIA_CENTER, zoom: INITIAL_ZOOM, bearing: 0, pitch: 0, duration: ANIM.reset });
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

// Custom dropdown adapter — exposes the same API as a native <select> so the
// rest of the code (.value, .innerHTML, .appendChild, .addEventListener) works unchanged.
const ggoSelect = (() => {
    const trigger  = document.getElementById('ggo-select-trigger');
    const display  = document.getElementById('ggo-select-display');
    const list     = document.getElementById('ggo-select-list');
    const PLACEHOLDER = '-- izberite GGO --';

    let _value = '';
    const _changeListeners = [];

    // ── helpers ─────────────────────────────────────────────────────────────
    function open() {
        list.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        // scroll selected option into view
        list.querySelector('.ggo-select-option.selected')?.scrollIntoView({ block: 'nearest' });
    }

    function close() {
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        clearHighlighted();
    }

    function clearHighlighted() {
        list.querySelectorAll('.ggo-select-option.highlighted').forEach(o => o.classList.remove('highlighted'));
    }

    function getOptions() {
        return [...list.querySelectorAll('.ggo-select-option')];
    }

    function highlightAt(idx) {
        const opts = getOptions();
        opts.forEach((o, i) => o.classList.toggle('highlighted', i === idx));
        opts[idx]?.scrollIntoView({ block: 'nearest' });
    }

    function highlightedIndex() {
        return getOptions().findIndex(o => o.classList.contains('highlighted'));
    }

    function commitSelect(value, text) {
        _value = value;
        display.textContent = value ? text : PLACEHOLDER;
        trigger.classList.toggle('ggo-placeholder', !value);
        getOptions().forEach(o => o.classList.toggle('selected', o.dataset.value === value));
        close();
        trigger.focus();
        _changeListeners.forEach(fn => fn());
    }

    function makeOptionEl(value, text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ggo-select-option';
        btn.dataset.value = value;
        btn.textContent = text;
        btn.addEventListener('mouseenter', () => {
            clearHighlighted();
            btn.classList.add('highlighted');
        });
        btn.addEventListener('mouseleave', () => btn.classList.remove('highlighted'));
        btn.addEventListener('click', () => commitSelect(value, text));
        return btn;
    }

    // ── events ───────────────────────────────────────────────────────────────
    trigger.addEventListener('click', () => list.hidden ? open() : close());

    // All keyboard handling stays on the trigger so focus never leaves it.
    trigger.addEventListener('keydown', (e) => {
        const isOpen = !list.hidden;
        const opts   = getOptions();
        const idx    = highlightedIndex();

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) {
                open();
                highlightAt(Math.max(0, opts.findIndex(o => o.dataset.value === _value)));
            } else {
                highlightAt(Math.min(idx + 1, opts.length - 1));
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (isOpen) highlightAt(Math.max(idx - 1, 0));
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isOpen) {
                open();
                highlightAt(Math.max(0, opts.findIndex(o => o.dataset.value === _value)));
            } else {
                const highlighted = opts[idx];
                if (highlighted) commitSelect(highlighted.dataset.value, highlighted.textContent);
            }
        } else if (e.key === 'Escape') {
            if (isOpen) close();
        } else if (e.key === 'Tab') {
            if (isOpen) close();
        }
    });

    document.addEventListener('click', (e) => {
        if (!trigger.closest('#ggo-select-custom').contains(e.target)) close();
    });

    // ── public API (mirrors native <select>) ─────────────────────────────────
    return {
        get value() { return _value; },

        set value(v) {
            const opt = getOptions().find(o => o.dataset.value === v);
            _value = (v === '' || opt) ? v : _value;
            display.textContent = opt ? opt.textContent : PLACEHOLDER;
            trigger.classList.toggle('ggo-placeholder', !_value);
            getOptions().forEach(o => o.classList.toggle('selected', o.dataset.value === _value));
        },

        // Called as: ggoSelect.innerHTML = '<option value="">...</option>'  (reset)
        set innerHTML(_html) {
            _value = '';
            display.textContent = PLACEHOLDER;
            trigger.classList.add('ggo-placeholder');
            list.innerHTML = '';
        },

        // Called as: ggoSelect.appendChild(optionEl)  (populate)
        appendChild(optionEl) {
            if (!optionEl.value) return; // skip placeholder <option value="">
            list.appendChild(makeOptionEl(optionEl.value, optionEl.textContent));
        },

        addEventListener(event, fn) {
            if (event === 'change') _changeListeners.push(fn);
        },
    };
})();
const searchInput = document.getElementById('odsek-search');
const searchBtn = document.getElementById('search-btn');
const suggestionsEl = document.getElementById('suggestions');
const selectedOdsekEl = document.getElementById('selected-odsek');
const detailsEl = document.getElementById('odsek-details');
const monthSlider = document.getElementById('month-slider');
const monthLabel  = document.getElementById('month-label');
const monthPrev   = document.getElementById('month-prev');
const monthNext   = document.getElementById('month-next');
const heatmapInfoEl = document.getElementById('posek-info');

// Heatmap state (napolni initHeatmap)
let heatmapMonths = [];
let forecastStartMonth = '';
const heatmapCache = new Map();
const ggeCache = new Map();
const HEATMAP_CACHE_LIMIT = 30;

// Dataset toggle: 'real' | 'synthetic'
let currentDataset = 'real';
const datasetBtnReal      = document.getElementById('dataset-btn-real');
const datasetBtnSynthetic = document.getElementById('dataset-btn-synthetic');

function setDataset(dataset) {
    if (dataset === currentDataset) return;
    // Remember current month string so we can restore it after switching datasets
    const preservedMonth = currentMonthString();
    currentDataset = dataset;
    datasetBtnReal.classList.toggle('dataset-btn-active', dataset === 'real');
    datasetBtnSynthetic.classList.toggle('dataset-btn-active', dataset === 'synthetic');
    // Update legend labels based on dataset
    updateLegendForDataset(dataset);
    // Clear caches so next render fetches fresh data for the new dataset
    heatmapCache.clear();
    ggeCache.clear();
    // Reload slider range and colours, restoring the previously viewed month if possible
    initHeatmap(preservedMonth).catch(console.error);
}

function updateLegendForDataset(dataset) {
    const sectionTitle = document.querySelector('.legend-section-title');
    const legendRows = document.querySelectorAll('.legend-rows')[0]?.querySelectorAll('.legend-row');
    if (!sectionTitle || !legendRows) return;
    if (dataset === 'synthetic') {
        sectionTitle.textContent = 'ŠTEVILO PODLUBNIKOV';
        const labels = ['Brez', 'Nizko', 'Srednje', 'Visoko', 'Zelo visoko'];
        legendRows.forEach((row, i) => {
            const swatch = row.querySelector('.legend-swatch');
            if (swatch) row.innerHTML = '';
            if (swatch) row.appendChild(swatch);
            row.appendChild(document.createTextNode(labels[i]));
        });
    } else {
        sectionTitle.textContent = 'Aktivnost podlubnika';
        const labels = ['Brez aktivnosti', 'Nizka', 'Srednja', 'Visoka', 'Zelo visoka'];
        legendRows.forEach((row, i) => {
            const swatch = row.querySelector('.legend-swatch');
            if (swatch) row.innerHTML = '';
            if (swatch) row.appendChild(swatch);
            row.appendChild(document.createTextNode(labels[i]));
        });
    }
}

datasetBtnReal.addEventListener('click', () => setDataset('real'));
datasetBtnSynthetic.addEventListener('click', () => setDataset('synthetic'));

// Trenutno izbran odsek (za posodabljanje poseka ob spremembi meseca)
let selectedOdsekId = '';

let suggestionsRequestCounter = 0;
const ggoCodeByName = new Map();
const ggoNameByCode = new Map(); // reverse: normalised code → ggo_naziv

function normalize(v) {
    return String(v ?? '').trim();
}

/** Normalise an odsek ID for internal use: strip surrounding whitespace only.
 *  Spaces inside the ID are a distinct character (not equal to '0') and must
 *  be preserved exactly as they appear in the database. */
function canonicalOdsekId(id) {
    return String(id ?? '').trim();
}

/** Return the ID in the form used for UI display and tile filters.
 *  Spaces inside odsek IDs are meaningful, so the ID is returned as-is. */
function displayOdsekId(id) {
    return String(id ?? '').trim();
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
        searchInput.placeholder = 'Najprej izberite GGO';
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

function buildHeatmapExpression(buckets, key = 'odsek') {
    const args = ['match', ['to-string', ['get', key]]];
    for (const [id, bucket] of Object.entries(buckets)) {
        args.push(id, HEATMAP_COLORS[bucket] ?? HEATMAP_COLORS[0]);
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
            const resp = await fetch(`/api/heatmap?month=${encodeURIComponent(m)}&dataset=${currentDataset}`);
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
    if (selectedOdsekId) {
        fetchAndShowHeatmapValue(selectedOdsekId, m, selectedGgoName()).catch(() => {});
    }

    // GGE coloring — fetch and apply regardless of current zoom so it's ready when switching
    let ggeBuckets = ggeCache.get(m);
    if (!ggeBuckets) {
        try {
            const ggeResp = await fetch(`/api/heatmap/gge?month=${encodeURIComponent(m)}&dataset=${currentDataset}`);
            if (ggeResp.ok) {
                ggeBuckets = await ggeResp.json();
                if (ggeCache.size >= HEATMAP_CACHE_LIMIT) {
                    ggeCache.delete(ggeCache.keys().next().value);
                }
                ggeCache.set(m, ggeBuckets);
            }
        } catch (e) {
            console.error('GGE heatmap fetch failed:', m, e);
        }
    }
    if (ggeBuckets && map.getLayer('gge-fill')) {
        // Tiles now carry ggo_naziv — use compound key ggo\x00gge so same-name GGEs in
        // different GGOs receive their own correct bucket colour.
        const ggeKeyExpr = ['concat', ['get', 'ggo_naziv'], '\x00', ['get', 'gge_naziv']];
        const args = ['match', ggeKeyExpr];
        for (const [id, bucket] of Object.entries(ggeBuckets)) {
            args.push(id, HEATMAP_COLORS[bucket] ?? HEATMAP_COLORS[0]);
        }
        args.push(HEATMAP_COLORS[0]);
        map.setPaintProperty('gge-fill', 'fill-color', args);
    }
}

async function fetchAndShowHeatmapValue(odsekId, month, ggoName = '') {
    if (!odsekId || !month) { heatmapInfoEl.classList.add('hidden'); return; }
    try {
        const ggoParam = ggoName ? `&ggo=${encodeURIComponent(ggoName)}` : '';
        const resp = await fetch(
            `/api/heatmap/value?odsek=${encodeURIComponent(odsekId)}&month=${encodeURIComponent(month)}${ggoParam}&dataset=${currentDataset}`
        );
        if (!resp.ok) { heatmapInfoEl.classList.add('hidden'); return; }
        const data = await resp.json();
        renderHeatmapValue(data, month);
    } catch (e) {
        heatmapInfoEl.classList.add('hidden');
    }
}

const ANALYZE_BTN_HTML = '<button class="posek-analyze-btn" type="button">Analiziraj</button>';

function renderHeatmapValue(data, month) {
    const [year, mon] = month.split('-');
    const label = `${SL_MONTHS[parseInt(mon, 10) - 1] ?? ''} ${year}`;
    const isSynthetic = currentDataset === 'synthetic';
    const sectionTitle = isSynthetic ? 'Število podlubnikov' : 'Posek';
    const noDataMsg = isSynthetic ? 'Ni podatkov o podlubnikih.' : 'Ni podatkov o poseku.';

    if (!data.has_data) {
        heatmapInfoEl.classList.remove('hidden');
        heatmapInfoEl.innerHTML =
            `<div class="posek-header"><div class="posek-title">${sectionTitle} — ${label}</div>${ANALYZE_BTN_HTML}</div>` +
            `<div class="posek-none">${noDataMsg}</div>`;
        return;
    }

    const absStr = data.target != null
        ? isSynthetic
            ? `${data.target.toLocaleString('sl-SI', {maximumFractionDigits: 2})} podlubnik/m²`
            : `${data.target.toLocaleString('sl-SI', {maximumFractionDigits: 2})} m³`
        : '—';
    const relStr = data.relative != null
        ? isSynthetic
            ? ``
            : `${data.relative.toLocaleString('sl-SI', {maximumFractionDigits: 2})} m³/ha`
        : '—';

    heatmapInfoEl.classList.remove('hidden');
    heatmapInfoEl.innerHTML =
        `<div class="posek-header"><div class="posek-title">${sectionTitle} — ${label}</div>${ANALYZE_BTN_HTML}</div>` +
        `<div class="posek-total">${absStr}</div>` +
        `<div class="posek-relative">${relStr}</div>`;
}

// ── Analysis modal ────────────────────────────────────────────────────────────

const analysisModal    = document.getElementById('analysis-modal');
const analysisClose    = document.getElementById('analysis-close');
const analysisSubtitle = document.getElementById('analysis-subtitle');

let _analysisChart = null;

function closeAnalysisModal() {
    analysisModal.classList.add('hidden');
    if (_analysisChart) { _analysisChart.destroy(); _analysisChart = null; }
}

analysisClose.addEventListener('click', closeAnalysisModal);
analysisModal.addEventListener('click', e => { if (e.target === analysisModal) closeAnalysisModal(); });
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !analysisModal.classList.contains('hidden')) closeAnalysisModal();
});

// Click delegation — button lives inside heatmapInfoEl (set via innerHTML).
heatmapInfoEl.addEventListener('click', e => {
    if (e.target.closest('.posek-analyze-btn')) openAnalysisModal();
});

const SL_MONTHS_FULL = ['Januar','Februar','Marec','April','Maj','Junij','Julij','Avgust','September','Oktober','November','December'];

async function openAnalysisModal() {
    const odsekId = selectedOdsekId;
    const ggoName = selectedGgoName();
    if (!odsekId) return;

    analysisModal.classList.remove('hidden');
    document.getElementById('analysis-modal-title').textContent =
        currentDataset === 'synthetic' ? 'Število podlubnikov skozi čas' : 'Posek skozi čas';
    analysisSubtitle.textContent = `Odsek ${odsekId}${ggoName ? ' · GGO ' + ggoName : ''}`;
    if (_analysisChart) { _analysisChart.destroy(); _analysisChart = null; }

    try {
        const ggoParam = ggoName ? `&ggo=${encodeURIComponent(ggoName)}` : '';
        const resp = await fetch(
            `/api/heatmap/odsek-series?odsek=${encodeURIComponent(odsekId)}${ggoParam}&dataset=${currentDataset}`
        );
        if (!resp.ok) throw new Error('fetch failed');
        const data = await resp.json();

        const { series, forecast_start } = data;

        // X-axis: one label per month (bar chart needs a label for every bar),
        // but only show the year text for January (or the very first point).
        const labels = series.map((s, i) => {
            const [yr, mo] = s.month.split('-');
            return (mo === '01' || i === 0) ? yr : '';
        });

        const values = series.map(s => s.target ?? 0);
        const colors = series.map(s =>
            forecast_start && s.month >= forecast_start ? '#f97316' : '#166534'
        );

        const canvas = document.getElementById('analysis-chart');
        _analysisChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderRadius: 3,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => {
                                const s = series[items[0].dataIndex];
                                const [yr, mo] = s.month.split('-');
                                return `${SL_MONTHS_FULL[parseInt(mo, 10) - 1] ?? ''} ${yr}`;
                            },
                            label: ctx => {
                                const s = series[ctx.dataIndex];
                                const isSyn = currentDataset === 'synthetic';
                                const abs = s.has_data
                                    ? isSyn
                                        ? `${s.target.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} podlubnik/m²`
                                        : `${s.target.toLocaleString('sl-SI', { maximumFractionDigits: 1 })} m³`
                                    : 'Ni podatkov';
                                const rel = s.relative != null
                                    ? isSyn
                                        ? ''
                                        : `  (${s.relative.toLocaleString('sl-SI', { maximumFractionDigits: 4 })} m³/ha)`
                                    : '';
                                return abs + rel;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxRotation: 0,
                            font: { size: 11 },
                            autoSkip: false,
                            // Return undefined for empty-string labels so Chart.js
                            // draws the tick mark but omits the text.
                            callback: (_val, idx) => labels[idx] || undefined,
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: currentDataset === 'synthetic' ? 'Število podlubnikov (podlubnik/m²)' : 'Posek (m³)', font: { size: 11 } },
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        ticks: { font: { size: 11 } }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Analysis fetch failed:', e);
    }
}

async function initHeatmap(preserveMonth = '') {
    try {
        const resp = await fetch(`/api/heatmap/meta?dataset=${currentDataset}`);
        if (!resp.ok) return;
        const meta = await resp.json();
        heatmapMonths = meta.months || [];
        forecastStartMonth = meta.forecast_start || '';
        if (!heatmapMonths.length) return;

        monthSlider.min = '0';
        monthSlider.max = String(heatmapMonths.length - 1);

        let defaultIdx;
        if (preserveMonth) {
            // Try to land on the same calendar month after switching datasets
            const exactIdx = heatmapMonths.indexOf(preserveMonth);
            if (exactIdx >= 0) {
                defaultIdx = exactIdx;
            } else {
                // Find the closest month that is <= preserveMonth
                const before = heatmapMonths.filter(m => m <= preserveMonth);
                defaultIdx = before.length
                    ? heatmapMonths.indexOf(before[before.length - 1])
                    : 0;
            }
        } else {
            // Privzeto: zadnji mesec pred napovedmi
            defaultIdx = heatmapMonths.length - 1;
            if (forecastStartMonth) {
                const fIdx = heatmapMonths.indexOf(forecastStartMonth);
                if (fIdx > 0) defaultIdx = fIdx - 1;
            }
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

/**
 * Pre-fetch odseki vector tiles for a bbox at the given zoom level into the browser HTTP cache.
 * MapLibre will then get cache hits when it requests the same URLs during/after animation.
 */
function prefetchOdsekiTiles(bbox, zoom) {
    const [west, south, east, north] = bbox;
    const n = 1 << zoom;
    const x1 = Math.floor((west  + 180) / 360 * n);
    const x2 = Math.floor((east  + 180) / 360 * n);
    // XYZ tile y: north→smaller y, south→larger y
    const toTileY = (lat) => {
        const s = Math.sin(lat * Math.PI / 180);
        return Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
    };
    const y1 = toTileY(north);
    const y2 = toTileY(south);
    for (let x = x1; x <= x2; x++) {
        for (let y = y1; y <= y2; y++) {
            fetch(`/tiles/${zoom}/${x}/${y}`, { priority: 'low' }).catch(() => {});
        }
    }
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

    // Tiles store odsek IDs in display form (spaces); compare against display form.
    const displayId = displayOdsekId(canonicalOdsekId(odsekId));
    const features = map.querySourceFeatures('odseki', { sourceLayer: 'odseki_map_ggo_gge' });
    const odsekCandidates = features.filter((feature) => normalize(feature?.properties?.odsek) === normalize(displayId));
    if (!odsekCandidates.length) return null;

    const discriminator = detectDiscriminator(odsekCandidates, ggoCode, ggoName);
    const found = odsekCandidates.find((feature) =>
        featureMatchesSelection(feature, odsekId, ggoCode, ggoName, discriminator)
    );

    // Only fall back to any candidate when no GGO context is given at all.
    if (!found && (ggoCode || ggoName)) return null;
    const target = found || odsekCandidates[0];

    if (!target || !target.geometry) return null;

    const bbox = coordinatesBbox(target.geometry.coordinates, [Infinity, Infinity, -Infinity, -Infinity]);
    if (!Number.isFinite(bbox[0])) return null;

    return bbox;
}

function fitToBbox(bbox, cameraOpts = {}) {
    map.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 70, duration: ANIM.panel, maxZoom: 14, ...cameraOpts }
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
    let bbox = findBoundsInLoadedTiles(odsekId, ggoCode, ggoName);
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

        bbox = findBoundsInLoadedTiles(odsekId, ggoCode, ggoName);
        if (bbox) return bbox;
    }

    return null;
}

async function locateOdsek(odsekId, ggoCode, ggoName, mode = 'panel', cameraOpts = {}) {
    const animatePanelSwitch = mode === 'panel';

    let bbox = await sweepForOdsekBbox(odsekId, ggoCode, ggoName, animatePanelSwitch);
    if (!bbox) return false;

    if (animatePanelSwitch) {
        fitToBbox(bbox, cameraOpts);
    } else {
        map.fitBounds(
            [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
            { padding: 70, duration: ANIM.manual, maxZoom: 14, ...cameraOpts }
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
    ggoSelect.innerHTML = '<option value="">-- izberite GGO --</option>';

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

const NEVER_MATCH = ['==', ['literal', false], true];

function _applyFilter(f) {
    if (HIGHLIGHT_SELECTED_ODSEK_BACKGROUND) {
        if (map.getLayer('odseki-selected-fill'))    map.setFilter('odseki-selected-fill',    f);
    }
    if (map.getLayer('odseki-selected-outline')) map.setFilter('odseki-selected-outline', f);
}

const _GGE_NEVER_MATCH = ['==', ['literal', false], true];

let _selectedGgeName    = '';
let _selectedGgeGgoName = '';

function setGgeHighlight(ggoName, ggeName) {
    _selectedGgeName    = ggeName  || '';
    _selectedGgeGgoName = ggoName  || '';
    let filter;
    if (ggoName && ggeName) {
        filter = ['all',
            ['==', ['get', 'ggo_naziv'], ggoName],
            ['==', ['get', 'gge_naziv'], ggeName]
        ];
    } else if (ggeName) {
        // Fallback: filter only by gge_naziv when GGO is unknown
        filter = ['==', ['get', 'gge_naziv'], ggeName];
    } else {
        filter = _GGE_NEVER_MATCH;
    }
    if (HIGHLIGHT_SELECTED_GGE_BACKGROUND) {
        if (map.getLayer('gge-selected-fill'))    map.setFilter('gge-selected-fill',    filter);
    }
    if (map.getLayer('gge-selected-outline')) map.setFilter('gge-selected-outline', filter);
}

function clearGgeHighlight() {
    setGgeHighlight(null, null);
}

/** Clear the highlight layers and side-panel odsek info. */
function clearHighlight() {
    ++_highlightReqId;
    _applyFilter(NEVER_MATCH);
    clearGgeHighlight();
    selectedOdsekId = '';
    heatmapInfoEl.classList.add('hidden');
    selectedOdsekEl.textContent = 'Ni izbranega odseka.';
    detailsEl.classList.add('empty');
    detailsEl.textContent = '-';
}

/** Reset the full left panel: GGO dropdown, search field, and odsek info. */
function resetPanel() {
    clearHighlight();
    ggoSelect.value = '';
    setSearchEnabled(false);
    selectedOdsekEl.textContent = 'Ni izbranega odseka.';
    detailsEl.classList.add('empty');
    detailsEl.textContent = '-';
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

    // Step 1 — immediate filter always includes GGO when known, so odseki with
    // the same code in other GGOs are never highlighted even before tiles load.
    const immediateFilter = ggoName
        ? ['all', odsekFilter, ['==', ['to-string', ['get', 'ggo_naziv']], String(ggoName)]]
        : odsekFilter;
    _applyFilter(immediateFilter);

    if (!ggoName) return;

    // Step 2 — after idle, query loaded tiles to get the exact stored field values
    // (GGO name in tiles may differ slightly from the dropdown value).
    // Only refines the filter; never weakens it to odsek-only.
    const canonical = String(odsekId).trim().replace(/ /g, '0');
    const normGgo   = normalize(ggoName);

    map.once('idle', () => {
        if (reqId !== _highlightReqId) return;

        const features = map.querySourceFeatures('odseki', { sourceLayer: 'odseki_map_ggo_gge' });
        const candidates = features.filter(f => {
            const tileOdsek = String(f.properties?.odsek ?? '').trim();
            return tileOdsek.replace(/ /g, '0') === canonical;
        });
        if (!candidates.length) return; // tiles not yet loaded — keep Step 1 filter

        for (const key of ['ggo_naziv', 'ggo_name']) {
            const hit = candidates.find(
                f => normalize(String(f.properties?.[key] ?? '')) === normGgo
            );
            if (hit) {
                _applyFilter(['all',
                    ['==', ['to-string', ['get', 'odsek']], String(hit.properties.odsek)],
                    ['==', ['to-string', ['get', key]],     String(hit.properties[key])]
                ]);
                return;
            }
        }
        // No exact tile match found — Step 1 GGO-constrained filter remains active.
    });
}

/**
 * @param {string} odsekId
 * @param {'panel'|'manual'} source
 * @param {string|null} ggoNameOverride  - GGO name detected from tile props (overrides dropdown)
 */
async function selectOdsek(odsekId, source = 'panel', ggoNameOverride = null, cameraOpts = {}) {
    cameraOpts = { bearing: map.getBearing(), pitch: map.getPitch(), ...cameraOpts };
    // Canonical form (zeros) for API lookups; display form (spaces) for tile filters and UI.
    const cleanId = canonicalOdsekId(odsekId);
    if (!cleanId) return;
    const displayId = displayOdsekId(cleanId);

    // Prefer the GGO detected from the tile feature; fall back to the dropdown selection.
    const ggoName = ggoNameOverride || selectedGgoName();
    if (!ggoName) {
        selectedOdsekEl.textContent = 'Najprej izberite GGO.';
        return;
    }

    searchInput.value = displayId;
    suggestionsEl.innerHTML = '';

    const payload = await fetchOdsekByKey(ggoName, cleanId);
    if (!payload || !payload.data) {
        selectedOdsekEl.textContent = `Odsek ${displayId} v GGO '${ggoName}' ni najden.`;
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Ni podatkov za izbran odsek.';
        return;
    }

    selectedOdsekEl.textContent = `Izbran odsek: ${displayId} | GGO: ${ggoName}`;
    selectedOdsekId = cleanId;
    renderDetailsTable(payload.data);
    fetchAndShowHeatmapValue(cleanId, currentMonthString(), ggoName).catch(() => {});

    // Apply the highlight filter immediately — MapLibre renders it correctly as tiles load.
    // Tiles store IDs with spaces, so pass the display form to setHighlight.
    setHighlight(displayId, ggoName);
    setGgeHighlight(
        String(payload.data.ggo_naziv || ggoName || '').trim(),
        String(payload.data.gge_naziv || '').trim()
    );

    if (source === 'history') return;

    const duration = source === 'panel' ? ANIM.panel : ANIM.manual;

    // Pre-apply odsek view immediately so tiles start loading during the flight animation.
    _updateZoomVisibility(GGE_TO_ODSEK_ZOOM);

    // 1. Query all tile pieces of this odsek (filtered by GGO+odsek pair) to get the true combined bbox.
    //    Tiles store odsek IDs with spaces — use displayId for the tile filter.
    {
        const ggoFilter = ggoName
            ? ['==', ['to-string', ['get', 'ggo_naziv']], ggoName]
            : null;
        const odsekFilter = ['==', ['to-string', ['get', 'odsek']], displayId];
        const tileFilter = ggoFilter ? ['all', odsekFilter, ggoFilter] : odsekFilter;
        const allFeatures = map.querySourceFeatures('odseki', {
            sourceLayer: 'odseki_map_ggo_gge',
            filter: tileFilter
        });
        let bbox = [Infinity, Infinity, -Infinity, -Infinity];
        for (const f of allFeatures) {
            const b = getBboxFromGeometry(f.geometry);
            if (!b) continue;
            bbox = [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]),
                    Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])];
        }
        if (Number.isFinite(bbox[0])) {
            map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 70, duration, maxZoom: 14, ...cameraOpts });
            return;
        }
    }

    // 2. Bbox from server — fly there.
    if (payload.bbox) {
        const b = payload.bbox;
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 70, duration, maxZoom: 14, ...cameraOpts });
        return;
    }

    // 3. Fallback: tile sweep — tiles use display form (spaces).
    const ggoCode = String(payload.key?.ggo_code || selectedGgoCode() || '').trim();
    const moved = await locateOdsek(displayId, ggoCode, ggoName, source, cameraOpts);
    if (!moved) {
        console.warn('Odsek location could not be resolved:', displayId, ggoName);
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
        detailsEl.textContent = 'Izberite odsek.';
        searchInput.focus();
    } else {
        selectedOdsekEl.textContent = 'Ni izbranega odseka.';
        detailsEl.classList.add('empty');
        detailsEl.textContent = '-';
    }
});

searchInput.addEventListener('input', () => {
    const ggoName = selectedGgoName();
    const query = searchInput.value.trim();
    suggestionsEl.querySelectorAll('.suggestion-item.active').forEach(el => el.classList.remove('active'));
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
    _pushInitialSnap();
    initHeatmap().catch(console.error);
});

// Pass targetZoom to pre-apply visibility before an animation starts so tiles load
// during the flight. Called without argument from the zoomend handler to correct any mismatch.
function _updateZoomVisibility(targetZoom) {
    const zoom = targetZoom ?? map.getZoom();
    const showGGE = zoom < GGE_TO_ODSEK_ZOOM;
    if (map.getLayer('gge-fill')) {
        map.setLayoutProperty('gge-fill', 'visibility', showGGE ? 'visible' : 'none');
    }
    if (map.getLayer('odseki-fill')) {
        map.setLayoutProperty('odseki-fill',    'visibility', showGGE ? 'none' : 'visible');
        map.setLayoutProperty('odseki-outline', 'visibility', showGGE ? 'none' : 'visible');
    }
}

map.on('zoomend', () => _updateZoomVisibility());

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

map.on('click', 'gge-fill', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    const ggeName = String(feature?.properties?.gge_naziv || '').trim();
    if (!ggeName) return;

    // GGE tiles now carry ggo_naziv — use it directly for the unique <ggo, gge> key.
    // Fall back to the overlapping GGO polygon for older tiles that lack the property.
    let ggoName = String(feature?.properties?.ggo_naziv || '').trim();
    if (!ggoName) {
        const ggoFeatures = map.queryRenderedFeatures(event.point, { layers: ['ggo-fill-hidden'] });
        ggoName = String(ggoFeatures[0]?.properties?.ggo_naziv || '').trim();
    }

    clearHighlight();
    setGgeHighlight(ggoName, ggeName);

    // Clear the odsek search box.
    searchInput.value = '';
    suggestionsEl.innerHTML = '';

    // Sync the GGO dropdown using the GGO from the tile.
    if (ggoName && ggoCodeByName.has(ggoName)) {
        ggoSelect.value = ggoName;
        setSearchEnabled(true);
        selectedOdsekEl.textContent = `Izbran GGO: ${ggoName}`;
        detailsEl.classList.add('empty');
        detailsEl.textContent = 'Izberite odsek.';
    }

    applyMonthColor().catch(console.error);

    // Collect bbox of all tile fragments for this exact <ggo, gge> pair.
    // Filter by both ggo_naziv and gge_naziv so same-name GGEs in other GGOs are excluded.
    const anchorBbox = getBboxFromGeometry(feature.geometry);
    if (!anchorBbox) return;
    const [ax0, ay0, ax1, ay1] = anchorBbox;
    const bufDeg = 0.8; // ~80 km guard — in case ggo_naziv is missing from some fragments

    const tileFilter = ggoName
        ? ['all', ['==', ['get', 'ggo_naziv'], ggoName], ['==', ['get', 'gge_naziv'], ggeName]]
        : ['==', ['get', 'gge_naziv'], ggeName];

    const allFeatures = map.querySourceFeatures('gge', {
        sourceLayer: 'gge_vektor',
        filter: tileFilter
    });
    let bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of allFeatures) {
        const b = getBboxFromGeometry(f.geometry);
        if (!b) continue;
        const [fx0, fy0, fx1, fy1] = b;
        // Skip fragments outside the anchor buffer (fallback guard for tiles missing ggo_naziv).
        if (fx1 < ax0 - bufDeg || fx0 > ax1 + bufDeg ||
            fy1 < ay0 - bufDeg || fy0 > ay1 + bufDeg) continue;
        bbox = [Math.min(bbox[0], fx0), Math.min(bbox[1], fy0),
                Math.max(bbox[2], fx1), Math.max(bbox[3], fy1)];
    }
    if (!Number.isFinite(bbox[0])) return;

    const bounds = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    const cam = map.cameraForBounds(bounds, { padding: 50, maxZoom: 14 });
    const targetZoom = Math.max((cam?.zoom ?? GGE_TO_ODSEK_ZOOM), GGE_TO_ODSEK_ZOOM);
    _updateZoomVisibility(targetZoom);
    prefetchOdsekiTiles(bbox, Math.floor(targetZoom));
    map.flyTo({ center: cam?.center ?? [(bbox[0]+bbox[2])/2, (bbox[1]+bbox[3])/2], zoom: targetZoom, duration: ANIM.manual });
});

map.on('click', 'odseki-fill', (event) => {
    const feature = event.features?.[0];
    const props = feature?.properties || {};
    if (!props.odsek) return;

    const clickedOdsek = String(props.odsek);

    // 1. Try to determine the GGO directly from the tile feature properties (tiles have ggo_naziv).
    const detectedGgoName = detectGgoNameFromProps(props);

    if (detectedGgoName) {
        // Sync the GGO dropdown and search bar to reflect the clicked feature.
        if (ggoSelect.value !== detectedGgoName && ggoCodeByName.has(detectedGgoName)) {
            ggoSelect.value = detectedGgoName;
            setSearchEnabled(true);
        }
        selectOdsek(clickedOdsek, 'manual', detectedGgoName).catch((err) => {
            console.error('selectOdsek failed', err);
        });
        return;
    }

    // 2. Tiles have no GGO field. If the user has a GGO selected in the dropdown, use it.
    if (selectedGgoName()) {
        selectOdsek(clickedOdsek, 'manual', null).catch((err) => {
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
            detailsEl.textContent = 'Najprej izberite GGO v spustnem meniju, nato išči odsek.';
            return;
        }

        if (payload.data) {
            const fallbackGgoName = String(payload.data.ggo_naziv || '').trim();
            // clickedOdsek is in display form (from tile props); canonical is needed for API calls.
            const canonicalClicked = canonicalOdsekId(clickedOdsek);
            // Sync dropdown and search bar.
            if (fallbackGgoName && ggoCodeByName.has(fallbackGgoName)) {
                ggoSelect.value = fallbackGgoName;
                setSearchEnabled(true);
            }
            searchInput.value = clickedOdsek;   // display form (spaces)
            selectedOdsekEl.textContent = `Izbran odsek: ${clickedOdsek} | GGO: ${fallbackGgoName}`;
            selectedOdsekId = canonicalClicked;  // canonical form for API calls
            renderDetailsTable(payload.data);
            fetchAndShowHeatmapValue(canonicalClicked, currentMonthString(), fallbackGgoName).catch(() => {});
            setHighlight(clickedOdsek, fallbackGgoName);
            setGgeHighlight(
                String(payload.data.ggo_naziv || fallbackGgoName || '').trim(),
                String(payload.data.gge_naziv || '').trim()
            );
            _updateZoomVisibility(GGE_TO_ODSEK_ZOOM);
            {
                const ggoFilter = fallbackGgoName
                    ? ['==', ['to-string', ['get', 'ggo_naziv']], fallbackGgoName]
                    : null;
                const odsekFilter = ['==', ['to-string', ['get', 'odsek']], clickedOdsek];
                const tileFilter = ggoFilter ? ['all', odsekFilter, ggoFilter] : odsekFilter;
                const allFeatures = map.querySourceFeatures('odseki', {
                    sourceLayer: 'odseki_map_ggo_gge',
                    filter: tileFilter
                });
                let bbox = [Infinity, Infinity, -Infinity, -Infinity];
                for (const f of allFeatures) {
                    const b = getBboxFromGeometry(f.geometry);
                    if (!b) continue;
                    bbox = [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]),
                            Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])];
                }
                if (Number.isFinite(bbox[0])) {
                    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 70, duration: ANIM.manual, maxZoom: 14 });
                }
            }
        }
    });
});

map.on('mouseenter', 'gge-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'gge-fill', () => { map.getCanvas().style.cursor = ''; });

map.on('mouseenter', 'odseki-fill', () => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'odseki-fill', () => {
    map.getCanvas().style.cursor = '';
});

setSearchEnabled(false);
fetchGgoOptions();
